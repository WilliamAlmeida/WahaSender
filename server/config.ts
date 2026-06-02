import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Docker / K8s secrets convention: any env var with suffix `_FROM_FILE`
 * pointing to a file path will be read and its contents will populate the
 * corresponding env var without the suffix (e.g. `JWT_SECRET_FROM_FILE` ->
 * `JWT_SECRET`). File contents win over an inline env value when both are set.
 *
 * Note: avoid `_FILE` because that suffix is commonly used for non-secret
 * config like `DB_FILE` (sqlite path) and would conflict.
 */
function applySecretFiles(): void {
  for (const key of Object.keys(process.env)) {
    if (!key.endsWith('_FROM_FILE')) continue;
    const target = key.slice(0, -'_FROM_FILE'.length);
    const file = process.env[key];
    if (!file) continue;
    try {
      const value = fs.readFileSync(file, 'utf-8').trim();
      if (value) process.env[target] = value;
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn(`[Config] Could not read secret file for ${target} (${file}): ${err.message}`);
    }
  }
}

applySecretFiles();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),

  TRUST_PROXY: z.string().default('loopback'),

  DB_CLIENT: z.enum(['sqlite3', 'pg']).default('sqlite3'),
  DB_FILE: z.string().optional(),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('password'),
  DB_DATABASE: z.string().default('waha_sender'),
  DB_SSL: z.coerce.boolean().default(false),
  DB_POOL_MIN: z.coerce.number().int().min(0).default(2),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),

  STORAGE_TYPE: z.enum(['local', 's3']).default('local'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_BUCKET: z.string().optional(),
  AWS_ENDPOINT: z.string().optional(),

  JWT_SECRET: z.string().min(16).default('change-me-please-change-me-please'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  COOKIE_NAME: z.string().default('waha_session'),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(128).default(10),
  PASSWORD_REQUIRE_COMPLEXITY: z.coerce.boolean().default(true),

  WAHA_WEBHOOK_SECRET: z.string().optional(),
  WAHA_WEBHOOK_HMAC: z.coerce.boolean().default(false),

  BULL_BOARD_ENABLED: z.coerce.boolean().default(true),
  METRICS_ENABLED: z.coerce.boolean().default(true),

  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),

  CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(5),
  CIRCUIT_BREAKER_WINDOW_MS: z.coerce.number().int().positive().default(300_000),
  CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce.number().int().positive().default(900_000),

  GEMINI_API_KEY: z.string().optional(),

  // --- SaaS: self-service, e-mail and billing ---
  // Public URL used to build links in transactional e-mails (verify/reset/checkout return).
  APP_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  // Toggle open registration (self-service signup). Bootstrap admin works regardless.
  ENABLE_SIGNUP: z.coerce.boolean().default(true),
  // Require a verified e-mail before a tenant can start sending campaigns.
  REQUIRE_EMAIL_VERIFICATION: z.coerce.boolean().default(false),

  // Transactional e-mail (SMTP). When MAIL_HOST is unset, e-mails are logged to
  // the console instead of being sent (handy for local/dev).
  MAIL_HOST: z.string().optional(),
  MAIL_PORT: z.coerce.number().int().positive().default(587),
  MAIL_SECURE: z.coerce.boolean().default(false),
  MAIL_USER: z.string().optional(),
  MAIL_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('WahaSender <no-reply@wahasender.local>'),

  // Mercado Pago billing. Without MP_ACCESS_TOKEN, checkout runs in mock mode.
  MP_ACCESS_TOKEN: z.string().optional(),
  MP_PUBLIC_KEY: z.string().optional(),
  MP_WEBHOOK_SECRET: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`[Config] Invalid environment variables:\n${errors}`);
    throw new Error('Invalid environment configuration');
  }
  cached = parsed.data;

  if (cached.NODE_ENV === 'production' && cached.JWT_SECRET.startsWith('change-me')) {
    throw new Error('[Config] JWT_SECRET must be set to a strong value in production');
  }

  return cached;
}

export const config = loadConfig();

/**
 * Parses TRUST_PROXY into the value Express expects.
 *   loopback / linklocal / uniquelocal — pass through as strings
 *   "true"/"false" — boolean
 *   integer — number of hops
 *   comma-list of IPs/CIDRs — array
 */
export function parseTrustProxy(input: string): boolean | number | string | string[] {
  const v = (input || '').trim();
  if (!v) return 'loopback';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  if (v.includes(',')) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return v;
}

export default config;
