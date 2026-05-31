// Vitest global setup: forces a sane test env BEFORE config validation runs.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-prod-1234';
process.env.DB_CLIENT = 'sqlite3';
// Use a per-process file so parallel test files do not stomp each other.
// `:memory:` is per-connection, which Knex's pool would break.
import os from 'os';
import path from 'path';
const tmpDb = path.join(os.tmpdir(), `wahasender-test-${process.pid}.sqlite`);
process.env.DB_FILE = tmpDb;
process.env.REDIS_HOST = '127.0.0.1';
process.env.REDIS_PORT = '6379';
process.env.STORAGE_TYPE = 'local';
process.env.STORAGE_LOCAL_DIR = 'storage/uploads-test';
process.env.UPLOAD_MAX_BYTES = '5242880';
process.env.APP_URL = 'http://localhost:3000';
process.env.PASSWORD_MIN_LENGTH = '8';
process.env.PASSWORD_REQUIRE_COMPLEXITY = 'false';

// Remove any leftover DB from previous runs of this process slot.
import fs from 'fs';
try {
  fs.unlinkSync(tmpDb);
} catch {
  /* not present */
}

import { vi, afterAll } from 'vitest';

// Mock ioredis with an in-memory implementation so JWT blocklist, circuit
// breaker and similar primitives work without a real Redis.
vi.mock('ioredis', async () => {
  const RedisMock = (await import('ioredis-mock')).default;
  return { default: RedisMock };
});

afterAll(() => {
  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* */
  }
});

