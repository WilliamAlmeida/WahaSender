import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import db from '../db';
import { config } from '../config';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export async function countUsers(): Promise<number> {
  const r = await db('users').count({ c: '*' }).first();
  return Number(r?.c || 0);
}

export async function findUserByEmail(email: string): Promise<any> {
  return db('users').where({ email: email.toLowerCase().trim() }).first();
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  const row = await db('users').where({ id }).first();
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name };
}

export async function createUser(input: {
  email: string;
  password: string;
  name?: string | null;
}): Promise<AuthUser> {
  const email = input.email.toLowerCase().trim();
  const existing = await findUserByEmail(email);
  if (existing) throw new Error('E-mail already registered');

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(input.password, 12);
  await db('users').insert({
    id,
    email,
    passwordHash,
    name: input.name || null,
    createdAt: new Date(),
  });
  return { id, email, name: input.name || null };
}

export async function verifyPassword(email: string, password: string): Promise<AuthUser | null> {
  const row = await findUserByEmail(email);
  if (!row) return null;
  const ok = await bcrypt.compare(password, row.passwordHash);
  if (!ok) return null;
  await db('users').where({ id: row.id }).update({ lastLoginAt: new Date() });
  return { id: row.id, email: row.email, name: row.name };
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, email: user.email }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as any,
  });
}

export function verifyToken(token: string): { sub: string; email: string } | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as any;
    if (!decoded?.sub) return null;
    return { sub: decoded.sub, email: decoded.email };
  } catch {
    return null;
  }
}
