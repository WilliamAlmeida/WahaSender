import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import db from '../db';
import { audit } from '../lib/audit';

const router = Router();

const SUPPORTED = [
  'campaign.started',
  'campaign.completed',
  'campaign.paused',
  'message.sent',
  'message.failed',
] as const;

const schema = z.object({
  event: z.enum(SUPPORTED),
  url: z.string().url(),
  secret: z.string().min(8).max(256).optional(),
  active: z.boolean().optional(),
});

router.get('/', async (req, res) => {
  const rows = await db('outbound_webhooks')
    .where({ userId: req.user!.id })
    .orderBy('createdAt', 'desc');
  res.json(rows);
});

router.post('/', async (req, res) => {
  try {
    const data = schema.parse(req.body);
    const id = crypto.randomUUID();
    await db('outbound_webhooks').insert({
      id,
      userId: req.user!.id,
      event: data.event,
      url: data.url,
      secret: data.secret || null,
      active: data.active !== false,
    });
    await audit({ userId: req.user!.id, action: 'create', entityType: 'outbound_webhook', entityId: id, ip: req.ip });
    res.status(201).json({ id });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const data = schema.partial().parse(req.body);
    const n = await db('outbound_webhooks')
      .where({ id: req.params.id, userId: req.user!.id })
      .update(data as any);
    if (!n) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const n = await db('outbound_webhooks')
    .where({ id: req.params.id, userId: req.user!.id })
    .delete();
  if (!n) return res.status(404).json({ error: 'Not found' });
  await audit({ userId: req.user!.id, action: 'delete', entityType: 'outbound_webhook', entityId: req.params.id, ip: req.ip });
  res.json({ ok: true });
});

export default router;
