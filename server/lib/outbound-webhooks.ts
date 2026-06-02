import crypto from 'crypto';
import axios from 'axios';
import db from '../db';
import { logger } from '../logger';

export type OutboundEvent =
  | 'campaign.started'
  | 'campaign.completed'
  | 'campaign.paused'
  | 'message.sent'
  | 'message.failed';

interface OutboundRow {
  id: string;
  userId: string;
  event: string;
  url: string;
  secret: string | null;
  active: boolean;
}

/**
 * Dispatches an event to every outbound webhook a user registered for it.
 * Signs the payload with HMAC-SHA256 when `secret` is configured. Fire-and-
 * forget: failures are logged but never propagate.
 */
export async function dispatchOutbound(
  userId: string,
  event: OutboundEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const rows: OutboundRow[] = await db('outbound_webhooks')
    .where({ userId, event, active: true })
    .catch(() => [] as OutboundRow[]);
  if (!rows.length) return;

  const body = JSON.stringify({ event, deliveredAt: new Date().toISOString(), data: payload });

  await Promise.allSettled(
    rows.map(async (w) => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-WahaSender-Event': event,
        };
        if (w.secret) {
          headers['X-WahaSender-Signature'] =
            'sha256=' + crypto.createHmac('sha256', w.secret).update(body).digest('hex');
        }
        await axios.post(w.url, body, { headers, timeout: 10_000 });
      } catch (err: any) {
        logger.warn(
          { err: err.message, webhookId: w.id, url: w.url, event },
          '[OutboundWebhook] delivery failed',
        );
      }
    }),
  );
}
