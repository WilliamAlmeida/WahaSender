import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { buildTestApp, resetDb } from './helpers';

async function bootstrap(app: any, email: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ email, password: 'Senha@1234', name: email });
  return agent;
}

describe('multi-tenant isolation', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('User A cannot read User B contacts', async () => {
    const app = await buildTestApp();
    const agentA = await bootstrap(app, 'a@test.com');

    // A imports first
    const createA = await agentA
      .post('/api/contacts/import')
      .send({ contacts: [{ name: 'Ana', phone: '5511999990000' }] });
    expect(createA.status).toBeLessThan(400);

    // Seed user B directly (registration blocked after bootstrap) and login.
    const { createUser } = await import('../server/auth/service');
    await createUser({ email: 'b@test.com', password: 'Senha@1234', name: 'User B' });
    const agentB = request.agent(app);
    const loginB = await agentB
      .post('/api/auth/login')
      .send({ email: 'b@test.com', password: 'Senha@1234' });
    expect(loginB.status).toBe(200);

    const listA = await agentA.get('/api/contacts');
    expect(listA.status).toBe(200);
    expect(listA.body.length).toBe(1);

    const listB = await agentB.get('/api/contacts');
    expect(listB.status).toBe(200);
    expect(listB.body.length).toBe(0);
  });

  it('soft-deleted contact disappears from listing', async () => {
    const app = await buildTestApp();
    const agent = await bootstrap(app, 'admin@test.com');

    await agent
      .post('/api/contacts/import')
      .send({ contacts: [{ name: 'X', phone: '5511988887777' }] });

    const list1 = await agent.get('/api/contacts');
    expect(list1.body.length).toBe(1);
    const id = list1.body[0]._id || list1.body[0].id;

    const del = await agent.delete(`/api/contacts/${id}`);
    expect(del.status).toBeLessThan(400);

    const list2 = await agent.get('/api/contacts');
    expect(list2.body.length).toBe(0);
  });

  it('API token issuance + revocation works', async () => {
    const app = await buildTestApp();
    const agent = await bootstrap(app, 'admin@test.com');

    const create = await agent.post('/api/api-tokens').send({ name: 'test' });
    expect([200, 201]).toContain(create.status);
    const rawToken = create.body.token;
    expect(rawToken).toMatch(/^wks_/);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `ApiKey ${rawToken}`);
    expect(me.status).toBe(200);

    const list = await agent.get('/api/api-tokens');
    expect(list.body.length).toBe(1);
    const id = list.body[0].id;

    await agent.delete(`/api/api-tokens/${id}`);

    const me2 = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `ApiKey ${rawToken}`);
    expect(me2.status).toBe(401);
  });
});
