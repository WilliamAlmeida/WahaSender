import type { ConnectionOptions } from 'bullmq';
import { config } from '../config';

/**
 * Returns plain ioredis connection options (host/port/password/db) to pass to
 * BullMQ. We deliberately do NOT share an external ioredis instance because
 * BullMQ bundles its own ioredis version which clashes at the type level.
 */
export function getConnectionOptions(): ConnectionOptions {
  return {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD,
    db: config.REDIS_DB,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
