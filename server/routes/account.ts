import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { config } from '../config';
import { requireAuth } from '../auth/middleware';
import { cancelUserSubscription } from '../billing/service';
import { audit } from '../lib/audit';
import { logger } from '../logger';

/**
 * LGPD self-service: data portability (export) and right to erasure (delete).
 */
const router = Router();
router.use(requireAuth);

router.get('/export', async (req, res) => {
  const userId = req.user!.id;
  const [user, contacts, groups, campaigns, templates, settings, subscriptions, payments, usage] =
    await Promise.all([
      db('users').where({ id: userId }).first(),
      db('contacts').where({ userId }),
      db('groups').where({ userId }),
      db('campaigns').where({ userId }),
      db('templates').where({ userId }),
      db('settings').where({ userId }),
      db('subscriptions').where({ userId }),
      db('payments').where({ userId }),
      db('usage_counters').where({ userId }),
    ]);

  const safeUser = user
    ? { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt }
    : null;

  await audit({ userId, action: 'update', entityType: 'account', metadata: { action: 'export' } as any, ip: req.ip });
  res.setHeader('Content-Disposition', 'attachment; filename="wahasender-export.json"');
  res.json({
    exportedAt: new Date().toISOString(),
    user: safeUser,
    contacts,
    groups,
    campaigns,
    templates,
    settings: settings.map((s) => ({ ...s, apiKey: s.apiKey ? '***redacted***' : '' })),
    subscriptions,
    payments,
    usage,
  });
});

const deleteSchema = z.object({ confirm: z.literal('EXCLUIR') });
router.post('/delete', async (req, res) => {
  try {
    const userId = req.user!.id;
    deleteSchema.parse(req.body);

    await cancelUserSubscription(userId).catch(() => undefined);
    // Remove tenant-owned data. FK cascades handle children of these tables.
    await db('campaigns').where({ userId }).delete();
    await db('groups').where({ userId }).delete();
    await db('contacts').where({ userId }).delete();
    await db('templates').where({ userId }).delete();
    await db('api_tokens').where({ userId }).delete();
    await db('outbound_webhooks').where({ userId }).delete();
    await db('settings').where({ userId }).delete();

    // Anonymize the account and lock it out.
    await db('users').where({ id: userId }).update({
      email: `deleted-${userId}@anonymized.local`,
      name: 'Conta excluída',
      status: 'suspended',
      emailVerifiedAt: null,
    });

    await audit({ userId, action: 'delete', entityType: 'account', entityId: userId, metadata: { lgpd: true } as any, ip: req.ip });
    logger.info({ userId }, '[Account] tenant data erased (LGPD)');
    res.clearCookie(config.COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: 'Digite EXCLUIR para confirmar' });
    res.status(500).json({ error: err.message });
  }
});

export default router;
