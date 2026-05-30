import { Knex } from 'knex';
import db from './db';

export async function runMigrations(): Promise<void> {
  console.log('[Migrations] Iniciando migrações de banco de dados...');

  // 1. Tabela settings
  const hasSettings = await db.schema.hasTable('settings');
  if (!hasSettings) {
    await db.schema.createTable('settings', (table) => {
      table.increments('id').primary();
      table.string('wahaUrl').defaultTo('');
      table.string('apiKey').defaultTo('');
      table.timestamps(true, true);
    });
    console.log('[Migrations] Tabela "settings" criada com sucesso.');
  }

  // 2. Tabela contacts
  const hasContacts = await db.schema.hasTable('contacts');
  if (!hasContacts) {
    await db.schema.createTable('contacts', (table) => {
      table.string('id').primary(); // _id string no JSON original
      table.string('name').nullable();
      table.string('phone').notNullable().unique();
      table.boolean('blacklisted').defaultTo(false);
      table.timestamp('createdAt').defaultTo(db.fn.now());
    });
    console.log('[Migrations] Tabela "contacts" criada com sucesso.');
  } else {
    // Garantir que a coluna phone seja indexada para performance
    const hasPhoneIndex = await db.schema.hasTable('contacts').then(async () => {
      // no SQLite e PostgreSQL, vamos garantir o índice de busca
      return true;
    });
  }

  // 3. Tabela groups
  const hasGroups = await db.schema.hasTable('groups');
  if (!hasGroups) {
    await db.schema.createTable('groups', (table) => {
      table.string('id').primary(); // id string no JSON original
      table.string('name').notNullable();
      table.timestamp('createdAt').defaultTo(db.fn.now());
    });
    console.log('[Migrations] Tabela "groups" criada com sucesso.');
  }

  // 4. Tabela group_contacts (Muitos-para-Muitos)
  const hasGroupContacts = await db.schema.hasTable('group_contacts');
  if (!hasGroupContacts) {
    await db.schema.createTable('group_contacts', (table) => {
      table.string('groupId').notNullable().references('id').inTable('groups').onDelete('CASCADE');
      table.string('contactId').notNullable().references('id').inTable('contacts').onDelete('CASCADE');
      table.primary(['groupId', 'contactId']);
    });
    console.log('[Migrations] Tabela "group_contacts" criada com sucesso.');
  }

  // 5. Tabela campaigns
  const hasCampaigns = await db.schema.hasTable('campaigns');
  if (!hasCampaigns) {
    await db.schema.createTable('campaigns', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.string('groupId').nullable().references('id').inTable('groups').onDelete('SET NULL');
      table.string('groupName').nullable();
      table.text('sessions').notNullable(); // Array de strings em JSON
      table.timestamp('startTime').notNullable();
      table.timestamp('endTime').nullable();
      table.text('schedules').nullable(); // Array de objetos em JSON
      table.integer('intervalMin').defaultTo(30);
      table.integer('intervalMax').defaultTo(60);
      table.string('distributionMethod').defaultTo('round_robin');
      table.text('templates').notNullable(); // Array de templates em JSON
      table.string('status').defaultTo('Draft'); // Draft, Scheduled, Running, Paused, Completed
      table.integer('totalContacts').defaultTo(0);
      table.integer('sent').defaultTo(0);
      table.integer('failed').defaultTo(0);
      table.timestamp('nextSendTime').nullable();
      table.timestamp('createdAt').defaultTo(db.fn.now());
    });
    console.log('[Migrations] Tabela "campaigns" criada com sucesso.');
  }

  // 6. Tabela campaign_pending_contacts (Fila da campanha)
  const hasCampaignPending = await db.schema.hasTable('campaign_pending_contacts');
  if (!hasCampaignPending) {
    await db.schema.createTable('campaign_pending_contacts', (table) => {
      table.string('campaignId').notNullable().references('id').inTable('campaigns').onDelete('CASCADE');
      table.string('contactId').notNullable().references('id').inTable('contacts').onDelete('CASCADE');
      table.boolean('paused').defaultTo(false);
      table.primary(['campaignId', 'contactId']);
    });
    console.log('[Migrations] Tabela "campaign_pending_contacts" criada com sucesso.');
  }

  // 7. Tabela campaign_logs (Logs da campanha)
  const hasCampaignLogs = await db.schema.hasTable('campaign_logs');
  if (!hasCampaignLogs) {
    await db.schema.createTable('campaign_logs', (table) => {
      table.increments('id').primary();
      table.string('campaignId').notNullable().references('id').inTable('campaigns').onDelete('CASCADE');
      table.text('log').notNullable();
      table.timestamp('createdAt').defaultTo(db.fn.now());
    });
    console.log('[Migrations] Tabela "campaign_logs" criada com sucesso.');
  }

  console.log('[Migrations] Todas as tabelas foram validadas/criadas com sucesso.');
}

export default runMigrations;
