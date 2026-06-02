import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import db from '../db';
import { config } from '../config';
import { findUserById, verifyToken, AuthUser } from './service';
import { isJtiRevoked } from './jwt-blocklist';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    authMethod?: 'jwt' | 'api-token';
    jti?: string;
    tokenExp?: number;
    impersonatorId?: string;
  }
}

function extractToken(req: Request): string | null {
  const cookieToken = (req as any).cookies?.[config.COOKIE_NAME];
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  return null;
}

function extractApiToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('ApiKey ')) {
    return header.slice('ApiKey '.length).trim();
  }
  const xkey = req.headers['x-api-token'];
  if (typeof xkey === 'string' && xkey) return xkey;
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // 1) Try API token first (machine-to-machine)
  const apiToken = extractApiToken(req);
  if (apiToken) {
    try {
      const hash = crypto.createHash('sha256').update(apiToken).digest('hex');
      const row = await db('api_tokens').where({ hashedToken: hash }).whereNull('revokedAt').first();
      if (!row) return res.status(401).json({ error: 'Invalid API token' });
      if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
        return res.status(401).json({ error: 'API token expired' });
      }
      const user = await findUserById(row.userId);
      if (!user) return res.status(401).json({ error: 'User not found' });
      if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });
      req.user = user;
      req.authMethod = 'api-token';
      // best-effort lastUsedAt
      db('api_tokens').where({ id: row.id }).update({ lastUsedAt: new Date() }).catch(() => undefined);
      return next();
    } catch (err: any) {
      return res.status(401).json({ error: 'API token error' });
    }
  }

  // 2) JWT (cookie or Bearer)
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid token' });
  if (await isJtiRevoked(decoded.jti)) {
    return res.status(401).json({ error: 'Token revoked' });
  }
  const user = await findUserById(decoded.sub);
  if (!user) return res.status(401).json({ error: 'User not found' });
  if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });
  req.user = user;
  req.authMethod = 'jwt';
  req.jti = decoded.jti;
  req.tokenExp = decoded.exp;
  if (decoded.act) req.impersonatorId = decoded.act;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

/**
 * Guards actions that require a verified e-mail when
 * REQUIRE_EMAIL_VERIFICATION is enabled. Admins and API-token clients bypass.
 */
export function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
  if (!config.REQUIRE_EMAIL_VERIFICATION) return next();
  if (req.authMethod === 'api-token') return next();
  if (req.user && (req.user.emailVerified || req.user.role === 'admin')) return next();
  return res.status(403).json({ error: 'E-mail não verificado', code: 'email_unverified' });
}

/** For webhooks etc — checks a static shared secret instead of JWT. */
export function requireWebhookSecret(secretEnvValue: string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!secretEnvValue) {
      return res.status(503).json({ error: 'Webhook secret not configured' });
    }
    const provided = req.header('X-Webhook-Secret');
    if (provided !== secretEnvValue) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }
    next();
  };
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}
