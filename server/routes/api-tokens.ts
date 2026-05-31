import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import db from '../db';
import { audit } from '../lib/audit';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(120),
  expiresAt: z.string().datetime().optional(),
  scopes: z.array(z.string()).optional(),
});

router.get('/', async (req, res) => {
  const rows = await db('api_tokens')
    .where({ userId: req.user!.id })
    .orderBy('createdAt', 'desc');
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      scopes: safeJson(r.scopes, []),
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt,
    })),
  );
});

router.post('/', async (req, res) => {
  try {
    const data = createSchema.parse(req.body);
    const id = crypto.randomUUID();
    const rawToken = `wks_${crypto.randomBytes(24).toString('hex')}`;
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    await db('api_tokens').insert({
      id,
      userId: req.user!.id,
      name: data.name,
      hashedToken,
      prefix: rawToken.slice(0, 12),
      scopes: JSON.stringify(data.scopes || []),
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    });
    await audit({ userId: req.user!.id, action: 'token.create', entityType: 'api_token', entityId: id, ip: req.ip });
    // Token is shown ONCE; client must store it.
    res.status(201).json({ id, token: rawToken, prefix: rawToken.slice(0, 12) });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/revoke', async (req, res) => {
  const n = await db('api_tokens')
    .where({ id: req.params.id, userId: req.user!.id })
    .whereNull('revokedAt')
    .update({ revokedAt: new Date() });
  if (!n) return res.status(404).json({ error: 'Not found' });
  await audit({ userId: req.user!.id, action: 'token.revoke', entityType: 'api_token', entityId: req.params.id, ip: req.ip });
  res.json({ ok: true });
});

// Alias DELETE -> revoke (idempotent)
router.delete('/:id', async (req, res) => {
  const n = await db('api_tokens')
    .where({ id: req.params.id, userId: req.user!.id })
    .whereNull('revokedAt')
    .update({ revokedAt: new Date() });
  if (!n) return res.status(404).json({ error: 'Not found' });
  await audit({ userId: req.user!.id, action: 'token.revoke', entityType: 'api_token', entityId: req.params.id, ip: req.ip });
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
