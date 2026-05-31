import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import {
  countUsers,
  createUser,
  verifyPassword,
  signToken,
} from './service';
import { cookieOptions, requireAuth } from './middleware';
import { logger } from '../logger';

const router = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
  name: z.string().min(1).max(120).optional(),
});

router.get('/needs-bootstrap', async (_req, res) => {
  const total = await countUsers();
  res.json({ needsBootstrap: total === 0 });
});

router.post('/register', async (req, res) => {
  try {
    const total = await countUsers();
    if (total > 0) {
      // After bootstrap, registration is closed (admin can extend later).
      return res.status(403).json({ error: 'Registration disabled' });
    }
    const data = credentialsSchema.parse(req.body);
    const user = await createUser(data);
    const token = signToken(user);
    res.cookie(config.COOKIE_NAME, token, cookieOptions());
    logger.info({ email: user.email }, '[Auth] First admin created');
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
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const token = signToken(user);
    res.cookie(config.COOKIE_NAME, token, cookieOptions());
    res.json({ user, token });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(400).json({ error: err.message });
  }
});

router.post('/logout', (_req, res) => {
  res.clearCookie(config.COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
