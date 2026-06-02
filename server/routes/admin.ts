import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireAdmin, cookieOptions } from '../auth/middleware';
import { currentPeriod, listPlans, assignFreePlan } from '../lib/entitlements';
import { activateSubscription, cancelUserSubscription } from '../billing/service';
import { createUser, findUserByEmail, findUserById, signToken } from '../auth/service';
import { config } from '../config';
import { audit } from '../lib/audit';
import { logger } from '../logger';

/**
 * Platform admin API: manage tenants, plans and view aggregate health.
 * All routes require an authenticated admin.
 */
const router = Router();
router.use(requireAuth, requireAdmin);

// ─── Stats ────────────────────────────────────────────────────────────────────

router.get('/stats', async (_req, res) => {
  const period = currentPeriod();
  const [users, activeSubs, msgs, plans] = await Promise.all([
    db('users').count({ c: '*' }).first(),
    db('subscriptions').whereIn('status', ['active', 'trialing']).count({ c: '*' }).first(),
    db('usage_counters').where({ period }).sum({ s: 'messagesSent' }).first(),
    db('subscriptions')
      .join('plans', 'subscriptions.planId', 'plans.id')
      .whereIn('subscriptions.status', ['active', 'trialing'])
      .sum({ mrr: 'plans.priceCents' })
      .first(),
  ]);
  res.json({
    period,
    totalUsers: Number(users?.c || 0),
    activeSubscriptions: Number(activeSubs?.c || 0),
    messagesThisPeriod: Number(msgs?.s || 0),
    mrrCents: Number((plans as any)?.mrr || 0),
  });
});

// ─── Users ────────────────────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  const search = (req.query.search as string) || '';
  const statusFilter = (req.query.status as string) || '';
  const period = currentPeriod();
  let q = db('users')
    .leftJoin('subscriptions', function () {
      this.on('users.id', '=', 'subscriptions.userId').andOnIn('subscriptions.status', ['active', 'trialing']);
    })
    .leftJoin('plans', 'subscriptions.planId', 'plans.id')
    .leftJoin('usage_counters', function () {
      this.on('users.id', '=', 'usage_counters.userId').andOn('usage_counters.period', '=', db.raw('?', [period]));
    })
    .select(
      'users.id',
      'users.email',
      'users.name',
      'users.role',
      'users.status',
      'users.emailVerifiedAt',
      'users.createdAt',
      'users.lastLoginAt',
      'plans.slug as planSlug',
      'plans.name as planName',
      'usage_counters.messagesSent as messagesUsed',
    )
    .orderBy('users.createdAt', 'desc')
    .limit(200);
  if (search) q = q.where('users.email', 'like', `%${search}%`);
  if (statusFilter) q = q.where('users.status', statusFilter);
  const rows = await q;
  res.json(rows.map((r) => ({ ...r, emailVerified: !!r.emailVerifiedAt })));
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  password: z.string().min(8).max(256),
  role: z.enum(['user', 'admin']).default('user'),
  planSlug: z.string().optional(),
});
router.post('/users', async (req, res) => {
  try {
    const { email, name, password, role, planSlug } = createUserSchema.parse(req.body);
    const user = await createUser({ email, name, password, role });

    if (planSlug) {
      const plan = await db('plans').where({ slug: planSlug }).first();
      if (plan) {
        await activateSubscription(user.id, plan.id, { provider: 'admin' });
      } else {
        await assignFreePlan(user.id);
      }
    } else {
      await assignFreePlan(user.id);
    }

    await audit({ userId: req.user!.id, action: 'create', entityType: 'user', entityId: user.id, metadata: { role, planSlug } as any, ip: req.ip });
    logger.info({ email: user.email, role }, '[Admin] User created');
    res.status(201).json({ user });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(400).json({ error: err.message });
  }
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  role: z.enum(['user', 'admin']).optional(),
});
router.patch('/users/:id', async (req, res) => {
  try {
    const { name, email, role } = updateUserSchema.parse(req.body);
    const target = await db('users').where({ id: req.params.id }).first();
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });

    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name.trim();
    if (role !== undefined) updates.role = role;
    if (email !== undefined) {
      const normalized = email.toLowerCase().trim();
      if (normalized !== target.email) {
        const taken = await findUserByEmail(normalized);
        if (taken && taken.id !== req.params.id) {
          return res.status(409).json({ error: 'E-mail já está em uso' });
        }
        updates.email = normalized;
        updates.emailVerifiedAt = null;
      }
    }

    if (Object.keys(updates).length > 0) {
      await db('users').where({ id: req.params.id }).update(updates);
    }
    await audit({ userId: req.user!.id, action: 'update', entityType: 'user', entityId: req.params.id, metadata: { fields: Object.keys(updates) } as any, ip: req.ip });
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(500).json({ error: err.message });
  }
});

