import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { currentPeriod, listPlans } from '../lib/entitlements';
import { activateSubscription } from '../billing/service';
import { audit } from '../lib/audit';

/**
 * Platform admin API: manage tenants, plans and view aggregate health.
 * All routes require an authenticated admin.
 */
const router = Router();
router.use(requireAuth, requireAdmin);

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

router.get('/users', async (req, res) => {
  const search = (req.query.search as string) || '';
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
  const rows = await q;
  res.json(rows.map((r) => ({ ...r, emailVerified: !!r.emailVerifiedAt })));
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

const planSchema = z.object({ planSlug: z.string().min(1) });
router.post('/users/:id/plan', async (req, res) => {
  try {
    const { planSlug } = planSchema.parse(req.body);
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

router.get('/plans', async (_req, res) => {
  res.json(await listPlans(true));
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

export default router;
