import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import db from './db';
import { ensureLegacyUserId } from './migrations';
import { logger } from './logger';

export async function migrateLegacyJsonData(): Promise<void> {
  const legacyJsonPath = path.resolve(process.cwd(), 'data.json');

  if (!fs.existsSync(legacyJsonPath)) {
    logger.debug('[Migration Helper] No legacy data.json found. Skipping.');
    return;
  }

  try {
    const contactsCountResult = await db('contacts').count({ count: '*' }).first();
    if (Number(contactsCountResult?.count || 0) > 0) {
      logger.info('[Migration Helper] Database already has contacts; legacy data.json will not be re-imported.');
      return;
    }

    logger.info('[Migration Helper] Importing legacy data.json into relational store...');
    const legacyData = JSON.parse(fs.readFileSync(legacyJsonPath, 'utf-8'));
    const userId = await ensureLegacyUserId();

    // 1) Settings
    if (legacyData.settings) {
      const cnt = await db('settings').count({ c: '*' }).first();
      if (Number(cnt?.c || 0) === 0) {
        await db('settings').insert({
          id: 1,
          wahaUrl: legacyData.settings.wahaUrl || '',
          apiKey: legacyData.settings.apiKey || '',
          userId,
        });
      }
    }

    // 2) Contacts
    const contactsMap = new Map<string, any>();
    if (Array.isArray(legacyData.contacts)) {
      const seenPhones = new Set<string>();
      const toInsert: any[] = [];
      for (const c of legacyData.contacts) {
        const id = c._id || c.id || crypto.randomUUID();
        const phone = (c.phone || c.telefone || '').toString().trim();
        if (!phone || seenPhones.has(phone)) continue;
        seenPhones.add(phone);
        const row = {
          id,
          name: c.name || c.nome || null,
          phone,
          blacklisted: !!c.blacklisted,
          userId,
        };
        contactsMap.set(id, row);
        toInsert.push(row);
      }
      if (toInsert.length > 0) {
        await db.batchInsert('contacts', toInsert, 100);
        logger.info({ count: toInsert.length }, '[Migration Helper] Imported contacts');
      }
    }

    // 3) Groups + relations
    if (Array.isArray(legacyData.groups)) {
      for (const g of legacyData.groups) {
        const groupId = g.id || crypto.randomUUID();
        await db('groups').insert({
          id: groupId,
          name: g.name || 'Sem Nome',
          userId,
        });

        const rels = (g.contactIds || [])
          .filter((cid: string) => contactsMap.has(cid))
          .map((cid: string) => ({ groupId, contactId: cid }));
        if (rels.length > 0) {
          await db.batchInsert('group_contacts', rels, 100);
        }
      }
      logger.info({ count: legacyData.groups.length }, '[Migration Helper] Imported groups');
    }

    // 4) Campaigns + queue + logs
    if (Array.isArray(legacyData.campaigns)) {
      for (const c of legacyData.campaigns) {
        const campId = c.id || crypto.randomUUID();
        const groupRow = c.groupId ? await db('groups').where({ id: c.groupId }).first() : null;

        await db('campaigns').insert({
          id: campId,
          name: c.name || 'Campanha',
          groupId: groupRow ? c.groupId : null,
          groupName: c.groupName || null,
          sessions: JSON.stringify(c.sessions || []),
          startTime: c.startTime ? new Date(c.startTime) : new Date(),
          endTime: c.endTime ? new Date(c.endTime) : null,
          schedules: JSON.stringify(c.schedules || []),
          intervalMin: c.intervalMin || 30,
          intervalMax: c.intervalMax || 60,
          distributionMethod: c.distributionMethod || 'round_robin',
          templates: JSON.stringify(c.templates || []),
          status: c.status || 'Draft',
          totalContacts: c.totalContacts || 0,
          sent: c.sent || 0,
          failed: c.failed || 0,
          nextSendTime: c.nextSendTime ? new Date(c.nextSendTime) : null,
          createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
          userId,
        });

        if (Array.isArray(c.pendingContacts)) {
          const pendings = c.pendingContacts
            .map((pc: any, idx: number) => {
              const cid = pc._id || pc.id;
              if (cid && contactsMap.has(cid)) {
                return {
                  campaignId: campId,
                  contactId: cid,
                  paused: !!pc._paused,
                  order: idx,
                };
              }
              return null;
            })
            .filter(Boolean);
          if (pendings.length > 0) {
            await db.batchInsert('campaign_pending_contacts', pendings, 100);
          }
        }

        if (Array.isArray(c.logs)) {
          const logs = c.logs.map((logString: string) => ({
            campaignId: campId,
            log: logString,
            createdAt: new Date(),
          }));
          if (logs.length > 0) {
            await db.batchInsert('campaign_logs', logs, 100);
          }
        }
      }
      logger.info({ count: legacyData.campaigns.length }, '[Migration Helper] Imported campaigns');
    }

    const backupPath = path.resolve(process.cwd(), 'data.json.bak');
    fs.renameSync(legacyJsonPath, backupPath);
    logger.info({ backupPath }, '[Migration Helper] Legacy import complete; data.json renamed to .bak');
  } catch (err: any) {
    logger.error({ err: err.message }, '[Migration Helper] Failed to migrate legacy data.json');
  }
}

export default migrateLegacyJsonData;
