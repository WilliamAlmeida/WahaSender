import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { buildTestApp, resetDb } from './helpers';
import { runMigrations } from '../server/migrations';
import db from '../server/db';

async function signup(app: any, agent: any, email: string) {
  return agent.post('/api/auth/signup').send({ email, password: 'Senha1234', name: email });
}

describe('SaaS self-service signup', () => {
  beforeEach(async () => {
    await runMigrations();
    await resetDb();
  });

  it('first signup becomes a verified admin, second becomes a Free-plan user', async () => {
    const app = await buildTestApp();

    const admin = await signup(app, request.agent(app), 'owner@test.com');
    expect(admin.status).toBe(200);
    expect(admin.body.user.role).toBe('admin');
    expect(admin.body.user.emailVerified).toBe(true);

    const tenantAgent = request.agent(app);
    const tenant = await signup(app, tenantAgent, 'tenant@test.com');
    expect(tenant.status).toBe(200);
    expect(tenant.body.user.role).toBe('user');

    // A Free subscription was provisioned for the new tenant.
    const sub = await db('subscriptions').where({ userId: tenant.body.user.id }).first();
    expect(sub).toBeTruthy();
    expect(sub.status).toBe('active');
  });

  it('blocks starting a campaign when it exceeds the monthly message quota', async () => {
    const app = await buildTestApp();
    // First signup is the platform admin (unlimited); second is our Free tenant.
    await signup(app, request.agent(app), 'owner2@test.com');
    const agent = request.agent(app);
    const tenant = await signup(app, agent, 'tenant2@test.com');
    expect(tenant.status).toBe(200);

    // Build a group with 150 contacts — above the Free quota of 100 messages.
    const contacts = Array.from({ length: 150 }, (_, i) => ({
      phone: `55119${String(i).padStart(8, '0')}`,
      name: `C${i}`,
    }));
    const group = await agent.post('/api/groups').send({ name: 'Lote', contacts });
    expect(group.status).toBe(200);

    const camp = await agent.post('/api/campaigns').send({
      name: 'Promo',
      groupId: group.body.id,
      sessions: ['default'],
      templates: ['Olá {{name}}'],
    });
    expect(camp.status).toBe(200);

    const toggle = await agent.post(`/api/campaigns/${camp.body.id}/toggle`);
    expect(toggle.status).toBe(402);
    expect(toggle.body.code).toBe('quota_exceeded');
  });

  it('verifies e-mail via a single-use token', async () => {
    await buildTestApp();
    const { createEmailToken, consumeEmailToken } = await import('../server/auth/email-tokens');
    const userId = crypto.randomUUID();
    await db('users').insert({ id: userId, email: 'v@test.com', passwordHash: 'x', role: 'user', status: 'active', claimable: false, createdAt: new Date() });

    const raw = await createEmailToken(userId, 'verify', 60_000);
    const first = await consumeEmailToken(raw, 'verify');
    expect(first?.userId).toBe(userId);
    // Single-use: second attempt fails.
    const second = await consumeEmailToken(raw, 'verify');
    expect(second).toBeNull();
  });
});
