import { getRedis } from '../redis';
import { config } from '../config';
import { circuitBreakerState } from './metrics';
import { logger } from '../logger';

const FAIL_KEY = (userId: string, session: string) => `cb:fail:${userId}:${session}`;
const OPEN_KEY = (userId: string, session: string) => `cb:open:${userId}:${session}`;

/**
 * Per-(user, session) circuit breaker for WAHA. Counts failures in a sliding
 * window via INCR+EXPIRE; when the threshold is exceeded the breaker opens
 * for `CIRCUIT_BREAKER_COOLDOWN_MS` and the worker should reject jobs
 * targeting that session.
 */
export async function recordFailure(userId: string, session: string): Promise<{ open: boolean; count: number }> {
  const r = getRedis();
  const k = FAIL_KEY(userId, session);
  const count = await r.incr(k);
  if (count === 1) await r.pexpire(k, config.CIRCUIT_BREAKER_WINDOW_MS);
  if (count >= config.CIRCUIT_BREAKER_THRESHOLD) {
    await r.set(OPEN_KEY(userId, session), '1', 'PX', config.CIRCUIT_BREAKER_COOLDOWN_MS);
    circuitBreakerState.set({ session }, 1);
    logger.warn({ userId, session, count }, '[CircuitBreaker] opened');
    return { open: true, count };
  }
  return { open: false, count };
}

export async function recordSuccess(userId: string, session: string): Promise<void> {
  const r = getRedis();
  await r.del(FAIL_KEY(userId, session));
}

export async function isOpen(userId: string, session: string): Promise<boolean> {
  const r = getRedis();
  const v = await r.get(OPEN_KEY(userId, session));
  return v === '1';
}

export async function resetCircuit(userId: string, session: string): Promise<void> {
  const r = getRedis();
  await r.del(FAIL_KEY(userId, session), OPEN_KEY(userId, session));
  circuitBreakerState.set({ session }, 0);
}
