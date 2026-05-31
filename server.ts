import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { config, parseTrustProxy } from './server/config';
import { logger } from './server/logger';
import { runMigrations } from './server/migrations';
import { migrateLegacyJsonData } from './server/migration-helper';
import authRoutes from './server/auth/routes';
import apiRoutes, { webhookRouter } from './server/routes/api';
import { requireAuth, requireAdmin } from './server/auth/middleware';
import { getCampaignQueue, getSchedulerQueue } from './server/queue';
import { pingRedis } from './server/redis';
import db from './server/db';
import { getMetrics, registry } from './server/lib/metrics';

async function startServer() {
  logger.info({ env: config.NODE_ENV }, '[Boot] Starting web server');

  try {
    await runMigrations();
    await migrateLegacyJsonData();
  } catch (err: any) {
    logger.error({ err: err.message }, '[Boot] Database preparation failed');
    process.exit(1);
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(config.TRUST_PROXY));

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: config.APP_URL,
      credentials: true,
    }),
  );
  app.use(cookieParser());
  // Capture raw body for HMAC verification on the webhook route.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(pinoHttp({
    logger,
    customLogLevel: (_req, res) => (res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
  }));

  // Rate limiters
  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const authLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many auth attempts' },
  });

  // Liveness (no deps)
  app.get('/api/health', async (_req, res) => {
    res.json({ status: 'ok', service: 'web', version: process.env.npm_package_version || 'dev' });
  });

  // Readiness with deep checks
  app.get('/api/health/deep', async (_req, res) => {
    const checks: Record<string, { ok: boolean; error?: string }> = {};
    try {
      await db.raw('SELECT 1');
      checks.db = { ok: true };
    } catch (err: any) {
      checks.db = { ok: false, error: err.message };
    }
    try {
      const ok = await pingRedis();
      checks.redis = { ok };
    } catch (err: any) {
      checks.redis = { ok: false, error: err.message };
    }
    const allOk = Object.values(checks).every((c) => c.ok);
    res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', checks });
  });

  // Prometheus metrics (admin-only)
  if (config.METRICS_ENABLED) {
    app.get('/api/metrics', requireAuth, requireAdmin, async (_req, res) => {
      res.set('Content-Type', registry.contentType);
      res.end(await getMetrics());
    });
  }

  // Bull Board (admin-only)
  if (config.BULL_BOARD_ENABLED) {
    const bullBoardAdapter = new ExpressAdapter();
    bullBoardAdapter.setBasePath('/admin/queues');
    createBullBoard({
      queues: [new BullMQAdapter(getCampaignQueue()), new BullMQAdapter(getSchedulerQueue())],
      serverAdapter: bullBoardAdapter,
    });
    app.use('/admin/queues', requireAuth, requireAdmin, bullBoardAdapter.getRouter());
  }

  // Webhook (no JWT, has its own shared-secret + optional HMAC check)
  app.use('/api', webhookRouter);

  // Auth routes
  app.use('/api/auth', authLimiter, authRoutes);

  // Protected API routes
  app.use('/api', apiLimiter, apiRoutes);

  // Frontend
  if (config.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(config.PORT, '0.0.0.0', () => {
    logger.info({ port: config.PORT, trustProxy: config.TRUST_PROXY }, '[Boot] Web server listening');
  });
}

startServer().catch((err) => {
  logger.error({ err: err.message }, '[Boot] Fatal startup error');
  process.exit(1);
});
