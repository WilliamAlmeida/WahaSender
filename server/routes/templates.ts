import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import db from '../db';
import { audit } from '../lib/audit';

const router = Router();

const schema = z.object({
  name: z.string().min(1).max(120),
  body: z.string().min(1).max(8000),
  variables: z.array(z.string()).optional(),
});

router.get('/', async (req, res) => {
  const rows = await db('templates')
    .where({ userId: req.user!.id })
    .whereNull('deletedAt')
    .orderBy('createdAt', 'desc');
  res.json(
    rows.map((r) => ({ ...r, variables: safeJson(r.variables, []) })),
  );
});

router.post('/', async (req, res) => {
  try {
    const data = schema.parse(req.body);
    const id = crypto.randomUUID();
    await db('templates').insert({
      id,
      userId: req.user!.id,
      name: data.name,
      body: data.body,
      variables: JSON.stringify(data.variables || []),
    });
    await audit({ userId: req.user!.id, action: 'create', entityType: 'template', entityId: id, ip: req.ip });
    res.status(201).json({ id });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const data = schema.partial().parse(req.body);
    const update: any = { updatedAt: new Date() };
    if (data.name) update.name = data.name;
    if (data.body) update.body = data.body;
    if (data.variables) update.variables = JSON.stringify(data.variables);
    const n = await db('templates')
      .where({ id: req.params.id, userId: req.user!.id })
      .whereNull('deletedAt')
      .update(update);
    if (!n) return res.status(404).json({ error: 'Not found' });
    await audit({ userId: req.user!.id, action: 'update', entityType: 'template', entityId: req.params.id, ip: req.ip });
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const n = await db('templates')
    .where({ id: req.params.id, userId: req.user!.id })
    .whereNull('deletedAt')
    .update({ deletedAt: new Date() });
  if (!n) return res.status(404).json({ error: 'Not found' });
  await audit({ userId: req.user!.id, action: 'delete', entityType: 'template', entityId: req.params.id, ip: req.ip });
  res.json({ ok: true });
});

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export default router;
