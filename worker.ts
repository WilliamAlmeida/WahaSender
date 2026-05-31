import axios from 'axios';
import { Worker, Job } from 'bullmq';
import db, { isPostgres } from './server/db';
import { config } from './server/config';
import { logger } from './server/logger';
import { runMigrations } from './server/migrations';
import { getConnectionOptions } from './server/queue/connection';
import {
  QUEUE_NAME,
  SCHEDULER_QUEUE_NAME,
  SendJobData,
  enqueueContactsBulk,
  getCampaignQueue,
  getSchedulerQueue,
} from './server/queue';
import { applyPlaceholders, resolveSpintax, toWhatsappChatId } from './server/lib/messaging';
import { isWithinSchedule, nextSendDelayMs } from './server/lib/schedule';
import { classifyWahaError } from './server/lib/error-classifier';
import { isOpen, recordFailure, recordSuccess, resetCircuit } from './server/lib/circuit-breaker';
import { pickHealthySession } from './server/lib/session-selector';
import { dispatchOutbound } from './server/lib/outbound-webhooks';
import { jobsTotal, jobLatency, wahaErrors } from './server/lib/metrics';

async function getSettingsForUser(userId: string) {
  return db('settings').where({ userId }).first();
}

interface SendOutcome {
  status: 'sent' | 'skipped' | 'failed' | 'retry';
  wahaMessageId?: string;
  errorMessage?: string;
  skipReason?: string;
}

/**
 * Atomically reserves the next pending contact for a campaign so that
 * concurrent workers cannot pick the same row. Uses a transaction with
 * `forUpdate` on Postgres, and a serialized lookup on SQLite (which has a
 * single writer anyway).
 */
async function reserveNextPending(campaignId: string): Promise<{ contactId: string } | null> {
  return db.transaction(async (trx) => {
    let query = trx('campaign_pending_contacts')
      .where({ campaignId, paused: false })
      .whereNull('enqueuedJobId')
      .orderBy('order', 'asc')
      .first();
    if (isPostgres) query = query.forUpdate().skipLocked();
    const row = await query;
    if (!row) return null;
    await trx('campaign_pending_contacts')
      .where({ campaignId, contactId: row.contactId })
      .update({ enqueuedJobId: `reserved-${Date.now()}` });
    return { contactId: row.contactId };
  });
}

