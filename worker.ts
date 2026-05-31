import axios from 'axios';
import { Worker, Job } from 'bullmq';
import db from './server/db';
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

async function getSettingsForUser(userId: string) {
  return db('settings').where({ userId }).first();
}

interface SendOutcome {
  status: 'sent' | 'skipped' | 'failed' | 'retry';
  wahaMessageId?: string;
  errorMessage?: string;
  skipReason?: string;
}

async function processSendJob(job: Job<SendJobData>): Promise<SendOutcome> {
  const { campaignId, contactId, userId } = job.data;
  const now = new Date();

  const camp = await db('campaigns').where({ id: campaignId, userId }).first();
  if (!camp) return { status: 'skipped', skipReason: 'campaign-missing' };
  if (camp.status !== 'Running' && camp.status !== 'Scheduled') {
    return { status: 'skipped', skipReason: `status-${camp.status}` };
  }
  const startTime = new Date(camp.startTime);
  if (startTime > now) return { status: 'skipped', skipReason: 'before-start' };
  if (camp.endTime && new Date(camp.endTime) < now) {
    await db('campaigns').where({ id: camp.id }).update({ status: 'Completed' });
    return { status: 'skipped', skipReason: 'expired' };
  }

  // Schedule window
  const schedules = camp.schedules ? JSON.parse(camp.schedules) : [];
  if (!isWithinSchedule(schedules, now)) {
    // Re-enqueue this job 1 minute later so we re-check the window
    throw new Error('outside-schedule-retry');
  }

  // Contact
  const contact = await db('contacts').where({ id: contactId, userId }).first();
  if (!contact) {
    await db('campaign_pending_contacts').where({ campaignId, contactId }).delete();
    return { status: 'skipped', skipReason: 'contact-missing' };
  }
  if (contact.blacklisted) {
    const msg = `[${now.toISOString()}] Skipped ${contact.phone} (Blacklisted)`;
    await db('campaigns').where({ id: camp.id }).increment('failed', 1);
    await db('campaign_logs').insert({
      campaignId: camp.id,
      contactId: contact.id,
      log: msg,
      status: 'blacklisted',
    });
    await db('campaign_pending_contacts').where({ campaignId, contactId }).delete();
    return { status: 'skipped', skipReason: 'blacklisted' };
  }

  // Pending row must still exist and not be paused
  const pending = await db('campaign_pending_contacts')
    .where({ campaignId, contactId })
    .first();
  if (!pending) return { status: 'skipped', skipReason: 'not-pending' };
  if (pending.paused) {
    return { status: 'skipped', skipReason: 'paused' };
  }

  // Sessions
  const sessionsList: string[] = JSON.parse(camp.sessions || '[]');
  if (!sessionsList.length) {
    const msg = `[${now.toISOString()}] Failed: no WAHA session configured`;
    await db('campaigns').where({ id: camp.id }).increment('failed', 1);
    await db('campaign_logs').insert({
      campaignId: camp.id,
      contactId: contact.id,
      log: msg,
      status: 'failed',
    });
    await db('campaign_pending_contacts').where({ campaignId, contactId }).delete();
    return { status: 'failed', errorMessage: 'no-session' };
  }
  const session =
    camp.distributionMethod === 'round_robin'
      ? sessionsList[camp.sent % sessionsList.length]
      : sessionsList[Math.floor(Math.random() * sessionsList.length)];

  // Template
  const templates: string[] = JSON.parse(camp.templates || '[]');
  const template = templates[Math.floor(Math.random() * templates.length)];
  if (!template) return { status: 'skipped', skipReason: 'no-template' };

  let messageText = applyPlaceholders(template, {
    name: contact.name || 'Cliente',
    phone: contact.phone,
    id: contact.id,
  });
  messageText = resolveSpintax(messageText);

  const chatId = toWhatsappChatId(contact.phone);
  if (!chatId) {
    const msg = `[${now.toISOString()}] Failed: invalid phone for ${contact.id}`;
    await db('campaigns').where({ id: camp.id }).increment('failed', 1);
    await db('campaign_logs').insert({
      campaignId: camp.id,
      contactId: contact.id,
      log: msg,
      status: 'failed',
    });
    await db('campaign_pending_contacts').where({ campaignId, contactId }).delete();
    return { status: 'failed', errorMessage: 'invalid-phone' };
  }

  const settings = await getSettingsForUser(userId);
  if (!settings?.wahaUrl) {
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

  // Typing simulation (best-effort)
  try {
    await client.post('/api/startTyping', { chatId, session });
    const delay = Math.min(Math.max(messageText.length * 50, 2000), 8000);
    await new Promise((r) => setTimeout(r, delay));
    await client.post('/api/stopTyping', { chatId, session });
  } catch (err) {
    logger.debug({ err }, '[Worker] typing simulation skipped');
  }

  const response = await client.post('/api/sendText', { chatId, text: messageText, session });
  const wahaMessageId = response.data?.id || response.data?.messageId || response.data?.key?.id;

  await db('campaigns').where({ id: camp.id }).increment('sent', 1);
  await db('campaign_logs').insert({
    campaignId: camp.id,
    contactId: contact.id,
    log: `[${now.toISOString()}] Sent to ${chatId} via ${session}`,
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

  return { status: 'sent', wahaMessageId };
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

      // After a successful send, schedule the next job for the same campaign
      // honoring intervalMin..intervalMax. This produces the humanized cadence
      // while still allowing horizontal worker scale.
      if (outcome.status === 'sent') {
        const camp = await db('campaigns').where({ id: job.data.campaignId }).first();
        if (camp && camp.status === 'Running') {
          const next = await db('campaign_pending_contacts')
            .where({ campaignId: camp.id, paused: false })
            .orderBy('order', 'asc')
            .first();
          if (next) {
            const delay = nextSendDelayMs(camp.intervalMin, camp.intervalMax);
            await db('campaigns')
              .where({ id: camp.id })
              .update({ nextSendTime: new Date(Date.now() + delay) });
            await enqueueContactsBulk(
              [{ campaignId: camp.id, contactId: next.contactId, userId: job.data.userId }],
              { delay },
            );
          } else {
            await db('campaigns').where({ id: camp.id }).update({ status: 'Completed' });
          }
        }
      }
      return outcome;
    },
    {
      connection,
      concurrency: config.WORKER_CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    if (err.message === 'outside-schedule-retry' || err.message === 'waha-url-missing-retry') {
      // Re-enqueue same job for later check
      const data = job?.data;
      if (data) {
        enqueueContactsBulk([data], { delay: 60_000 }).catch(() => undefined);
      }
      logger.debug({ jobId: job?.id, err: err.message }, '[Worker] re-enqueued');
      return;
    }
    logger.error({ jobId: job?.id, err: err.message }, '[Worker] job failed');
  });

  worker.on('error', (err) => logger.error({ err: err.message }, '[Worker] error'));
  worker.on('ready', () => logger.info('[Worker] ready'));

  // -----------------------------------------------------------------------------
  // Scheduler: a single repeatable job that ticks every 30s to:
  //  - mark Scheduled campaigns whose startTime has arrived as Running and enqueue
  //  - mark expired/empty campaigns as Completed
  //  - re-enqueue Running campaigns that have pending contacts but no in-flight jobs
  // -----------------------------------------------------------------------------
  const schedulerQueue = getSchedulerQueue();
  await schedulerQueue.add(
    'tick',
    {},
    {
      repeat: { every: 30_000 },
      jobId: 'tick',
      removeOnComplete: true,
      removeOnFail: true,
    },
  );

  new Worker(
    SCHEDULER_QUEUE_NAME,
    async () => {
      const now = new Date();
      const campaigns = await db('campaigns').whereIn('status', ['Scheduled', 'Running']);
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
        }
        if (endTime && endTime < now) {
          await db('campaigns').where({ id: camp.id }).update({ status: 'Completed' });
          continue;
        }

        if (camp.status === 'Running' && !active.has(camp.id)) {
          // Recovery: enqueue next pending contact
          const next = await db('campaign_pending_contacts')
            .where({ campaignId: camp.id, paused: false })
            .orderBy('order', 'asc')
            .first();
          if (next) {
            await enqueueContactsBulk([
              {
                campaignId: camp.id,
                contactId: next.contactId,
                userId: camp.userId,
              },
            ]);
            logger.debug({ campaignId: camp.id }, '[Scheduler] recovered campaign');
          } else {
            await db('campaigns').where({ id: camp.id }).update({ status: 'Completed' });
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

startWorker().catch((err) => {
  logger.error({ err: err.message }, '[Worker] Fatal');
  process.exit(1);
});
