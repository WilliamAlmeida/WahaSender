import crypto from 'crypto';
import db from '../db';
import { logger } from '../logger';
import type { ParsedWebhook } from './provider';

/**
 * Billing state transitions. Keeps `subscriptions` and `payments` in sync with
 * what the provider reports, and exposes idempotent webhook handling.
 */

const PERIOD_DAYS = 30;

function periodEnd(from: Date = new Date()): Date {
  return new Date(from.getTime() + PERIOD_DAYS * 24 * 60 * 60 * 1000);
}

/** Activates (or upgrades) a user's subscription to a plan. Cancels prior ones. */
export async function activateSubscription(
  userId: string,
  planId: string,
  opts: { provider?: string | null; providerSubscriptionId?: string | null } = {},
): Promise<void> {
  const now = new Date();
  await db('subscriptions')
    .where({ userId })
    .whereIn('status', ['trialing', 'active', 'pending', 'past_due'])
    .update({ status: 'canceled', updatedAt: now });

  await db('subscriptions').insert({
    id: crypto.randomUUID(),
    userId,
    planId,
    status: 'active',
    provider: opts.provider || null,
    providerSubscriptionId: opts.providerSubscriptionId || null,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd(now),
    cancelAtPeriodEnd: false,
    createdAt: now,
    updatedAt: now,
  });
  logger.info({ userId, planId, provider: opts.provider }, '[Billing] Subscription activated');
}

export async function createPendingSubscription(
  userId: string,
  planId: string,
  provider: string,
  providerSubscriptionId: string | null,
): Promise<void> {
  const now = new Date();
  await db('subscriptions').insert({
    id: crypto.randomUUID(),
    userId,
    planId,
    status: 'pending',
    provider,
    providerSubscriptionId,
    createdAt: now,
    updatedAt: now,
  });
}

export async function cancelUserSubscription(userId: string): Promise<void> {
  await db('subscriptions')
    .where({ userId })
    .whereIn('status', ['trialing', 'active', 'pending', 'past_due'])
    .update({ status: 'canceled', cancelAtPeriodEnd: true, updatedAt: new Date() });
  logger.info({ userId }, '[Billing] Subscription canceled');
}

export async function recordPayment(input: {
  userId: string;
  subscriptionId?: string | null;
  provider: string;
  providerPaymentId?: string | null;
  amountCents: number;
  method?: string | null;
  status: string;
  paidAt?: Date | null;
}): Promise<void> {
  await db('payments').insert({
    id: crypto.randomUUID(),
    userId: input.userId,
    subscriptionId: input.subscriptionId || null,
    provider: input.provider,
    providerPaymentId: input.providerPaymentId || null,
    amountCents: input.amountCents,
    currency: 'BRL',
    method: input.method || null,
    status: input.status,
    paidAt: input.paidAt || null,
    createdAt: new Date(),
  });
}

/** Parses a "userId:planId" external_reference set at checkout. */
function parseReference(ref?: string): { userId: string; planId: string } | null {
  if (!ref || !ref.includes(':')) return null;
  const [userId, planId] = ref.split(':');
  if (!userId || !planId) return null;
  return { userId, planId };
}

/**
 * Idempotently applies a normalized webhook event. Returns false when the event
 * was already processed (deduplicated via billing_events.externalId).
 */
export async function applyWebhook(provider: string, event: ParsedWebhook): Promise<boolean> {
  // Idempotency guard.
  try {
    await db('billing_events').insert({
      provider,
      externalId: event.externalId,
      payload: JSON.stringify(event),
      processedAt: new Date(),
    });
  } catch {
    logger.debug({ externalId: event.externalId }, '[Billing] duplicate webhook ignored');
    return false;
  }

  const ref = parseReference(event.externalReference);

  if (event.type === 'payment') {
    if (ref) {
      const approved = event.status === 'approved';
      await recordPayment({
        userId: ref.userId,
        provider,
        providerPaymentId: event.providerPaymentId,
        amountCents: event.amountCents || 0,
        method: normalizeMethod(event.method),
        status: event.status || 'pending',
        paidAt: approved ? new Date() : null,
      });
      if (approved) {
        await activateSubscription(ref.userId, ref.planId, {
          provider,
          providerSubscriptionId: event.providerSubscriptionId || null,
        });
      }
    }
    return true;
  }

  if (event.type === 'subscription') {
    if (ref) {
      const status = event.status;
      if (status === 'authorized') {
        await activateSubscription(ref.userId, ref.planId, {
          provider,
          providerSubscriptionId: event.providerSubscriptionId || null,
        });
      } else if (status === 'cancelled' || status === 'paused') {
        await cancelUserSubscription(ref.userId);
      }
    }
    return true;
  }

  return true;
}

function normalizeMethod(method?: string): string | null {
  if (!method) return null;
  if (method.includes('card')) return 'card';
  if (method === 'pix') return 'pix';
  if (method === 'ticket' || method.includes('bol')) return 'boleto';
  return method;
}