async function processSendJob(job: Job<SendJobData>): Promise<SendOutcome> {
  const stop = jobLatency.startTimer();
  const { campaignId, contactId, userId } = job.data;
  const now = new Date();

  const camp = await db('campaigns').where({ id: campaignId, userId }).whereNull('deletedAt').first();
  if (!camp) {
    stop();
    jobsTotal.inc({ outcome: 'skipped' });
    return { status: 'skipped', skipReason: 'campaign-missing' };
  }
  if (camp.status !== 'Running' && camp.status !== 'Scheduled') {
    stop();
    jobsTotal.inc({ outcome: 'skipped' });
    return { status: 'skipped', skipReason: `status-${camp.status}` };
  }
  const startTime = new Date(camp.startTime);
  if (startTime > now) { stop(); jobsTotal.inc({ outcome: 'skipped' }); return { status: 'skipped', skipReason: 'before-start' }; }
  if (camp.endTime && new Date(camp.endTime) < now) {
    await db('campaigns').where({ id: camp.id }).update({ status: 'Completed' });
    void dispatchOutbound(userId, 'campaign.completed', { campaignId: camp.id, reason: 'expired' });
    stop();
    jobsTotal.inc({ outcome: 'skipped' });
    return { status: 'skipped', skipReason: 'expired' };
  }

  const schedules = camp.schedules ? JSON.parse(camp.schedules) : [];
  if (!isWithinSchedule(schedules, now)) {
    stop();
    throw new Error('outside-schedule-retry');
  }

  // Per-contact scheduling honoring scheduledAt column when set
  const pending = await db('campaign_pending_contacts').where({ campaignId, contactId }).first();
  if (!pending) { stop(); jobsTotal.inc({ outcome: 'skipped' }); return { status: 'skipped', skipReason: 'not-pending' }; }
  if (pending.paused) { stop(); jobsTotal.inc({ outcome: 'skipped' }); return { status: 'skipped', skipReason: 'paused' }; }
  if (pending.scheduledAt && new Date(pending.scheduledAt) > now) {
    stop();
    throw new Error('before-scheduled-retry');
  }

  const contact = await db('contacts').where({ id: contactId, userId }).whereNull('deletedAt').first();
  if (!contact) {
    await db('campaign_pending_contacts').where({ campaignId, contactId }).delete();
    stop();
    jobsTotal.inc({ outcome: 'skipped' });
    return { status: 'skipped', skipReason: 'contact-missing' };
  }
  if (contact.blacklisted) {
    await db('campaigns').where({ id: camp.id }).increment('failed', 1);
    await db('campaign_logs').insert({
      campaignId: camp.id,
      contactId: contact.id,
      log: `[${now.toISOString()}] Skipped ${contact.phone} (Blacklisted)`,
      status: 'blacklisted',
    });
    await db('campaign_pending_contacts').where({ campaignId, contactId }).delete();
    stop();
    jobsTotal.inc({ outcome: 'skipped' });
    return { status: 'skipped', skipReason: 'blacklisted' };
  }

  // Multi-session selection (skips sessions whose circuit breaker is open)
  const sessionsList: string[] = JSON.parse(camp.sessions || '[]');
  if (!sessionsList.length) {
    await db('campaigns').where({ id: camp.id }).increment('failed', 1);
    await db('campaign_logs').insert({
      campaignId: camp.id,
      contactId: contact.id,
      log: `[${now.toISOString()}] Failed: no WAHA session configured`,
      status: 'failed',
    });
    await db('campaign_pending_contacts').where({ campaignId, contactId }).delete();
    stop();
    jobsTotal.inc({ outcome: 'failed' });
    return { status: 'failed', errorMessage: 'no-session' };
  }
  const picked = await pickHealthySession(userId, sessionsList, camp.distributionMethod, camp.sent || 0);
  if (!picked) {
    stop();
    throw new Error('all-sessions-open-retry');
  }
  const { session, fallbackUsed } = picked;

  const templates: string[] = JSON.parse(camp.templates || '[]');
  const template = templates[Math.floor(Math.random() * templates.length)];
  if (!template) { stop(); jobsTotal.inc({ outcome: 'skipped' }); return { status: 'skipped', skipReason: 'no-template' }; }

  let messageText = applyPlaceholders(template, {
    name: contact.name || 'Cliente',
    phone: contact.phone,
    id: contact.id,
  });
  messageText = resolveSpintax(messageText);

  const chatId = toWhatsappChatId(contact.phone);
  if (!chatId) {
    await db('campaigns').where({ id: camp.id }).increment('failed', 1);
    await db('campaign_logs').insert({
      campaignId: camp.id,
      contactId: contact.id,
      log: `[${now.toISOString()}] Failed: invalid phone for ${contact.id}`,
      status: 'failed',
    });
    await db('campaign_pending_contacts').where({ campaignId, contactId }).delete();
    stop();
    jobsTotal.inc({ outcome: 'failed' });
    return { status: 'failed', errorMessage: 'invalid-phone' };
  }

  const settings = await getSettingsForUser(userId);
  if (!settings?.wahaUrl) {
    stop();
    throw new Error('waha-url-missing-retry');
  }
  const client = axios.create({
    baseURL: settings.wahaUrl,
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { 'X-Api-Key': settings.apiKey } : {}),
    },
    timeout: 30_000,
  });

  try {
    await client.post('/api/startTyping', { chatId, session });
    const delay = Math.min(Math.max(messageText.length * 50, 2000), 8000);
    await new Promise((r) => setTimeout(r, delay));
    await client.post('/api/stopTyping', { chatId, session });
  } catch (err) {
    logger.debug({ err }, '[Worker] typing simulation skipped');
  }

  try {
    const response = await client.post('/api/sendText', { chatId, text: messageText, session });
    const wahaMessageId = response.data?.id || response.data?.messageId || response.data?.key?.id;

    await db('campaigns').where({ id: camp.id }).increment('sent', 1);
    await db('campaign_logs').insert({
      campaignId: camp.id,
      contactId: contact.id,
      log: `[${now.toISOString()}] Sent to ${chatId} via ${session}${fallbackUsed ? ' [fallback]' : ''}`,
      status: 'sent',
    });
    await db('message_status').insert({
      campaignId: camp.id,
      contactId: contact.id,
      wahaMessageId: wahaMessageId || null,
      session,
      status: 'sent',
      createdAt: now,
      updatedAt: now,
    });
    await db('campaign_pending_contacts').where({ campaignId, contactId }).delete();
    await recordSuccess(userId, session);
    void dispatchOutbound(userId, 'message.sent', {
      campaignId: camp.id,
      contactId: contact.id,
      phone: contact.phone,
      session,
      wahaMessageId,
    });

    stop();
    jobsTotal.inc({ outcome: 'sent' });
    return { status: 'sent', wahaMessageId };
  } catch (err: any) {
    const classification = classifyWahaError(err);
    wahaErrors.inc({ kind: classification.kind });

    if (classification.pauseSession) {
      const { open } = await recordFailure(userId, session);
      if (open && classification.kind === 'auth') {
        // Pause the campaign — sessão deslogada exige ação manual
        await db('campaigns').where({ id: camp.id }).update({ status: 'Paused' });
        void dispatchOutbound(userId, 'campaign.paused', {
          campaignId: camp.id,
          reason: 'session-auth-failed',
          session,
        });
      }
    }

    await db('campaign_logs').insert({
      campaignId: camp.id,
      contactId: contact.id,
      log: `[${now.toISOString()}] ${classification.kind} via ${session}: ${classification.message}`,
      status: 'failed',
    });

    if (classification.retryable) {
      stop();
      const delay = nextSendDelayMs(camp.intervalMin, camp.intervalMax) * classification.backoffMultiplier;
      await enqueueContactsBulk([{ campaignId, contactId, userId }], { delay });
      jobsTotal.inc({ outcome: 'retry' });
      return { status: 'retry', errorMessage: classification.message };
    }

    await db('campaigns').where({ id: camp.id }).increment('failed', 1);
    await db('campaign_pending_contacts').where({ campaignId, contactId }).delete();
    void dispatchOutbound(userId, 'message.failed', {
      campaignId: camp.id,
      contactId: contact.id,
      phone: contact.phone,
      session,
      kind: classification.kind,
      message: classification.message,
    });
    stop();
    jobsTotal.inc({ outcome: 'failed' });
    return { status: 'failed', errorMessage: classification.message };
  }
}

