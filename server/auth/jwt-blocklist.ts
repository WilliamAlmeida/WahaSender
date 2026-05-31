import { getRedis } from '../redis';

const PREFIX = 'jwt:revoked:';

/**
 * Revokes a JWT by `jti` until its natural expiration. Implemented with Redis
 * SETEX so entries auto-expire and don't bloat memory.
 */
export async function revokeJti(jti: string, ttlSeconds: number): Promise<void> {
  if (!jti) return;
  const r = getRedis();
  await r.set(`${PREFIX}${jti}`, '1', 'EX', Math.max(1, Math.floor(ttlSeconds)));
}

export async function isJtiRevoked(jti: string | undefined | null): Promise<boolean> {
  if (!jti) return false;
  const r = getRedis();
  const v = await r.get(`${PREFIX}${jti}`);
  return v === '1';
}
