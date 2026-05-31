import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { findUserById, verifyToken, AuthUser } from './service';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
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

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid token' });
  const user = await findUserById(decoded.sub);
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
  next();
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
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  };
}
