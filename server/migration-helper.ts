import fs from 'fs';
import path from 'path';
import db from './db';

export async function migrateLegacyJsonData(): Promise<void> {
  const legacyJsonPath = path.resolve(process.cwd(), 'data.json');

  if (!fs.existsSync(legacyJsonPath)) {
    console.log('[Migration Helper] Nenhum arquivo legacy "data.json" encontrado. Pulando migração de JSON.');
    return;
  }

  try {
    // Verifica se já existem dados no novo banco para evitar sobreposição/duplicidade
    const contactsCountResult = await db('contacts').count({ count: '*' }).first();
    const contactsCount = Number(contactsCountResult?.count || 0);

    if (contactsCount > 0) {
      console.log('[Migration Helper] Banco de dados já possui contatos. O "data.json" antigo não será reimportado.');
      return;
    }

    console.log('[Migration Helper] Arquivo "data.json" antigo detectado e banco de dados novo está vazio. Iniciando seeder automático...');
    const fileContent = fs.readFileSync(legacyJsonPath, 'utf-8');
    const legacyData = JSON.parse(fileContent);

    // 1. Migrar configurações (settings)
    if (legacyData.settings) {
      const settingsCount = await db('settings').count({ count: '*' }).first();
      if (Number(settingsCount?.count || 0) === 0) {
        await db('settings').insert({
          id: 1,
          wahaUrl: legacyData.settings.wahaUrl || '',
          apiKey: legacyData.settings.apiKey || '',
        });
        console.log('[Migration Helper] Configurações importadas.');
      }
    }

    // 2. Migrar contatos (contacts)
    const contactsMap = new Map<string, any>();
    if (legacyData.contacts && Array.isArray(legacyData.contacts)) {
      const contactsToInsert = legacyData.contacts.map((c: any) => {
        const id = c._id || c.id || Date.now().toString() + Math.random().toString(36).substr(2, 9);
        const name = c.name || c.nome || null;
        const phone = (c.phone || c.telefone || '').toString().trim();
        const blacklisted = !!c.blacklisted;
        
        contactsMap.set(id, { id, name, phone, blacklisted });
        return {
          id,
          name,
          phone,
          blacklisted
        };
      });

      // Filtra contatos duplicados por telefone antes de inserir no banco relacional (onde "phone" é chave única)
      const uniqueContacts: any[] = [];
      const seenPhones = new Set<string>();
      
      for (const c of contactsToInsert) {
        if (c.phone && !seenPhones.has(c.phone)) {
          seenPhones.add(c.phone);
          uniqueContacts.push(c);
        }
      }

      if (uniqueContacts.length > 0) {
        // Insere em lotes (chunks) de 100 para evitar limites de variáveis no SQLite/Postgres
        await db.batchInsert('contacts', uniqueContacts, 100);
        console.log(`[Migration Helper] ${uniqueContacts.length} contatos globais importados.`);
      }
    }

    // 3. Migrar grupos (groups) e relacionamento group_contacts
    if (legacyData.groups && Array.isArray(legacyData.groups)) {
      for (const g of legacyData.groups) {
        const groupId = g.id || Date.now().toString() + Math.random().toString(36).substr(2, 9);
        const groupName = g.name || 'Sem Nome';

        await db('groups').insert({
          id: groupId,
          name: groupName
        });

        const contactIds = g.contactIds || [];
        const groupContactsToInsert = contactIds
          .map((cid: string) => {
            // Verifica se o contato de fato existe no banco
            const exists = contactsMap.has(cid);
            if (exists) {
              return { groupId, contactId: cid };
            }
            return null;
          })
          .filter(Boolean);

        if (groupContactsToInsert.length > 0) {
          await db.batchInsert('group_contacts', groupContactsToInsert, 100);
        }
      }
      console.log(`[Migration Helper] ${legacyData.groups.length} grupos importados.`);
    }

    // 4. Migrar campanhas (campaigns) e históricos de logs/fila
    if (legacyData.campaigns && Array.isArray(legacyData.campaigns)) {
      let campaignsCount = 0;
      for (const c of legacyData.campaigns) {
        const campId = c.id || Date.now().toString();
        
        // Verifica se o grupo associado existe no banco
        const groupExists = c.groupId ? await db('groups').where({ id: c.groupId }).first() : false;
        const dbGroupId = groupExists ? c.groupId : null;

        await db('campaigns').insert({
          id: campId,
          name: c.name || 'Campanha',
          groupId: dbGroupId,
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
          createdAt: c.createdAt ? new Date(c.createdAt) : new Date()
        });

        // Contatos pendentes na fila da campanha
        if (c.pendingContacts && Array.isArray(c.pendingContacts)) {
          const pendingToInsert = c.pendingContacts
            .map((pc: any) => {
              const cid = pc._id || pc.id;
              if (cid && contactsMap.has(cid)) {
                return {
                  campaignId: campId,
                  contactId: cid,
                  paused: !!pc._paused
                };
              }
              return null;
            })
            .filter(Boolean);

          if (pendingToInsert.length > 0) {
            await db.batchInsert('campaign_pending_contacts', pendingToInsert, 100);
          }
        }

        // Histórico de logs da campanha
        if (c.logs && Array.isArray(c.logs)) {
          const logsToInsert = c.logs.map((logString: string) => {
            return {
              campaignId: campId,
              log: logString,
              createdAt: new Date()
            };
          });

          if (logsToInsert.length > 0) {
            await db.batchInsert('campaign_logs', logsToInsert, 100);
          }
        }

        campaignsCount++;
      }
      console.log(`[Migration Helper] ${campaignsCount} campanhas importadas com seus respectivos logs e filas.`);
    }

    // 5. Renomear o arquivo antigo para backup
    const backupJsonPath = path.resolve(process.cwd(), 'data.json.bak');
    fs.renameSync(legacyJsonPath, backupJsonPath);
    console.log('[Migration Helper] Migração de dados legados concluída com sucesso!');
    console.log(`[Migration Helper] O arquivo antigo "data.json" foi renomeado para "data.json.bak" por segurança.`);

  } catch (err: any) {
    console.error('[Migration Helper] Erro catastrófico ao migrar dados legados de JSON:', err.message);
  }
}
export default migrateLegacyJsonData;