async function startWorker() {
  logger.info({ env: config.NODE_ENV, concurrency: config.WORKER_CONCURRENCY }, '[Worker] Booting');

  try {
    await runMigrations();
  } catch (err: any) {
    logger.error({ err: err.message }, '[Worker] Migrations failed');
    process.exit(1);
  }

  const connection = getConnectionOptions();

  const worker = new Worker<SendJobData>(
    QUEUE_NAME,
    async (job) => {
      const outcome = await processSendJob(job);

      // Chain next contact only on success/skip-final paths to keep humanized
      // cadence; on `retry` the next attempt is already enqueued.
      if (outcome.status === 'sent' || outcome.status === 'skipped') {
        const camp = await db('campaigns').where({ id: job.data.campaignId }).first();
        if (camp && camp.status === 'Running') {
          const next = await reserveNextPending(camp.id);
          if (next) {
            const delay = nextSendDelayMs(camp.intervalMin, camp.intervalMax);
            await db('campaigns')
              .where({ id: camp.id })
              .update({ nextSendTime: new Date(Date.now() + delay) });
            await enqueueContactsBulk(
              [{ campaignId: camp.id, contactId: next.contactId, userId: job.data.userId }],
              { delay },
            );
          } else if (outcome.status === 'sent') {
            const remaining = await db('campaign_pending_contacts').where({ campaignId: camp.id }).count({ c: '*' }).first();
            if (Number(remaining?.c || 0) === 0) {
              await db('campaigns').where({ id: camp.id }).update({ status: 'Completed' });
              void dispatchOutbound(job.data.userId, 'campaign.completed', { campaignId: camp.id });
            }
          }
        }
      }
      return outcome;
    },
    { connection, concurrency: config.WORKER_CONCURRENCY },
  );

  worker.on('failed', (job, err) => {
    const data = job?.data;
    if (
      data &&
      ['outside-schedule-retry', 'waha-url-missing-retry', 'all-sessions-open-retry', 'before-scheduled-retry'].includes(err.message)
    ) {
      enqueueContactsBulk([data], { delay: 60_000 }).catch(() => undefined);
      logger.debug({ jobId: job?.id, err: err.message }, '[Worker] soft-retry');
      return;
    }
    logger.error({ jobId: job?.id, err: err.message }, '[Worker] job failed');
  });

  worker.on('error', (err) => logger.error({ err: err.message }, '[Worker] error'));
  worker.on('ready', () => logger.info('[Worker] ready'));

  // Scheduler tick
  const schedulerQueue = getSchedulerQueue();
  await schedulerQueue.add(
    'tick',
    {},
    { repeat: { every: 30_000 }, jobId: 'tick', removeOnComplete: true, removeOnFail: true },
  );

  new Worker(
    SCHEDULER_QUEUE_NAME,
    async () => {
      const now = new Date();
      const campaigns = await db('campaigns').whereNull('deletedAt').whereIn('status', ['Scheduled', 'Running']);
      const mainQueue = getCampaignQueue();
      const active = new Set<string>();
      const inFlight = await mainQueue.getJobs(['active', 'waiting', 'delayed', 'paused']);
      for (const j of inFlight) {
        const id = (j as any)?.data?.campaignId;
        if (id) active.add(id);
      }

      for (const camp of campaigns) {
        const startTime = new Date(camp.startTime);
        const endTime = camp.endTime ? new Date(camp.endTime) : null;

        if (camp.status === 'Scheduled' && startTime <= now) {
          await db('campaigns').where({ id: camp.id }).update({ status: 'Running' });
          camp.status = 'Running';
          void dispatchOutbound(camp.userId, 'campaign.started', { campaignId: camp.id });
        }
        if (endTime && endTime < now) {
          await db('campaigns').where({ id: camp.id }).update({ status: 'Completed' });
          void dispatchOutbound(camp.userId, 'campaign.completed', { campaignId: camp.id, reason: 'expired' });
          continue;
        }

        if (camp.status === 'Running' && !active.has(camp.id)) {
          const next = await reserveNextPending(camp.id);
          if (next) {
            await enqueueContactsBulk([
              { campaignId: camp.id, contactId: next.contactId, userId: camp.userId },
            ]);
            logger.debug({ campaignId: camp.id }, '[Scheduler] recovered campaign');
          } else {
            const remaining = await db('campaign_pending_contacts').where({ campaignId: camp.id }).count({ c: '*' }).first();
            if (Number(remaining?.c || 0) === 0) {
              await db('campaigns').where({ id: camp.id }).update({ status: 'Completed' });
              void dispatchOutbound(camp.userId, 'campaign.completed', { campaignId: camp.id });
            }
          }
        }
      }
    },
    { connection },
  );

  const shutdown = async () => {
    logger.info('[Worker] Shutting down...');
    await worker.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Expose helper to reset a circuit breaker (used by API admin)
export { resetCircuit };

startWorker().catch((err) => {
  logger.error({ err: err.message }, '[Worker] Fatal');
  process.exit(1);
});
