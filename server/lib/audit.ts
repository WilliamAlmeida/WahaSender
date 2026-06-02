import db from '../db';
import { logger } from '../logger';

export type AuditAction =
  | 'create' | 'update' | 'delete' | 'delete-all' | 'restore'
  | 'login' | 'logout' | 'register' | 'password-change'
  | 'campaign.start' | 'campaign.pause' | 'campaign.resume'
  | 'token.create' | 'token.revoke';

export interface AuditEntry {
  userId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Append an audit log row. Best-effort: never throws to the caller — errors
 * are logged and swallowed because audit should not block business flow.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db('audit_log').insert({
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId || null,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      ip: entry.ip || null,
      userAgent: entry.userAgent || null,
      createdAt: new Date(),
    });
  } catch (err: any) {
    logger.warn({ err: err.message, action: entry.action }, '[Audit] write failed');
  }
}
