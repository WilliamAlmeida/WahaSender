import crypto from 'crypto';
import db from '../db';
import { logger } from '../logger';

/**
 * Entitlements: resolves a tenant's plan limits from its active subscription and
 * enforces monthly message quota / resource caps. A value of `-1` on any limit
 * means "unlimited". Usage is tracked per calendar month in `usage_counters`.
 */

export interface Plan {
  id: string;
  slug: string;
  name: string;
  priceCents: number;
  currency: string;
  monthlyMessageQuota: number;
  maxContacts: number;
  maxSessions: number;
  maxCampaigns: number;
  features: string[];
  mpPlanId: string | null;
  active: boolean;
  sortOrder: number;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  status: string;
  provider: string | null;
  providerSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

const ACTIVE_STATUSES = ['trialing', 'active'];

export function currentPeriod(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function rowToPlan(row: any): Plan {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    priceCents: row.priceCents,
    currency: row.currency,
    monthlyMessageQuota: row.monthlyMessageQuota,
    maxContacts: row.maxContacts,
    maxSessions: row.maxSessions,
    maxCampaigns: row.maxCampaigns,
    features: safeJsonArray(row.features),
    mpPlanId: row.mpPlanId || null,
    active: !!row.active,
    sortOrder: row.sortOrder || 0,
  };
}

function safeJsonArray(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function listPlans(includeInactive = false): Promise<Plan[]> {
  const q = db('plans').orderBy('sortOrder', 'asc');
  if (!includeInactive) q.where('active', true);
  const rows = await q;
  return rows.map(rowToPlan);
}

export async function getPlanBySlug(slug: string): Promise<Plan | null> {
  const row = await db('plans').where({ slug }).first();
  return row ? rowToPlan(row) : null;
}

export async function getFreePlan(): Promise<Plan | null> {
  return getPlanBySlug('free');
}

export async function getActiveSubscription(userId: string): Promise<Subscription | null> {
  const row = await db('subscriptions')
    .where({ userId })
    .whereIn('status', ACTIVE_STATUSES)
    .orderBy('createdAt', 'desc')
    .first();
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    planId: row.planId,
    status: row.status,
    provider: row.provider || null,
    providerSubscriptionId: row.providerSubscriptionId || null,
    currentPeriodStart: row.currentPeriodStart ? new Date(row.currentPeriodStart) : null,
    currentPeriodEnd: row.currentPeriodEnd ? new Date(row.currentPeriodEnd) : null,
    cancelAtPeriodEnd: !!row.cancelAtPeriodEnd,
  };
}

/** Resolves the plan a user is entitled to right now (falls back to Free). */
export async function getEntitlements(
  userId: string,
): Promise<{ plan: Plan; subscription: Subscription | null }> {
  const subscription = await getActiveSubscription(userId);
  if (subscription) {
    const planRow = await db('plans').where({ id: subscription.planId }).first();
    if (planRow) return { plan: rowToPlan(planRow), subscription };
  }
  const free = await getFreePlan();
  if (!free) {
    throw new Error('No Free plan configured — run migrations to seed the plan catalog');
  }
  return { plan: free, subscription: null };
}

/** Creates (or returns existing) a Free subscription for a new tenant. */
export async function assignFreePlan(userId: string): Promise<void> {
  const existing = await getActiveSubscription(userId);
  if (existing) return;
  const free = await getFreePlan();
  if (!free) {
    logger.warn({ userId }, '[Entitlements] Free plan missing; cannot assign default subscription');
    return;
  }
  await db('subscriptions').insert({
    id: crypto.randomUUID(),
    userId,
    planId: free.id,
    status: 'active',
    provider: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function getUsage(userId: string, period = currentPeriod()): Promise<number> {
  const row = await db('usage_counters').where({ userId, period }).first();
  return Number(row?.messagesSent || 0);
}

/**
 * Atomically increments this period's usage counter. Uses an upsert so the
 * first send of the month creates the row. Safe under worker concurrency.
 */
export async function incrementUsage(userId: string, by = 1, period = currentPeriod()): Promise<void> {
  const existing = await db('usage_counters').where({ userId, period }).first();
  if (existing) {
    await db('usage_counters')
      .where({ userId, period })
      .increment('messagesSent', by)
      .update({ updatedAt: new Date() });
    return;
  }
  try {
    await db('usage_counters').insert({ userId, period, messagesSent: by, updatedAt: new Date() });
  } catch {
    // Lost the insert race — fall back to increment.
    await db('usage_counters')
      .where({ userId, period })
      .increment('messagesSent', by)
      .update({ updatedAt: new Date() });
  }
}

/** Remaining message quota for the current period; `Infinity` when unlimited. */
export async function getRemainingQuota(userId: string): Promise<number> {
  const { plan } = await getEntitlements(userId);
  if (plan.monthlyMessageQuota < 0) return Infinity;
  const used = await getUsage(userId);
  return Math.max(0, plan.monthlyMessageQuota - used);
}

export async function countActiveContacts(userId: string): Promise<number> {
  const r = await db('contacts').where({ userId }).whereNull('deletedAt').count({ c: '*' }).first();
  return Number(r?.c || 0);
}

export async function countActiveCampaigns(userId: string): Promise<number> {
  const r = await db('campaigns').where({ userId }).whereNull('deletedAt').count({ c: '*' }).first();
  return Number(r?.c || 0);
}

export interface QuotaSnapshot {
  plan: Plan;
  subscription: Subscription | null;
  period: string;
  messagesUsed: number;
  messagesQuota: number; // -1 unlimited
  messagesRemaining: number | null; // null = unlimited
  contactsUsed: number;
  campaignsUsed: number;
}

export async function getQuotaSnapshot(userId: string): Promise<QuotaSnapshot> {
  const { plan, subscription } = await getEntitlements(userId);
  const period = currentPeriod();
  const messagesUsed = await getUsage(userId, period);
  const contactsUsed = await countActiveContacts(userId);
  const campaignsUsed = await countActiveCampaigns(userId);
  const unlimited = plan.monthlyMessageQuota < 0;
  return {
    plan,
    subscription,
    period,
    messagesUsed,
    messagesQuota: plan.monthlyMessageQuota,
    messagesRemaining: unlimited ? null : Math.max(0, plan.monthlyMessageQuota - messagesUsed),
    contactsUsed,
    campaignsUsed,
  };
}
