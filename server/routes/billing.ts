import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { config } from '../config';
import { requireAuth } from '../auth/middleware';
import {
  getQuotaSnapshot,
  getPlanBySlug,
  listPlans,
} from '../lib/entitlements';
import { getBillingProvider } from '../billing/provider';
import { activateSubscription, createPendingSubscription, cancelUserSubscription, recordPayment } from '../billing/service';
import { audit } from '../lib/audit';
import { logger } from '../logger';

const router = Router();

// Public-ish: plans are needed by the (logged-out) pricing page too, but the
// router sits behind requireAuth in the app. The landing page uses a dedicated
// public endpoint mounted separately (see server.ts).
router.use(requireAuth);

router.get('/plans', async (_req, res) => {
  res.json(await listPlans());
});

router.get('/subscription', async (req, res) => {
  const snap = await getQuotaSnapshot(req.user!.id);
  res.json(snap);
});

router.get('/usage', async (req, res) => {
  const snap = await getQuotaSnapshot(req.user!.id);
  res.json({
    period: snap.period,
    messagesUsed: snap.messagesUsed,
    messagesQuota: snap.messagesQuota,
    messagesRemaining: snap.messagesRemaining,
    contactsUsed: snap.contactsUsed,
    campaignsUsed: snap.campaignsUsed,
  });
});

router.get('/invoices', async (req, res) => {
  const rows = await db('payments')
    .where({ userId: req.user!.id })
    .orderBy('createdAt', 'desc')
    .limit(100);
  res.json(rows);
});

const checkoutSchema = z.object({ planSlug: z.string().min(1) });
router.post('/checkout', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { planSlug } = checkoutSchema.parse(req.body);
    const plan = await getPlanBySlug(planSlug);
    if (!plan || !plan.active) return res.status(404).json({ error: 'Plano não encontrado' });
    if (plan.priceCents === 0) {
      // Free plan: activate directly, no payment needed.
      await activateSubscription(userId, plan.id, { provider: null });
      await audit({ userId, action: 'update', entityType: 'subscription', metadata: { planSlug } as any, ip: req.ip });
      return res.json({ checkoutUrl: `${config.APP_PUBLIC_URL}/billing?status=success`, mock: true });
    }

    const provider = getBillingProvider();
    const base = config.APP_PUBLIC_URL;
    const result = await provider.createCheckout({
      userId,
      email: req.user!.email,
      plan,
      backUrls: {
        success: `${base}/billing?status=success`,
        pending: `${base}/billing?status=pending`,
        failure: `${base}/billing?status=failure`,
      },
    });

    if (result.mock) {
      // Mock mode (no MP credentials): activate immediately and record a payment.
      await activateSubscription(userId, plan.id, { provider: provider.name, providerSubscriptionId: result.externalId });
      await recordPayment({
        userId,
        provider: provider.name,
        providerPaymentId: result.externalId,
        amountCents: plan.priceCents,
        method: 'mock',
        status: 'approved',
        paidAt: new Date(),
      });
    } else {
      await createPendingSubscription(userId, plan.id, provider.name, result.externalId);
    }

    await audit({ userId, action: 'update', entityType: 'subscription', metadata: { planSlug, mock: result.mock } as any, ip: req.ip });
    logger.info({ userId, planSlug, mock: result.mock }, '[Billing] checkout created');
    res.json({ checkoutUrl: result.checkoutUrl, mock: result.mock });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    logger.error({ err: err.message }, '[Billing] checkout failed');
    res.status(500).json({ error: err.message });
  }
});

router.post('/cancel', async (req, res) => {
  try {
    const userId = req.user!.id;
    const sub = await db('subscriptions')
      .where({ userId })
      .whereIn('status', ['active', 'trialing', 'pending', 'past_due'])
      .first();
    if (sub?.providerSubscriptionId) {
      await getBillingProvider().cancelSubscription(sub.providerSubscriptionId).catch((e) =>
        logger.warn({ err: e.message }, '[Billing] provider cancel failed'),
      );
    }
    await cancelUserSubscription(userId);
    await audit({ userId, action: 'update', entityType: 'subscription', metadata: { action: 'cancel' } as any, ip: req.ip });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
