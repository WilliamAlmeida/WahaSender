import IORedis from 'ioredis';
import { config } from './config';
import { logger } from './logger';

let client: IORedis | null = null;

/**
 * Lazy ioredis client used for app-level concerns (JWT blocklist, circuit
 * breaker) outside of BullMQ. We never share this with BullMQ to keep type
 * boundaries clean.
 */
export function getRedis(): IORedis {
  if (client) return client;
  client = new IORedis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD,
    db: config.REDIS_DB,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    lazyConnect: true,
  });
  client.on('error', (err) => logger.warn({ err: err.message }, '[Redis] error'));
  // Best-effort connect; callers that need it should await pingRedis().
  client.connect().catch(() => undefined);
  return client;
}

export async function pingRedis(): Promise<boolean> {
  try {
    const r = getRedis();
    const pong = await r.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    /* noop */
  }
  client = null;
}
