import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { resetDb } from './helpers';
import { runMigrations } from '../server/migrations';
import db from '../server/db';
import {
  assignFreePlan,
  getEntitlements,
  getRemainingQuota,
  incrementUsage,
  getUsage,
  getPlanBySlug,
} from '../server/lib/entitlements';
import { activateSubscription } from '../server/billing/service';

async function makeUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await db('users').insert({
    id,
    email,
    passwordHash: 'x',
    role: 'user',
    status: 'active',
    claimable: false,
    createdAt: new Date(),
  });
  return id;
}

describe('entitlements & quota', () => {
  beforeEach(async () => {
    await runMigrations(); // ensures plan catalog is seeded
    await resetDb();
  });

  it('falls back to the Free plan and tracks monthly usage', async () => {
    const userId = await makeUser('free@test.com');
    await assignFreePlan(userId);

    const { plan } = await getEntitlements(userId);
    expect(plan.slug).toBe('free');
    expect(plan.monthlyMessageQuota).toBe(100);

    expect(await getRemainingQuota(userId)).toBe(100);
    await incrementUsage(userId, 30);
    expect(await getUsage(userId)).toBe(30);
    expect(await getRemainingQuota(userId)).toBe(70);

    await incrementUsage(userId, 70);
    expect(await getRemainingQuota(userId)).toBe(0);
  });

  it('upgrading to a paid plan raises the quota', async () => {
    const userId = await makeUser('pro@test.com');
    await assignFreePlan(userId);
    const pro = await getPlanBySlug('pro');
    expect(pro).not.toBeNull();

    await activateSubscription(userId, pro!.id, { provider: 'mock' });
    const { plan } = await getEntitlements(userId);
    expect(plan.slug).toBe('pro');
    expect(await getRemainingQuota(userId)).toBe(pro!.monthlyMessageQuota);
  });

  it('business plan grants its large message quota', async () => {
    const userId = await makeUser('biz@test.com');
    const biz = await getPlanBySlug('business');
    await activateSubscription(userId, biz!.id, { provider: 'mock' });
    expect(await getRemainingQuota(userId)).toBe(biz!.monthlyMessageQuota);
    expect(biz!.maxCampaigns).toBe(-1); // unlimited campaigns
  });
});
