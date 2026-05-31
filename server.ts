import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { config } from './server/config';
import { logger } from './server/logger';
import { runMigrations } from './server/migrations';
import { migrateLegacyJsonData } from './server/migration-helper';
import authRoutes from './server/auth/routes';
import apiRoutes, { webhookRouter } from './server/routes/api';

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
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false, // SPA + dev Vite friendly; tighten in prod proxy
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
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger, customLogLevel: (req, res) => (res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info') }));

  // Global API rate limit
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

  // Health endpoint (no auth)
  app.get('/api/health', async (_req, res) => {
    res.json({ status: 'ok', service: 'web' });
  });

  // Webhook (no JWT auth — has its own shared-secret check)
  app.use('/api', webhookRouter);

  // Auth routes (rate limited)
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
    logger.info({ port: config.PORT }, '[Boot] Web server listening');
  });
}

startServer().catch((err) => {
  logger.error({ err: err.message }, '[Boot] Fatal startup error');
  process.exit(1);
});