const statusSchema = z.object({ status: z.enum(['active', 'suspended']) });
router.post('/users/:id/status', async (req, res) => {
  try {
    const { status } = statusSchema.parse(req.body);
    const target = await db('users').where({ id: req.params.id }).first();
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (target.role === 'admin' && status === 'suspended') {
      return res.status(400).json({ error: 'Não é possível suspender um administrador' });
    }
    await db('users').where({ id: req.params.id }).update({ status });
    await audit({ userId: req.user!.id, action: 'update', entityType: 'user', entityId: req.params.id, metadata: { status } as any, ip: req.ip });
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(500).json({ error: err.message });
  }
});

const planAssignSchema = z.object({ planSlug: z.string().min(1) });
router.post('/users/:id/plan', async (req, res) => {
  try {
    const { planSlug } = planAssignSchema.parse(req.body);
    const plan = await db('plans').where({ slug: planSlug }).first();
    if (!plan) return res.status(404).json({ error: 'Plano não encontrado' });
    const target = await db('users').where({ id: req.params.id }).first();
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    await activateSubscription(req.params.id, plan.id, { provider: 'admin' });
    await audit({ userId: req.user!.id, action: 'update', entityType: 'subscription', entityId: req.params.id, metadata: { planSlug } as any, ip: req.ip });
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(500).json({ error: err.message });
  }
});

// Impersonation: issue a session cookie for the target user, tagged with the
// admin's id (`act`) so the session can be reverted via /auth/stop-impersonate.
router.post('/users/:id/impersonate', async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.user!.id) {
      return res.status(400).json({ error: 'Não é possível impersonar a si mesmo' });
    }
    const target = await findUserById(targetId);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (target.status === 'suspended') {
      return res.status(400).json({ error: 'Não é possível impersonar um usuário suspenso' });
    }
    const { token } = signToken(target, { act: req.user!.id });
    res.cookie(config.COOKIE_NAME, token, cookieOptions());
    await audit({
      userId: req.user!.id,
      action: 'impersonate',
      entityType: 'user',
      entityId: target.id,
      metadata: { targetEmail: target.email } as any,
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    logger.info({ adminId: req.user!.id, targetId }, '[Admin] Impersonation started');
    res.json({ user: target });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    if (userId === req.user!.id) {
      return res.status(400).json({ error: 'Não é possível excluir sua própria conta por aqui' });
    }
    const target = await db('users').where({ id: userId }).first();
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (target.role === 'admin') {
      return res.status(400).json({ error: 'Não é possível excluir um administrador' });
    }

    await cancelUserSubscription(userId).catch(() => undefined);
    await db('campaigns').where({ userId }).delete();
    await db('groups').where({ userId }).delete();
    await db('contacts').where({ userId }).delete();
    await db('templates').where({ userId }).delete();
    await db('api_tokens').where({ userId }).delete();
    await db('outbound_webhooks').where({ userId }).delete();
    await db('settings').where({ userId }).delete();
    await db('users').where({ id: userId }).update({
      email: `deleted-${userId}@anonymized.local`,
      name: 'Conta excluída',
      status: 'suspended',
      emailVerifiedAt: null,
    });

    await audit({ userId: req.user!.id, action: 'delete', entityType: 'user', entityId: userId, metadata: { by: 'admin' } as any, ip: req.ip });
    logger.info({ userId, adminId: req.user!.id }, '[Admin] User deleted');
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Plans ────────────────────────────────────────────────────────────────────

router.get('/plans', async (_req, res) => {
  res.json(await listPlans(true));
});

const planCreateSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens'),
  priceCents: z.number().int().min(0),
  monthlyMessageQuota: z.number().int().min(-1).default(-1),
  maxContacts: z.number().int().min(-1).default(-1),
  maxSessions: z.number().int().min(-1).default(-1),
  maxCampaigns: z.number().int().min(-1).default(-1),
  active: z.boolean().default(true),
});
router.post('/plans', async (req, res) => {
  try {
    const data = planCreateSchema.parse(req.body);
    const existing = await db('plans').where({ slug: data.slug }).first();
    if (existing) return res.status(409).json({ error: 'Já existe um plano com esse slug' });
    const id = crypto.randomUUID();
    await db('plans').insert({ id, ...data, currency: 'BRL', features: '[]', sortOrder: 99, createdAt: new Date() });
    await audit({ userId: req.user!.id, action: 'create', entityType: 'plan', entityId: id, ip: req.ip });
    res.status(201).json({ id });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(500).json({ error: err.message });
  }
});

const planUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  priceCents: z.number().int().min(0).optional(),
  monthlyMessageQuota: z.number().int().optional(),
  maxContacts: z.number().int().optional(),
  maxSessions: z.number().int().optional(),
  maxCampaigns: z.number().int().optional(),
  active: z.boolean().optional(),
});
router.put('/plans/:id', async (req, res) => {
  try {
    const upd = planUpdateSchema.parse(req.body);
    const plan = await db('plans').where({ id: req.params.id }).first();
    if (!plan) return res.status(404).json({ error: 'Plano não encontrado' });
    if (Object.keys(upd).length > 0) await db('plans').where({ id: req.params.id }).update(upd);
    await audit({ userId: req.user!.id, action: 'update', entityType: 'plan', entityId: req.params.id, ip: req.ip });
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(500).json({ error: err.message });
  }
});

// ─── Payments ─────────────────────────────────────────────────────────────────

router.get('/payments', async (req, res) => {
  const statusFilter = (req.query.status as string) || '';
  const userIdFilter = (req.query.userId as string) || '';
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  let q = db('payments')
    .join('users', 'payments.userId', 'users.id')
    .leftJoin('subscriptions', 'payments.subscriptionId', 'subscriptions.id')
    .leftJoin('plans', 'subscriptions.planId', 'plans.id')
    .select(
      'payments.id',
      'payments.userId',
      'users.email as userEmail',
      'payments.provider',
      'payments.providerPaymentId',
      'payments.amountCents',
      'payments.currency',
      'payments.method',
      'payments.status',
      'payments.paidAt',
      'payments.createdAt',
      'plans.name as planName',
      'plans.slug as planSlug',
    )
    .orderBy('payments.createdAt', 'desc')
    .limit(limit)
    .offset(offset);

  if (statusFilter) q = q.where('payments.status', statusFilter);
  if (userIdFilter) q = q.where('payments.userId', userIdFilter);

  const rows = await q;
  res.json(rows);
});

// ─── Audit Log ────────────────────────────────────────────────────────────────

router.get('/audit', async (req, res) => {
  const userIdFilter = (req.query.userId as string) || '';
  const actionFilter = (req.query.action as string) || '';
  const entityTypeFilter = (req.query.entityType as string) || '';
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  let q = db('audit_log')
    .leftJoin('users', 'audit_log.userId', 'users.id')
    .select(
      'audit_log.id',
      'audit_log.userId',
      'users.email as userEmail',
      'audit_log.action',
      'audit_log.entityType',
      'audit_log.entityId',
      'audit_log.metadata',
      'audit_log.ip',
      'audit_log.createdAt',
    )
    .orderBy('audit_log.createdAt', 'desc')
    .limit(limit)
    .offset(offset);

  if (userIdFilter) q = q.where('audit_log.userId', userIdFilter);
  if (actionFilter) q = q.where('audit_log.action', actionFilter);
  if (entityTypeFilter) q = q.where('audit_log.entityType', entityTypeFilter);

  const rows = await q;
  res.json(rows);
});

export default router;
