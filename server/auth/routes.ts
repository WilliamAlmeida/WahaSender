import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import {
  countUsers,
  countLoginCapableUsers,
  createUser,
  verifyPassword,
  signToken,
  changePassword,
} from './service';
import { cookieOptions, requireAuth } from './middleware';
import { revokeJti } from './jwt-blocklist';
import { audit } from '../lib/audit';
import { logger } from '../logger';

const router = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256), // policy enforced inside createUser/changePassword
  name: z.string().min(1).max(120).optional(),
});

router.get('/needs-bootstrap', async (_req, res) => {
  // Only count "real" users (not the legacy claimable placeholder).
  const total = await countLoginCapableUsers();
  res.json({ needsBootstrap: total === 0 });
});

router.post('/register', async (req, res) => {
  try {
    const loginCapable = await countLoginCapableUsers();
    if (loginCapable > 0) {
      return res.status(403).json({ error: 'Registration disabled' });
    }
    const data = credentialsSchema.parse(req.body);

    // If a legacy/claimable user exists with same email, we claim it; otherwise
    // first-ever real user is created and promoted to admin.
    const user = await createUser({ ...data, role: 'admin' });

    const { token, jti } = signToken(user);
    res.cookie(config.COOKIE_NAME, token, cookieOptions());
    await audit({
      userId: user.id,
      action: 'register',
      entityType: 'user',
      entityId: user.id,
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    logger.info({ email: user.email, jti }, '[Auth] First admin created');
    res.json({ user, token });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const data = credentialsSchema.pick({ email: true, password: true }).parse(req.body);
    const user = await verifyPassword(data.email, data.password);
    if (!user) {
      // Total counters covers the bootstrap-but-not-claimed scenario.
      const total = await countUsers();
      if (total === 0) return res.status(404).json({ error: 'No users registered yet' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const { token } = signToken(user);
    res.cookie(config.COOKIE_NAME, token, cookieOptions());
    await audit({
      userId: user.id,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    res.json({ user, token });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(400).json({ error: err.message });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  res.clearCookie(config.COOKIE_NAME, { path: '/' });
  // Revoke the current JWT jti until natural expiration (defense in depth for
  // Bearer-token clients that may keep using it).
  if (req.jti && req.tokenExp) {
    const ttl = req.tokenExp - Math.floor(Date.now() / 1000);
    if (ttl > 0) await revokeJti(req.jti, ttl);
  }
  await audit({
    userId: req.user!.id,
    action: 'logout',
    entityType: 'user',
    entityId: req.user!.id,
    ip: req.ip,
    userAgent: req.get('user-agent') || null,
  });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(1).max(256),
});
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = changePasswordSchema.parse(req.body);
    const ok = await changePassword(req.user!.id, oldPassword, newPassword);
    if (!ok) return res.status(401).json({ error: 'Current password incorrect' });
    // Force re-login by revoking current jti.
    if (req.jti && req.tokenExp) {
      const ttl = req.tokenExp - Math.floor(Date.now() / 1000);
      if (ttl > 0) await revokeJti(req.jti, ttl);
    }
    res.clearCookie(config.COOKIE_NAME, { path: '/' });
    await audit({
      userId: req.user!.id,
      action: 'password-change',
      entityType: 'user',
      entityId: req.user!.id,
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(400).json({ error: err.message });
  }
});

export default router;
