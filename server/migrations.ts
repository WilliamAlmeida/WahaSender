import crypto from 'crypto';
import bcrypt from 'bcrypt';
import db, { isSqliteDb } from './db';
import { logger } from './logger';

const LEGACY_EMAIL = 'legacy@local';

/**
 * Returns the id of a "legacy" user used as default owner for data created
 * before authentication existed. Created on demand.
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
    createdAt: new Date(),
  });
  logger.warn(
    { email: LEGACY_EMAIL },
    '[Migrations] Created legacy owner user for pre-existing data. Reset its password through the API to enable login.',
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
    if (!exists) {
      await db.schema.alterTable(table, add);
      logger.info(`[Migrations] Added column ${table}.${column}`);
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

  logger.info('[Migrations] Migrations complete');
}

export default runMigrations;
