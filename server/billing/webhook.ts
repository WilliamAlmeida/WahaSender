import { Router } from 'express';
import { getBillingProvider } from './provider';
import { applyWebhook } from './service';
import { logger } from '../logger';

/**
 * Public billing webhook endpoint (no JWT). Validates the provider signature,
 * normalizes the event and applies it idempotently. Always answers 200 quickly
 * so the provider does not retry on transient downstream errors we already
 * logged.
 */
const router = Router();

router.post('/mercadopago', async (req: any, res) => {
  const provider = getBillingProvider();
  try {
    const dataId = req.query['data.id'] || req.query.id || req.body?.data?.id;
    const ok = provider.verifySignature(
      { ...req.headers, __dataId: dataId },
      req.rawBody,
    );
    if (!ok) {
      logger.warn('[Billing] Invalid Mercado Pago webhook signature');
      return res.status(401).json({ error: 'invalid signature' });
    }

    const event = await provider.resolveWebhook(req.query as any, req.body);
    if (!event) return res.status(200).json({ ignored: true });

    await applyWebhook(provider.name, event);
    res.status(200).json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, '[Billing] webhook processing error');
    // Acknowledge to avoid aggressive provider retries; we logged for follow-up.
    res.status(200).json({ ok: false });
  }
});

export default router;
