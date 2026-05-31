import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { buildTestApp, resetDb } from './helpers';

describe('auth flow', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('bootstraps the first admin and rejects subsequent registrations', async () => {
    const app = await buildTestApp();
    const agent = request.agent(app);

    const need = await agent.get('/api/auth/needs-bootstrap');
    expect(need.body.needsBootstrap).toBe(true);

    const reg = await agent
      .post('/api/auth/register')
      .send({ email: 'admin@test.com', password: 'Senha@1234', name: 'Admin' });
    expect(reg.status).toBe(200);
    expect(reg.body.user.email).toBe('admin@test.com');

    const need2 = await agent.get('/api/auth/needs-bootstrap');
    expect(need2.body.needsBootstrap).toBe(false);

    const reg2 = await request(app)
      .post('/api/auth/register')
      .send({ email: 'second@test.com', password: 'Senha@1234' });
    expect(reg2.status).toBeGreaterThanOrEqual(400);
  });

  it('login + me works, logout revokes the token', async () => {
    const app = await buildTestApp();
    const agent = request.agent(app);
    await agent
      .post('/api/auth/register')
      .send({ email: 'admin@test.com', password: 'Senha@1234' });

    const login = await agent
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'Senha@1234' });
    expect(login.status).toBe(200);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('admin@test.com');

    const rawCookieList = (login.headers['set-cookie'] as unknown as string[]) || [];
    const rawCookie = rawCookieList[0]?.split(';')[0] || '';
    const logout = await agent.post('/api/auth/logout');
    expect(logout.status).toBe(200);

    const me2 = await request(app).get('/api/auth/me').set('Cookie', rawCookie);
    expect(me2.status).toBe(401);
  });

  it('rejects weak passwords when complexity is required', async () => {
    process.env.PASSWORD_REQUIRE_COMPLEXITY = 'true';
    process.env.PASSWORD_MIN_LENGTH = '10';
    const { validatePassword } = await import('../server/auth/password-policy');
    const r1 = validatePassword('short');
    expect(r1.ok).toBe(false);
    const r2 = validatePassword('Senha@1234');
    expect(r2.ok).toBe(true);
  });

  it('webhook HMAC: verifies signatures (with and without sha256= prefix)', async () => {
    const { verifyHmacSignature } = await import('../server/auth/hmac');
    const payload = Buffer.from(JSON.stringify({ event: 'message', id: 'x' }));
    const good = crypto.createHmac('sha256', 'unit-secret').update(payload).digest('hex');
    expect(verifyHmacSignature(payload, 'unit-secret', good)).toBe(true);
    expect(verifyHmacSignature(payload, 'unit-secret', 'sha256=' + good)).toBe(true);
    expect(verifyHmacSignature(payload, 'unit-secret', 'deadbeef')).toBe(false);
  });
});
