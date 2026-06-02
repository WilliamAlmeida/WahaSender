import crypto from 'crypto';
import db from '../db';

/**
 * Single-use, hashed tokens for e-mail verification and password reset.
 * The raw token is only ever returned to the caller (to embed in a link); the
 * database stores a SHA-256 hash, mirroring the api_tokens pattern.
 */

export type EmailTokenType = 'verify' | 'reset';

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function createEmailToken(
  userId: string,
  type: EmailTokenType,
  ttlMs: number,
): Promise<string> {
  const raw = crypto.randomBytes(32).toString('hex');
  // Invalidate any prior unused tokens of the same type for this user.
  await db('email_tokens').where({ userId, type }).whereNull('usedAt').update({ usedAt: new Date() });
  await db('email_tokens').insert({
    id: crypto.randomUUID(),
    userId,
    type,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttlMs),
    createdAt: new Date(),
  });
  return raw;
}

export async function consumeEmailToken(
  raw: string,
  type: EmailTokenType,
): Promise<{ userId: string } | null> {
  const row = await db('email_tokens')
    .where({ tokenHash: hashToken(raw), type })
    .whereNull('usedAt')
    .first();
  if (!row) return null;
  if (new Date(row.expiresAt) < new Date()) return null;
  await db('email_tokens').where({ id: row.id }).update({ usedAt: new Date() });
  return { userId: row.userId };
}
