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
  resetPassword,
  markEmailVerified,
  findUserByEmail,
  findUserById,
} from './service';
import { cookieOptions, requireAuth } from './middleware';
import { revokeJti } from './jwt-blocklist';
import { createEmailToken, consumeEmailToken } from './email-tokens';
import { queueVerificationEmail, queuePasswordResetEmail } from '../lib/mailer';
import { assignFreePlan } from '../lib/entitlements';
import { audit } from '../lib/audit';
import { logger } from '../logger';
import { db } from '../db';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TTL_MS = 60 * 60 * 1000; // 1h

async function issueVerification(userId: string, email: string): Promise<void> {
  const raw = await createEmailToken(userId, 'verify', VERIFY_TTL_MS);
  const link = `${config.APP_PUBLIC_URL}/verificar-email?token=${raw}`;
  await queueVerificationEmail(email, link).catch((err) =>
    logger.warn({ err: err.message, email }, '[Auth] verification e-mail queue failed'),
  );
}

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

// Self-service signup. The first login-capable account becomes the platform
// admin (auto-verified); subsequent tenants are 'user', get the Free plan and
// an e-mail verification link.
router.post('/signup', async (req, res) => {
  try {
    const loginCapable = await countLoginCapableUsers();
    const isBootstrap = loginCapable === 0;
    if (!isBootstrap && !config.ENABLE_SIGNUP) {
      return res.status(403).json({ error: 'Cadastro desabilitado' });
    }
    const data = credentialsSchema.parse(req.body);
    const role = isBootstrap ? 'admin' : 'user';
    const user = await createUser({ ...data, role });

    if (isBootstrap) {
      await markEmailVerified(user.id);
    } else {
      await assignFreePlan(user.id);
      await issueVerification(user.id, user.email);
    }

    const { token, jti } = signToken(user);
    res.cookie(config.COOKIE_NAME, token, cookieOptions());
    await audit({
      userId: user.id,
      action: 'register',
      entityType: 'user',
      entityId: user.id,
      metadata: { role, isBootstrap },
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    logger.info({ email: user.email, jti, role }, '[Auth] Account created');
    res.json({ user: { ...user, emailVerified: isBootstrap }, token });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(400).json({ error: err.message });
  }
});

const verifySchema = z.object({ token: z.string().min(10) });
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = verifySchema.parse(req.body);
    const result = await consumeEmailToken(token, 'verify');
    if (!result) return res.status(400).json({ error: 'Token inválido ou expirado' });
    await markEmailVerified(result.userId);
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(400).json({ error: err.message });
  }
});

router.post('/resend-verification', requireAuth, async (req, res) => {
  const user = req.user!;
  if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true });
  await issueVerification(user.id, user.email);
  res.json({ ok: true });
});

const emailSchema = z.object({ email: z.string().email() });
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = emailSchema.parse(req.body);
    const row = await findUserByEmail(email);
    // Always return ok to avoid leaking which e-mails are registered.
    if (row && !row.claimable) {
      const raw = await createEmailToken(row.id, 'reset', RESET_TTL_MS);
      const link = `${config.APP_PUBLIC_URL}/redefinir-senha?token=${raw}`;
      await queuePasswordResetEmail(row.email, link).catch((err) =>
        logger.warn({ err: err.message }, '[Auth] reset e-mail queue failed'),
      );
    }
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(400).json({ error: err.message });
  }
});

const resetSchema = z.object({ token: z.string().min(10), newPassword: z.string().min(1).max(256) });
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = resetSchema.parse(req.body);
    const result = await consumeEmailToken(token, 'reset');
    if (!result) return res.status(400).json({ error: 'Token inválido ou expirado' });
    await resetPassword(result.userId, newPassword);
    const user = await findUserById(result.userId);
    await audit({
      userId: result.userId,
      action: 'password-change',
      entityType: 'user',
      entityId: result.userId,
      metadata: { via: 'reset' },
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    logger.info({ email: user?.email }, '[Auth] Password reset completed');
    res.json({ ok: true });
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
  res.json({ user: req.user, impersonating: !!req.impersonatorId });
});

// Ends an impersonation session: reissues the admin's own token from the `act`
// claim carried by the impersonation token (exposed as req.impersonatorId).
router.post('/stop-impersonate', requireAuth, async (req, res) => {
  if (!req.impersonatorId) {
    return res.status(400).json({ error: 'Não está em modo de impersonação' });
  }
  const admin = await findUserById(req.impersonatorId);
  if (!admin) return res.status(401).json({ error: 'Admin de origem não encontrado' });
  const targetId = req.user!.id;
  const { token } = signToken(admin);
  res.cookie(config.COOKIE_NAME, token, cookieOptions());
  await audit({
    userId: admin.id,
    action: 'impersonate-stop',
    entityType: 'user',
    entityId: targetId,
    ip: req.ip,
    userAgent: req.get('user-agent') || null,
  });
  res.json({ user: admin });
});

const profileSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
});
router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const { name, email } = profileSchema.parse(req.body);
    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name.trim();
    if (email !== undefined) {
      const normalized = email.toLowerCase().trim();
      if (normalized !== req.user!.email) {
        const taken = await findUserByEmail(normalized);
        if (taken && taken.id !== req.user!.id) {
          return res.status(409).json({ error: 'E-mail já está em uso' });
        }
        updates.email = normalized;
        updates.emailVerifiedAt = null;
      }
    }
    if (Object.keys(updates).length === 0) return res.json({ user: req.user });
    await db('users').where({ id: req.user!.id }).update(updates);
    const updated = await findUserById(req.user!.id);
    await audit({ userId: req.user!.id, action: 'update', entityType: 'user', entityId: req.user!.id, metadata: { fields: Object.keys(updates) } as any, ip: req.ip });
    res.json({ user: updated });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(400).json({ error: err.message });
  }
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
