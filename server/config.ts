import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Database
  DB_CLIENT: z.enum(['sqlite3', 'pg']).default('sqlite3'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('password'),
  DB_DATABASE: z.string().default('waha_sender'),
  DB_SSL: z.coerce.boolean().default(false),
  DB_POOL_MIN: z.coerce.number().int().min(0).default(2),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),

  // Redis (BullMQ)
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),

  // Worker
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),

  // Storage
  STORAGE_TYPE: z.enum(['local', 's3']).default('local'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_BUCKET: z.string().optional(),
  AWS_ENDPOINT: z.string().optional(),

  // Auth
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters').default('change-me-please-change-me-please'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  COOKIE_NAME: z.string().default('waha_session'),
  COOKIE_SECURE: z.coerce.boolean().default(false),

  // Webhook
  WAHA_WEBHOOK_SECRET: z.string().optional(),

  // Upload
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),

  // Optional integrations
  GEMINI_API_KEY: z.string().optional(),
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
export default config;
