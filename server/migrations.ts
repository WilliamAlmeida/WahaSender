import crypto from 'crypto';
import bcrypt from 'bcrypt';
import db, { isSqliteDb } from './db';
import { logger } from './logger';

const LEGACY_EMAIL = 'legacy@local';

/**
 * Returns the id of a "legacy" user used as default owner for data created
 * before authentication existed. Created on demand and flagged as
 * `claimable=true` so the first registration with this email atomically
 * claims ownership of all legacy rows.
 */
export async function ensureLegacyUserId(): Promise<string> {
  const existing = await db('users').where({ email: LEGACY_EMAIL }).first();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
  await db('users').insert({
    id,
    email: LEGACY_EMAIL,
    passwordHash,
    name: 'Legacy Owner',
    role: 'admin',
    claimable: true,
    createdAt: new Date(),
  });
  logger.warn(
    { email: LEGACY_EMAIL },
    '[Migrations] Created legacy owner user. Register at /api/auth/register with this email to claim all legacy data.',
  );
  return id;
}

export async function runMigrations(): Promise<void> {
  logger.info('[Migrations] Running database migrations...');

  // ---------------------------------------------------------------------------
  // BASE TABLES (kept idempotent)
  // ---------------------------------------------------------------------------

  if (!(await db.schema.hasTable('settings'))) {
    await db.schema.createTable('settings', (table) => {
      table.increments('id').primary();
      table.string('wahaUrl').defaultTo('');
      table.string('apiKey').defaultTo('');
      table.timestamps(true, true);
    });
    logger.info('[Migrations] Created table "settings"');
  }

  if (!(await db.schema.hasTable('contacts'))) {
    await db.schema.createTable('contacts', (table) => {
      table.string('id').primary();
      table.string('name').nullable();
      table.string('phone').notNullable().unique();
      table.boolean('blacklisted').defaultTo(false);
      table.timestamp('createdAt').defaultTo(db.fn.now());
    });
    logger.info('[Migrations] Created table "contacts"');
  }

  if (!(await db.schema.hasTable('groups'))) {
    await db.schema.createTable('groups', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.timestamp('createdAt').defaultTo(db.fn.now());
    });
    logger.info('[Migrations] Created table "groups"');
  }

  if (!(await db.schema.hasTable('group_contacts'))) {
    await db.schema.createTable('group_contacts', (table) => {
      table.string('groupId').notNullable().references('id').inTable('groups').onDelete('CASCADE');
      table.string('contactId').notNullable().references('id').inTable('contacts').onDelete('CASCADE');
      table.primary(['groupId', 'contactId']);
    });
    logger.info('[Migrations] Created table "group_contacts"');
  }

  if (!(await db.schema.hasTable('campaigns'))) {
    await db.schema.createTable('campaigns', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.string('groupId').nullable().references('id').inTable('groups').onDelete('SET NULL');
      table.string('groupName').nullable();
      table.text('sessions').notNullable();
      table.timestamp('startTime').notNullable();
      table.timestamp('endTime').nullable();
      table.text('schedules').nullable();
      table.integer('intervalMin').defaultTo(30);
      table.integer('intervalMax').defaultTo(60);
      table.string('distributionMethod').defaultTo('round_robin');
      table.text('templates').notNullable();
      table.string('status').defaultTo('Draft');
      table.integer('totalContacts').defaultTo(0);
      table.integer('sent').defaultTo(0);
      table.integer('failed').defaultTo(0);
      table.timestamp('nextSendTime').nullable();
      table.timestamp('createdAt').defaultTo(db.fn.now());
    });
    logger.info('[Migrations] Created table "campaigns"');
  }

  if (!(await db.schema.hasTable('campaign_pending_contacts'))) {
    await db.schema.createTable('campaign_pending_contacts', (table) => {
      table.string('campaignId').notNullable().references('id').inTable('campaigns').onDelete('CASCADE');
      table.string('contactId').notNullable().references('id').inTable('contacts').onDelete('CASCADE');
      table.boolean('paused').defaultTo(false);
      table.primary(['campaignId', 'contactId']);
    });
    logger.info('[Migrations] Created table "campaign_pending_contacts"');
  }

  if (!(await db.schema.hasTable('campaign_logs'))) {
    await db.schema.createTable('campaign_logs', (table) => {
      table.increments('id').primary();
      table.string('campaignId').notNullable().references('id').inTable('campaigns').onDelete('CASCADE');
      table.text('log').notNullable();
      table.timestamp('createdAt').defaultTo(db.fn.now());
    });
    logger.info('[Migrations] Created table "campaign_logs"');
  }

  // ---------------------------------------------------------------------------
  // HARDENING — users, multi-tenant ownership, status tracking, indexes
  // ---------------------------------------------------------------------------

  if (!(await db.schema.hasTable('users'))) {
    await db.schema.createTable('users', (table) => {
      table.string('id').primary();
      table.string('email').notNullable().unique();
      table.string('passwordHash').notNullable();
      table.string('name').nullable();
      table.timestamp('createdAt').defaultTo(db.fn.now());
      table.timestamp('lastLoginAt').nullable();
    });
    logger.info('[Migrations] Created table "users"');
  }

  const ensureColumn = async (
    table: string,
    column: string,
    add: (t: any) => void,
  ): Promise<void> => {
    const exists = await db.schema.hasColumn(table, column);
    if (exists) return;
    try {
      await db.schema.alterTable(table, add);
      logger.info(`[Migrations] Added column ${table}.${column}`);
    } catch (err: any) {
      // Tolerate concurrent migrations or driver quirks reporting a duplicate
      // column right after hasColumn returned false (Knex sqlite race).
      if (/duplicate column/i.test(err?.message || '')) return;
      throw err;
    }
  };

  await ensureColumn('contacts', 'userId', (t) => {
    t.string('userId').nullable().references('id').inTable('users').onDelete('CASCADE');
  });
  await ensureColumn('groups', 'userId', (t) => {
    t.string('userId').nullable().references('id').inTable('users').onDelete('CASCADE');
  });
  await ensureColumn('campaigns', 'userId', (t) => {
    t.string('userId').nullable().references('id').inTable('users').onDelete('CASCADE');
  });
  await ensureColumn('settings', 'userId', (t) => {
    t.string('userId').nullable().references('id').inTable('users').onDelete('CASCADE');
  });

  await ensureColumn('campaign_pending_contacts', 'order', (t) => {
    t.integer('order').defaultTo(0);
  });
  await ensureColumn('campaign_pending_contacts', 'enqueuedJobId', (t) => {
    t.string('enqueuedJobId').nullable();
  });

  await ensureColumn('campaign_logs', 'contactId', (t) => {
    t.string('contactId').nullable();
  });
  await ensureColumn('campaign_logs', 'status', (t) => {
    t.string('status').nullable();
  });

  // Backfill ownership if there are rows without userId.
  const orphanContacts = await db('contacts').whereNull('userId').count({ c: '*' }).first();
  const orphanGroups = await db('groups').whereNull('userId').count({ c: '*' }).first();
  const orphanCampaigns = await db('campaigns').whereNull('userId').count({ c: '*' }).first();
  const orphanSettings = await db('settings').whereNull('userId').count({ c: '*' }).first();
  const needBackfill =
    Number(orphanContacts?.c || 0) +
      Number(orphanGroups?.c || 0) +
      Number(orphanCampaigns?.c || 0) +
      Number(orphanSettings?.c || 0) >
    0;
  if (needBackfill) {
    const legacyId = await ensureLegacyUserId();
    await db('contacts').whereNull('userId').update({ userId: legacyId });
    await db('groups').whereNull('userId').update({ userId: legacyId });
    await db('campaigns').whereNull('userId').update({ userId: legacyId });
    await db('settings').whereNull('userId').update({ userId: legacyId });
    logger.info({ legacyId }, '[Migrations] Backfilled userId on legacy rows');
  }

  if (!(await db.schema.hasTable('message_status'))) {
    await db.schema.createTable('message_status', (table) => {
      table.increments('id').primary();
      table.string('campaignId').notNullable().references('id').inTable('campaigns').onDelete('CASCADE');
      table.string('contactId').nullable();
      table.string('wahaMessageId').nullable();
      table.string('session').nullable();
      table.string('status').notNullable(); // queued, sent, delivered, read, failed
      table.text('errorMessage').nullable();
      table.timestamp('createdAt').defaultTo(db.fn.now());
      table.timestamp('updatedAt').defaultTo(db.fn.now());
      table.index(['campaignId']);
      table.index(['wahaMessageId']);
    });
    logger.info('[Migrations] Created table "message_status"');
  }

  // ---------------------------------------------------------------------------
  // INDEXES (idempotent)
  // ---------------------------------------------------------------------------
  const safeIndex = async (name: string, fn: () => Promise<any>) => {
    try {
      await fn();
      logger.info(`[Migrations] Ensured index ${name}`);
    } catch (err: any) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('already exists') || msg.includes('duplicate') || msg.includes('exists')) {
        return;
      }
      logger.warn({ err: msg, name }, '[Migrations] Index creation skipped');
    }
  };

  await safeIndex('idx_contacts_userId', () =>
    db.schema.alterTable('contacts', (t) => t.index(['userId'], 'idx_contacts_userId')),
  );
  await safeIndex('idx_contacts_phone', () =>
    db.schema.alterTable('contacts', (t) => t.index(['phone'], 'idx_contacts_phone')),
  );
  await safeIndex('idx_groups_userId', () =>
    db.schema.alterTable('groups', (t) => t.index(['userId'], 'idx_groups_userId')),
  );
  await safeIndex('idx_campaigns_userId', () =>
    db.schema.alterTable('campaigns', (t) => t.index(['userId'], 'idx_campaigns_userId')),
  );
  await safeIndex('idx_campaigns_status', () =>
    db.schema.alterTable('campaigns', (t) => t.index(['status'], 'idx_campaigns_status')),
  );
  await safeIndex('idx_campaigns_nextSendTime', () =>
    db.schema.alterTable('campaigns', (t) => t.index(['nextSendTime'], 'idx_campaigns_nextSendTime')),
  );
  await safeIndex('idx_pending_campaign_paused', () =>
    db.schema.alterTable('campaign_pending_contacts', (t) =>
      t.index(['campaignId', 'paused', 'order'], 'idx_pending_campaign_paused'),
    ),
  );
  await safeIndex('idx_logs_campaignId', () =>
    db.schema.alterTable('campaign_logs', (t) => t.index(['campaignId'], 'idx_logs_campaignId')),
  );
  await safeIndex('idx_logs_contactId', () =>
    db.schema.alterTable('campaign_logs', (t) => t.index(['contactId'], 'idx_logs_contactId')),
  );
  await safeIndex('idx_logs_createdAt', () =>
    db.schema.alterTable('campaign_logs', (t) => t.index(['createdAt'], 'idx_logs_createdAt')),
  );

  // SQLite cannot cheaply ALTER existing UNIQUE constraints. Per-user phone
  // uniqueness is enforced at application layer using userId + phone.
  void isSqliteDb;

  // ---------------------------------------------------------------------------
  // v2.1 — audit, soft-delete, api tokens, templates, outbound webhooks, etc.
  // ---------------------------------------------------------------------------

  await ensureColumn('users', 'claimable', (t) => {
    t.boolean('claimable').defaultTo(false);
  });
  await ensureColumn('users', 'role', (t) => {
    t.string('role').defaultTo('user');
  });

  // Soft-delete columns
  await ensureColumn('contacts', 'deletedAt', (t) => {
    t.timestamp('deletedAt').nullable();
  });
  await ensureColumn('groups', 'deletedAt', (t) => {
    t.timestamp('deletedAt').nullable();
  });
  await ensureColumn('campaigns', 'deletedAt', (t) => {
    t.timestamp('deletedAt').nullable();
  });

  // Per-contact scheduling (drip / staggered campaigns)
  await ensureColumn('campaign_pending_contacts', 'scheduledAt', (t) => {
    t.timestamp('scheduledAt').nullable();
  });

  // Background queue generation for large campaigns
  await ensureColumn('campaigns', 'generatingPendingContacts', (t) => {
    t.boolean('generatingPendingContacts').defaultTo(false);
  });

  if (!(await db.schema.hasTable('audit_log'))) {
    await db.schema.createTable('audit_log', (table) => {
      table.increments('id').primary();
      table.string('userId').nullable();
      table.string('action').notNullable();
      table.string('entityType').notNullable();
      table.string('entityId').nullable();
      table.text('metadata').nullable();
      table.string('ip').nullable();
      table.string('userAgent').nullable();
      table.timestamp('createdAt').defaultTo(db.fn.now());
      table.index(['userId']);
      table.index(['entityType', 'entityId']);
      table.index(['createdAt']);
    });
    logger.info('[Migrations] Created table "audit_log"');
  }

  if (!(await db.schema.hasTable('api_tokens'))) {
    await db.schema.createTable('api_tokens', (table) => {
      table.string('id').primary();
      table.string('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('name').notNullable();
      table.string('hashedToken').notNullable().unique();
      table.string('prefix').notNullable(); // first 8 chars to display
      table.text('scopes').defaultTo('[]');
      table.timestamp('lastUsedAt').nullable();
      table.timestamp('expiresAt').nullable();
      table.timestamp('createdAt').defaultTo(db.fn.now());
      table.timestamp('revokedAt').nullable();
      table.index(['userId']);
    });
    logger.info('[Migrations] Created table "api_tokens"');
  }

  if (!(await db.schema.hasTable('templates'))) {
    await db.schema.createTable('templates', (table) => {
      table.string('id').primary();
      table.string('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('name').notNullable();
      table.text('body').notNullable();
      table.text('variables').defaultTo('[]');
      table.timestamp('createdAt').defaultTo(db.fn.now());
      table.timestamp('updatedAt').defaultTo(db.fn.now());
      table.timestamp('deletedAt').nullable();
      table.index(['userId']);
    });
    logger.info('[Migrations] Created table "templates"');
  }

  if (!(await db.schema.hasTable('outbound_webhooks'))) {
    await db.schema.createTable('outbound_webhooks', (table) => {
      table.string('id').primary();
      table.string('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('event').notNullable();
      table.string('url').notNullable();
      table.string('secret').nullable();
      table.boolean('active').defaultTo(true);
      table.timestamp('createdAt').defaultTo(db.fn.now());
      table.index(['userId', 'event']);
    });
    logger.info('[Migrations] Created table "outbound_webhooks"');
  }

  // ---------------------------------------------------------------------------
  // v3.0 — SaaS: self-service accounts, plans, subscriptions, usage & billing
  // ---------------------------------------------------------------------------

  // Account lifecycle columns
  await ensureColumn('users', 'emailVerifiedAt', (t) => {
    t.timestamp('emailVerifiedAt').nullable();
  });
  await ensureColumn('users', 'status', (t) => {
    t.string('status').defaultTo('active'); // active | suspended
  });

  // Single-use tokens for e-mail verification and password reset.
  if (!(await db.schema.hasTable('email_tokens'))) {
    await db.schema.createTable('email_tokens', (table) => {
      table.string('id').primary();
      table.string('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('type').notNullable(); // verify | reset
      table.string('tokenHash').notNullable().unique();
      table.timestamp('expiresAt').notNullable();
      table.timestamp('usedAt').nullable();
      table.timestamp('createdAt').defaultTo(db.fn.now());
      table.index(['userId', 'type']);
    });
    logger.info('[Migrations] Created table "email_tokens"');
  }

  // Catalog of subscription plans (limits + price). Seeded below if empty.
  if (!(await db.schema.hasTable('plans'))) {
    await db.schema.createTable('plans', (table) => {
      table.string('id').primary();
      table.string('slug').notNullable().unique();
      table.string('name').notNullable();
      table.integer('priceCents').notNullable().defaultTo(0);
      table.string('currency').notNullable().defaultTo('BRL');
      table.integer('monthlyMessageQuota').notNullable().defaultTo(0); // -1 = unlimited
      table.integer('maxContacts').notNullable().defaultTo(0); // -1 = unlimited
      table.integer('maxSessions').notNullable().defaultTo(1);
      table.integer('maxCampaigns').notNullable().defaultTo(0); // -1 = unlimited
      table.text('features').defaultTo('[]');
      table.string('mpPlanId').nullable();
      table.boolean('active').defaultTo(true);
      table.integer('sortOrder').defaultTo(0);
      table.timestamp('createdAt').defaultTo(db.fn.now());
    });
    logger.info('[Migrations] Created table "plans"');
  }

  // One active subscription per user links them to a plan.
  if (!(await db.schema.hasTable('subscriptions'))) {
    await db.schema.createTable('subscriptions', (table) => {
      table.string('id').primary();
      table.string('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('planId').notNullable().references('id').inTable('plans');
      table.string('status').notNullable().defaultTo('active'); // trialing|active|past_due|canceled
      table.string('provider').nullable(); // mercadopago
      table.string('providerSubscriptionId').nullable();
      table.timestamp('currentPeriodStart').nullable();
      table.timestamp('currentPeriodEnd').nullable();
      table.boolean('cancelAtPeriodEnd').defaultTo(false);
      table.timestamp('createdAt').defaultTo(db.fn.now());
      table.timestamp('updatedAt').defaultTo(db.fn.now());
      table.index(['userId']);
      table.index(['status']);
    });
    logger.info('[Migrations] Created table "subscriptions"');
  }

  // Monthly usage counters per tenant (period = YYYY-MM).
  if (!(await db.schema.hasTable('usage_counters'))) {
    await db.schema.createTable('usage_counters', (table) => {
      table.increments('id').primary();
      table.string('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('period').notNullable(); // YYYY-MM
      table.integer('messagesSent').notNullable().defaultTo(0);
      table.timestamp('updatedAt').defaultTo(db.fn.now());
      table.unique(['userId', 'period']);
      table.index(['userId']);
    });
    logger.info('[Migrations] Created table "usage_counters"');
  }

  // Payment / invoice records produced by the billing provider.
  if (!(await db.schema.hasTable('payments'))) {
    await db.schema.createTable('payments', (table) => {
      table.string('id').primary();
      table.string('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('subscriptionId').nullable();
      table.string('provider').notNullable();
      table.string('providerPaymentId').nullable();
      table.integer('amountCents').notNullable().defaultTo(0);
      table.string('currency').notNullable().defaultTo('BRL');
      table.string('method').nullable(); // pix | boleto | card
      table.string('status').notNullable(); // pending|approved|rejected|refunded
      table.timestamp('paidAt').nullable();
      table.timestamp('createdAt').defaultTo(db.fn.now());
      table.index(['userId']);
    });
    logger.info('[Migrations] Created table "payments"');
  }

  // Idempotency log for provider webhook notifications.
  if (!(await db.schema.hasTable('billing_events'))) {
    await db.schema.createTable('billing_events', (table) => {
      table.increments('id').primary();
      table.string('provider').notNullable();
      table.string('externalId').notNullable();
      table.text('payload').nullable();
      table.timestamp('processedAt').defaultTo(db.fn.now());
      table.unique(['provider', 'externalId']);
    });
    logger.info('[Migrations] Created table "billing_events"');
  }

  // Seed the default plan catalog once (idempotent: only when table is empty).
  const planCount = await db('plans').count({ c: '*' }).first();
  if (Number(planCount?.c || 0) === 0) {
    const now = new Date();
    await db('plans').insert([
      {
        id: crypto.randomUUID(), slug: 'free', name: 'Free', priceCents: 0, currency: 'BRL',
        monthlyMessageQuota: 100, maxContacts: 200, maxSessions: 1, maxCampaigns: 2,
        features: JSON.stringify(['100 mensagens/mês', '1 instância WAHA', 'Suporte comunitário']),
        active: true, sortOrder: 0, createdAt: now,
      },
      {
        id: crypto.randomUUID(), slug: 'starter', name: 'Starter', priceCents: 4900, currency: 'BRL',
        monthlyMessageQuota: 2000, maxContacts: 5000, maxSessions: 1, maxCampaigns: 10,
        features: JSON.stringify(['2.000 mensagens/mês', '1 instância WAHA', 'Templates e webhooks', 'Suporte por e-mail']),
        active: true, sortOrder: 1, createdAt: now,
      },
      {
        id: crypto.randomUUID(), slug: 'pro', name: 'Pro', priceCents: 9900, currency: 'BRL',
        monthlyMessageQuota: 10000, maxContacts: 25000, maxSessions: 3, maxCampaigns: 50,
        features: JSON.stringify(['10.000 mensagens/mês', '3 instâncias WAHA', 'Tokens de API', 'Suporte prioritário']),
        active: true, sortOrder: 2, createdAt: now,
      },
      {
        id: crypto.randomUUID(), slug: 'business', name: 'Business', priceCents: 19900, currency: 'BRL',
        monthlyMessageQuota: 50000, maxContacts: -1, maxSessions: 10, maxCampaigns: -1,
        features: JSON.stringify(['50.000 mensagens/mês', '10 instâncias WAHA', 'Campanhas ilimitadas', 'Suporte dedicado']),
        active: true, sortOrder: 3, createdAt: now,
      },
    ]);
    logger.info('[Migrations] Seeded default plan catalog (free/starter/pro/business)');
  }

  // ---------------------------------------------------------------------------
  // Multi-tenant contact uniqueness: the `contacts` table was created with a
  // GLOBAL unique constraint on `phone` (pre-auth, single tenant). After adding
  // `userId`, the same phone legitimately belongs to different users, and a lead
  // list commonly repeats numbers — both cases threw a 500 on import. Replace the
  // global unique with a composite unique on (userId, phone). Idempotent.
  // ---------------------------------------------------------------------------
  const hasCompositeContactUnique = async (): Promise<boolean> => {
    try {
      if (isSqliteDb) {
        const rows: any[] = await db.raw(`PRAGMA index_list('contacts')`);
        const list = Array.isArray(rows) ? rows : rows?.[0] || [];
        for (const idx of list) {
          if (!idx?.unique) continue;
          const info: any[] = await db.raw(`PRAGMA index_info('${idx.name}')`);
          const cols = (Array.isArray(info) ? info : info?.[0] || []).map((c: any) => c.name);
          if (cols.includes('userId') && cols.includes('phone')) return true;
        }
        return false;
      }
      const res: any = await db.raw(
        `SELECT 1 FROM pg_indexes WHERE tablename = 'contacts' AND indexname = 'contacts_userId_phone_unique' LIMIT 1`,
      );
      return (res?.rows?.length || 0) > 0;
    } catch {
      return false;
    }
  };

  if (!(await hasCompositeContactUnique())) {
    try {
      // Drop the legacy global unique on `phone` if present.
      await db.schema.alterTable('contacts', (t) => t.dropUnique(['phone'], 'contacts_phone_unique'));
    } catch (err: any) {
      logger.warn({ err: String(err?.message || err) }, '[Migrations] Could not drop legacy contacts.phone unique (may not exist)');
    }
    try {
      await db.schema.alterTable('contacts', (t) =>
        t.unique(['userId', 'phone'], { indexName: 'contacts_userId_phone_unique' }),
      );
      logger.info('[Migrations] Replaced contacts.phone global unique with composite (userId, phone)');
    } catch (err: any) {
      logger.warn({ err: String(err?.message || err) }, '[Migrations] Could not add composite unique on contacts (userId, phone)');
    }
  }

  logger.info('[Migrations] Migrations complete');
}

export default runMigrations;
