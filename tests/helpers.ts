/**
 * Builds a minimal Express app that mounts auth + api routes for integration
 * tests. Skips rate-limit, pino-http, helmet etc. to keep tests focused.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import authRoutes from '../server/auth/routes';
import apiRoutes, { webhookRouter } from '../server/routes/api';
import { runMigrations } from '../server/migrations';
import db from '../server/db';

let initialized = false;

export async function buildTestApp() {
  if (!initialized) {
    await runMigrations();
    initialized = true;
  }
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(cookieParser());
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use('/api/auth', authRoutes);
  app.use('/api', webhookRouter);
  app.use('/api', apiRoutes);
  return app;
}

export async function resetDb() {
  // Truncate user-scoped tables in a safe order (sqlite in-memory).
  const tables = [
    'message_status',
    'campaign_logs',
    'campaign_pending_contacts',
    'campaigns',
    'group_contacts',
    'groups',
    'contacts',
    'api_tokens',
    'outbound_webhooks',
    'templates',
    'audit_log',
    'settings',
    'users',
  ];
  for (const t of tables) {
    try {
      await db(t).delete();
    } catch {
      /* table may not exist yet */
    }
  }
}

export function extractCookie(setCookieHeader: string | string[] | undefined) {
  if (!setCookieHeader) return '';
  const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  // Match auth cookie regardless of configured name
  const token = list.find((c) => /^(waha_session|token)=/.test(c));
  return token ? token.split(';')[0] : '';
}
