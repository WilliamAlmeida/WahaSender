import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import db from '../db';
import { config } from '../config';
import { validatePassword } from './password-policy';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  jti: string;
  exp?: number;
  iat?: number;
}

const ROW_TO_USER = (row: any): AuthUser => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role || 'user',
});

export async function countUsers(): Promise<number> {
  const r = await db('users').count({ c: '*' }).first();
  return Number(r?.c || 0);
}

export async function countLoginCapableUsers(): Promise<number> {
  const r = await db('users').where('claimable', false).count({ c: '*' }).first();
  return Number(r?.c || 0);
}

export async function findUserByEmail(email: string): Promise<any> {
  return db('users').where({ email: email.toLowerCase().trim() }).first();
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  const row = await db('users').where({ id }).first();
  if (!row) return null;
  return ROW_TO_USER(row);
}

export async function createUser(input: {
  email: string;
  password: string;
  name?: string | null;
  role?: string;
}): Promise<AuthUser> {
  const email = input.email.toLowerCase().trim();
  const existing = await findUserByEmail(email);
  if (existing && !existing.claimable) throw new Error('E-mail already registered');

  const policy = validatePassword(input.password);
  if (!policy.ok) throw new Error((policy as { reason: string }).reason);

  const passwordHash = await bcrypt.hash(input.password, 12);

  if (existing && existing.claimable) {
    // Claim the legacy slot: keep the id so all FKs remain valid.
    await db('users').where({ id: existing.id }).update({
      passwordHash,
      name: input.name || existing.name,
      role: input.role || 'admin',
      claimable: false,
    });
    return ROW_TO_USER({ ...existing, passwordHash, name: input.name || existing.name, role: input.role || 'admin', claimable: false });
  }

  const id = crypto.randomUUID();
  await db('users').insert({
    id,
    email,
    passwordHash,
    name: input.name || null,
    role: input.role || 'user',
    claimable: false,
    createdAt: new Date(),
  });
  return { id, email, name: input.name || null, role: input.role || 'user' };
}

export async function verifyPassword(email: string, password: string): Promise<AuthUser | null> {
  const row = await findUserByEmail(email);
  if (!row || row.claimable) return null;
  const ok = await bcrypt.compare(password, row.passwordHash);
  if (!ok) return null;
  await db('users').where({ id: row.id }).update({ lastLoginAt: new Date() });
  return ROW_TO_USER(row);
}

export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
): Promise<boolean> {
  const row = await db('users').where({ id: userId }).first();
  if (!row) return false;
  const ok = await bcrypt.compare(oldPassword, row.passwordHash);
  if (!ok) return false;
  const policy = validatePassword(newPassword);
  if (!policy.ok) throw new Error((policy as { reason: string }).reason);
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db('users').where({ id: userId }).update({ passwordHash });
  return true;
}

export function signToken(user: AuthUser): { token: string; jti: string; expiresInSec: number } {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: user.id, email: user.email, jti }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as any,
  });
  const decoded = jwt.decode(token) as JwtPayload | null;
  const expiresInSec = decoded?.exp ? Math.max(0, decoded.exp - Math.floor(Date.now() / 1000)) : 7 * 24 * 3600;
  return { token, jti, expiresInSec };
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    if (!decoded?.sub) return null;
    return decoded;
  } catch {
    return null;
  }
}
