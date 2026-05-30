import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import axios from 'axios';
import multer from 'multer';
import dotenv from 'dotenv';

// Importa a inicialização do banco, migrations e storage
import db from './server/db';
import { runMigrations } from './server/migrations';
import { migrateLegacyJsonData } from './server/migration-helper';
import storage from './server/storage';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

// Configuração do Multer (upload em memória para compatibilidade com os storages)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // limite de 50MB
});

// Expõe a pasta de uploads de forma estática para o driver de storage local ser acessível
app.use('/uploads', express.static(path.resolve(process.cwd(), 'storage', 'uploads')));

// Helper: Formatação de telefone (para histórico)
const formatPhone = (phone: string) => {
  const p = (phone || '').toString().replace(/\D/g, '');
  if (p.length === 12 || p.length === 13) {
    if (p.startsWith('55')) {
      const ddd = p.slice(2, 4);
      if (p.length === 13) {
        return `+55 (${ddd}) ${p.slice(4, 9)}-${p.slice(9)}`;
      } else {
        return `+55 (${ddd}) ${p.slice(4, 8)}-${p.slice(8)}`;
      }
    }
  }
  if (p.length === 10 || p.length === 11) {
    const ddd = p.slice(0, 2);
    if (p.length === 11) {
      return `(${ddd}) ${p.slice(2, 7)}-${p.slice(7)}`;
    } else {
      return `(${ddd}) ${p.slice(2, 6)}-${p.slice(6)}`;
    }
  }
  return phone || '-';
};

// Helper: Obter configurações ativas
const getActiveSettings = async () => {
  let settings = await db('settings').where({ id: 1 }).first();
  if (!settings) {
    // Insere configurações padrão se vazio
    await db('settings').insert({ id: 1, wahaUrl: '', apiKey: '' });
    settings = { id: 1, wahaUrl: '', apiKey: '' };
  }
  return settings;
};

// Helper: WAHA Axios Instance baseado em DB
const getWahaClient = async () => {
  const settings = await getActiveSettings();
  return axios.create({
    baseURL: settings.wahaUrl,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': settings.apiKey,
    },
  });
};

// --- API ENDPOINTS ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Endpoint de Upload de Arquivos (Storage Local ou S3)
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }
    console.log(`[Upload] Recebendo arquivo "${req.file.originalname}" (${req.file.size} bytes)`);
    const result = await storage.uploadFile(req.file);
    res.json(result);
  } catch (err: any) {
    console.error('[Upload] Erro ao fazer upload do arquivo:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await getActiveSettings();
    res.json({ wahaUrl: settings.wahaUrl, apiKey: settings.apiKey });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { wahaUrl, apiKey } = req.body;
    await db('settings').where({ id: 1 }).update({
      wahaUrl: wahaUrl !== undefined ? wahaUrl : '',
      apiKey: apiKey !== undefined ? apiKey : '',
    });
    res.json({ status: 'success' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Proxy to WAHA for sessions
app.get('/api/waha/sessions', async (req, res) => {
  const settings = await getActiveSettings();
  if (!settings.wahaUrl) return res.json([]);
  try {
    const client = await getWahaClient();
    const response = await client.get('/api/sessions');
    res.json(response.data);
  } catch (e: any) {
    console.error('Error fetching WAHA sessions:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Proxy to test WAHA connection
app.post('/api/waha/ping', async (req, res) => {
  const settings = await getActiveSettings();
  const targetUrl = req.body.wahaUrl || settings.wahaUrl;
  const targetKey = req.body.apiKey !== undefined ? req.body.apiKey : settings.apiKey;

  if (!targetUrl) return res.status(400).json({ status: 'error', message: 'WAHA URL not set' });
  try {
    const client = axios.create({
      baseURL: targetUrl,
      headers: {
        'Content-Type': 'application/json',
        ...(targetKey ? { 'X-Api-Key': targetKey } : {})
      },
    });
    const response = await client.get('/ping');
    res.json(response.data);
  } catch (e: any) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

app.post('/api/waha/sendTestMessage', async (req, res) => {
  const settings = await getActiveSettings();
  if (!settings.wahaUrl) return res.status(400).json({ error: 'WAHA URL not set' });
  try {
    const { session, phone, text } = req.body;
    let targetPhone = phone.replace(/\D/g, ''); // keep only numbers
    if (!targetPhone.includes('@')) {
      targetPhone += '@c.us';
    }

    const client = await getWahaClient();
    const response = await client.post('/api/sendText', {
      chatId: targetPhone,
      text: text,
      session: session
    });
    res.json(response.data);
  } catch (e: any) {
    console.error('Error sending test message:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Contacts API
app.get('/api/contacts', async (req, res) => {
  try {
    // Carrega contatos
    const contacts = await db('contacts').select('*').orderBy('createdAt', 'desc');
    
    // Carrega a relação contatos-grupos de forma otimizada
    const relations = await db('group_contacts')
      .join('groups', 'group_contacts.groupId', 'groups.id')
      .select('group_contacts.contactId', 'groups.id', 'groups.name');

    // Mapeia os grupos para cada contato
    const relationsMap = new Map<string, any[]>();
    relations.forEach(r => {
      if (!relationsMap.has(r.contactId)) {
        relationsMap.set(r.contactId, []);
      }
      relationsMap.get(r.contactId)!.push({ id: r.id, name: r.name });
    });

    const populatedContacts = contacts.map(c => {
      // O frontend espera _id ao invés de id para fins de compatibilidade histórica
      return {
        _id: c.id,
        name: c.name,
        phone: c.phone,
        blacklisted: !!c.blacklisted,
        groups: relationsMap.get(c.id) || []
      };
    });

    res.json(populatedContacts);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/contacts/import', async (req, res) => {
  try {
    const { contacts } = req.body;
    if (!contacts || !Array.isArray(contacts)) return res.status(400).json({ error: 'Invalid contacts list' });
    
    let addedCount = 0;
    
    // Mapeia telefones para buscar duplicados no banco
    const phones = contacts.map((c: any) => {
      return (c.phone || c.telefone || '').toString().replace(/\D/g, '').trim();
    }).filter(Boolean);

    if (phones.length === 0) {
      return res.json({ success: true, count: 0 });
    }

    // Busca contatos existentes com esses telefones
    const existingContacts = await db('contacts').whereIn('phone', phones);
    const existingPhonesMap = new Map<string, any>();
    existingContacts.forEach(c => {
      existingPhonesMap.set(c.phone, c);
    });

    const toInsert: any[] = [];
    
    for (const c of contacts) {
      let cleanPhone = (c.phone || c.telefone || '').toString().replace(/\D/g, '').trim();
      if (!cleanPhone) continue;

      const existing = existingPhonesMap.get(cleanPhone);
      
      if (!existing) {
        // ID único (UUID ou string parecida)
        const id = c._id || Date.now().toString() + Math.random().toString(36).substr(2, 9);
        const name = c.name !== undefined ? c.name : null;
        const blacklisted = c.blacklisted !== undefined ? !!c.blacklisted : false;

        toInsert.push({
          id,
          name,
          phone: cleanPhone,
          blacklisted
        });
        addedCount++;
      } else {
        // Se já existe, atualiza apenas o nome se fornecido
        if (c.name !== undefined) {
          await db('contacts').where({ id: existing.id }).update({ name: c.name });
        }
      }
    }

    if (toInsert.length > 0) {
      await db.batchInsert('contacts', toInsert, 100);
    }

    res.json({ success: true, count: addedCount });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/contacts/:id/campaigns', async (req, res) => {
  try {
    // Encontra o contato global
    const contact = await db('contacts').where({ id: req.params.id }).first();
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    
    const phoneStr = (contact.phone || '').trim();
    if (!phoneStr) return res.json([]);

    // Busca os logs associados ao telefone do contato
    const logs = await db('campaign_logs')
      .join('campaigns', 'campaign_logs.campaignId', 'campaigns.id')
      .where('campaign_logs.log', 'like', `%${phoneStr}%`)
      .select(
        'campaigns.id',
        'campaigns.name',
        'campaigns.startTime',
        'campaign_logs.log',
        'campaign_logs.createdAt'
      )
      .orderBy('campaign_logs.createdAt', 'desc');

    // Busca se está pendente em alguma fila de campanha ativa
    const pendingCampaigns = await db('campaign_pending_contacts')
      .join('campaigns', 'campaign_pending_contacts.campaignId', 'campaigns.id')
      .where('campaign_pending_contacts.contactId', contact.id)
      .select('campaigns.id', 'campaigns.name', 'campaigns.startTime');

    const contactCampaignsMap = new Map<string, any>();

    // Adiciona logs correspondentes
    logs.forEach(l => {
      let status = '';
      if (l.log.includes('Sent to')) status = 'Enviado';
      else if (l.log.includes('Skipped') || l.log.includes('Blacklisted')) status = 'Bloqueado/Blacklist';
      else status = 'Erro';

      contactCampaignsMap.set(l.id, {
        id: l.id,
        name: l.name,
        startTime: l.startTime,
        status,
        logAt: l.createdAt,
        logMsg: l.log
      });
    });

    // Adiciona pendentes
    pendingCampaigns.forEach(pc => {
      if (!contactCampaignsMap.has(pc.id)) {
        contactCampaignsMap.set(pc.id, {
          id: pc.id,
          name: pc.name,
          startTime: pc.startTime,
          status: 'Na fila',
          logAt: null,
          logMsg: ''
        });
      }
    });

    res.json(Array.from(contactCampaignsMap.values()));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/contacts/:id', async (req, res) => {
  try {
    const { name, phone, blacklisted } = req.body;
    const contact = await db('contacts').where({ id: req.params.id }).first();
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone.replace(/\D/g, '').trim();
    if (blacklisted !== undefined) updateData.blacklisted = !!blacklisted;

    await db('contacts').where({ id: req.params.id }).update(updateData);
    
    const updated = await db('contacts').where({ id: req.params.id }).first();
    res.json({
      _id: updated.id,
      name: updated.name,
      phone: updated.phone,
      blacklisted: !!updated.blacklisted
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/contacts/:id', async (req, res) => {
  try {
    const contact = await db('contacts').where({ id: req.params.id }).first();
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    // Exclusão em cascata é tratada no banco (group_contacts, campaign_pending_contacts)
    await db('contacts').where({ id: req.params.id }).delete();
    res.json({ status: 'success' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Groups API
app.get('/api/groups', async (req, res) => {
  try {
    // Busca grupos com contagem de contatos
    const groups = await db('groups')
      .leftJoin('group_contacts', 'groups.id', 'group_contacts.groupId')
      .select('groups.id', 'groups.name')
      .count({ count: 'group_contacts.contactId' })
      .groupBy('groups.id', 'groups.name')
      .orderBy('groups.name', 'asc');

    res.json(groups.map(g => ({
      id: g.id,
      name: g.name,
      count: Number(g.count || 0)
    })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/groups', async (req, res) => {
  try {
    const { name, contacts } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name is required' });

    const groupId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    
    await db('groups').insert({
      id: groupId,
      name
    });

    const contactIds: string[] = [];

    if (contacts && Array.isArray(contacts)) {
      for (const c of contacts) {
        let cleanPhone = (c.phone || c.telefone || '').toString().replace(/\D/g, '').trim();
        if (!cleanPhone) continue;

        let existing = await db('contacts').where({ phone: cleanPhone }).first();
        let cid = '';

        if (!existing) {
          cid = c._id || Date.now().toString() + Math.random().toString(36).substr(2, 9);
          await db('contacts').insert({
            id: cid,
            name: c.name || null,
            phone: cleanPhone,
            blacklisted: !!c.blacklisted
          });
        } else {
          cid = existing.id;
          // Atualiza dados adicionais se necessário
          const updateData: any = {};
          if (c.name && !existing.name) updateData.name = c.name;
          if (c.blacklisted !== undefined) updateData.blacklisted = !!c.blacklisted;
          if (Object.keys(updateData).length > 0) {
            await db('contacts').where({ id: cid }).update(updateData);
          }
        }

        if (!contactIds.includes(cid)) {
          contactIds.push(cid);
        }
      }

      // Vincula os contatos ao grupo
      if (contactIds.length > 0) {
        const relations = contactIds.map(cid => ({ groupId, contactId: cid }));
        await db.batchInsert('group_contacts', relations, 100);
      }
    }

    res.json({
      id: groupId,
      name,
      contactIds
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/groups/:id', async (req, res) => {
  try {
    const group = await db('groups').where({ id: req.params.id }).first();
    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Busca os contatos populados do grupo
    const contacts = await db('contacts')
      .join('group_contacts', 'contacts.id', 'group_contacts.contactId')
      .where('group_contacts.groupId', group.id)
      .select('contacts.*');

    res.json({
      id: group.id,
      name: group.name,
      contacts: contacts.map(c => ({
        _id: c.id,
        name: c.name,
        phone: c.phone,
        blacklisted: !!c.blacklisted
      }))
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/groups/:id', async (req, res) => {
  try {
    const group = await db('groups').where({ id: req.params.id }).first();
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const { name, contacts } = req.body;

    if (name !== undefined) {
      await db('groups').where({ id: group.id }).update({ name });
    }

    if (contacts !== undefined && Array.isArray(contacts)) {
      const contactIds: string[] = [];

      for (const c of contacts) {
        let cleanPhone = (c.phone || c.telefone || '').toString().replace(/\D/g, '').trim();
        let cid = '';
        let existing = null;

        if (c._id) {
          existing = await db('contacts').where({ id: c._id }).first();
        }
        if (!existing && cleanPhone) {
          existing = await db('contacts').where({ phone: cleanPhone }).first();
        }

        if (!existing) {
          cid = c._id || Date.now().toString() + Math.random().toString(36).substr(2, 9);
          await db('contacts').insert({
            id: cid,
            name: c.name || null,
            phone: cleanPhone || '',
            blacklisted: !!c.blacklisted
          });
        } else {
          cid = existing.id;
          const updateData: any = {};
          if (c.name !== undefined) updateData.name = c.name;
          if (cleanPhone && cleanPhone !== existing.phone) updateData.phone = cleanPhone;
          if (c.blacklisted !== undefined) updateData.blacklisted = !!c.blacklisted;

          if (Object.keys(updateData).length > 0) {
            await db('contacts').where({ id: cid }).update(updateData);
          }
        }

        if (!contactIds.includes(cid)) {
          contactIds.push(cid);
        }
      }

      // Atualiza os relacionamentos (deleta antigos e insere novos)
      await db('group_contacts').where({ groupId: group.id }).delete();
      if (contactIds.length > 0) {
        const relations = contactIds.map(cid => ({ groupId: group.id, contactId: cid }));
        await db.batchInsert('group_contacts', relations, 100);
      }
    }

    // Busca os contatos populados e retorna
    const updatedContacts = await db('contacts')
      .join('group_contacts', 'contacts.id', 'group_contacts.contactId')
      .where('group_contacts.groupId', group.id)
      .select('contacts.*');

    res.json({
      id: group.id,
      name: name || group.name,
      contacts: updatedContacts.map(c => ({
        _id: c.id,
        name: c.name,
        phone: c.phone,
        blacklisted: !!c.blacklisted
      }))
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/groups/:id', async (req, res) => {
  try {
    // Verifica se há campanhas rodando para este grupo
    const runningCampaign = await db('campaigns')
      .where({ groupId: req.params.id, status: 'Running' })
      .first();

    if (runningCampaign) {
      return res.status(400).json({ error: 'Não é possível excluir um grupo que está sendo usado em uma campanha em andamento.' });
    }

    await db('groups').where({ id: req.params.id }).delete();
    res.json({ status: 'success' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Campaigns API
app.get('/api/campaigns', async (req, res) => {
  try {
    const campaigns = await db('campaigns').select('*').orderBy('createdAt', 'desc');
    
    // Adiciona logs e pendingContacts para manter compatibilidade exata de contrato
    const result: any[] = [];
    
    for (const c of campaigns) {
      const pendingCount = await db('campaign_pending_contacts')
        .where({ campaignId: c.id })
        .count({ count: '*' })
        .first();

      // Busca logs
      const logs = await db('campaign_logs')
        .where({ campaignId: c.id })
        .select('log')
        .orderBy('id', 'desc');

      // Busca dados populados de pending para a queue rápida se necessário (máx 200)
      const pendings = await db('contacts')
        .join('campaign_pending_contacts', 'contacts.id', 'campaign_pending_contacts.contactId')
        .where('campaign_pending_contacts.campaignId', c.id)
        .select('contacts.*', 'campaign_pending_contacts.paused')
        .limit(200);

      result.push({
        id: c.id,
        name: c.name,
        groupId: c.groupId,
        groupName: c.groupName,
        sessions: JSON.parse(c.sessions),
        startTime: c.startTime,
        endTime: c.endTime,
        schedules: JSON.parse(c.schedules || '[]'),
        intervalMin: c.intervalMin,
        intervalMax: c.intervalMax,
        distributionMethod: c.distributionMethod,
        templates: JSON.parse(c.templates),
        status: c.status,
        totalContacts: c.totalContacts,
        sent: c.sent,
        failed: c.failed,
        createdAt: c.createdAt,
        nextSendTime: c.nextSendTime,
        pendingContacts: pendings.map(p => ({
          _id: p.id,
          name: p.name,
          phone: p.phone,
          _paused: !!p.paused
        })),
        logs: logs.map(l => l.log)
      });
    }

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/campaigns', async (req, res) => {
  try {
    const { name, groupId, sessions, startTime, endTime, schedules, intervalMin, intervalMax, distributionMethod, templates } = req.body;

    const group = await db('groups').where({ id: groupId }).first();
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const campId = Date.now().toString();

    // Contatos populados do grupo para carregar na fila da campanha
    const groupContacts = await db('contacts')
      .join('group_contacts', 'contacts.id', 'group_contacts.contactId')
      .where('group_contacts.groupId', group.id)
      .select('contacts.*');

    await db('campaigns').insert({
      id: campId,
      name,
      groupId,
      groupName: group.name,
      sessions: JSON.stringify(sessions || []),
      startTime: startTime ? new Date(startTime) : new Date(),
      endTime: endTime ? new Date(endTime) : null,
      schedules: JSON.stringify(schedules || []),
      intervalMin: intervalMin || 30,
      intervalMax: intervalMax || 60,
      distributionMethod: distributionMethod || 'round_robin',
      templates: JSON.stringify(templates || []),
      status: 'Draft',
      totalContacts: groupContacts.length,
      sent: 0,
      failed: 0,
      createdAt: new Date(),
      nextSendTime: startTime ? new Date(startTime) : new Date()
    });

    // Adiciona na fila de envios da campanha
    if (groupContacts.length > 0) {
      const queueEntries = groupContacts.map(c => ({
        campaignId: campId,
        contactId: c.id,
        paused: false
      }));
      await db.batchInsert('campaign_pending_contacts', queueEntries, 100);
    }

    res.json({
      id: campId,
      name,
      groupId,
      groupName: group.name,
      sessions,
      startTime,
      endTime,
      schedules,
      intervalMin,
      intervalMax,
      distributionMethod,
      templates,
      status: 'Draft',
      totalContacts: groupContacts.length,
      sent: 0,
      failed: 0,
      pendingContacts: groupContacts.map(c => ({
        _id: c.id,
        name: c.name,
        phone: c.phone
      })),
      logs: []
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/campaigns/:id', async (req, res) => {
  try {
    const campaign = await db('campaigns').where({ id: req.params.id }).first();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const updateData: any = {};
    const { name, groupId, sessions, startTime, endTime, schedules, intervalMin, intervalMax, distributionMethod, templates } = req.body;

    if (name !== undefined) updateData.name = name;
    if (sessions !== undefined) updateData.sessions = JSON.stringify(sessions);
    if (startTime !== undefined) updateData.startTime = new Date(startTime);
    if (endTime !== undefined) updateData.endTime = endTime ? new Date(endTime) : null;
    if (schedules !== undefined) updateData.schedules = JSON.stringify(schedules);
    if (intervalMin !== undefined) updateData.intervalMin = intervalMin;
    if (intervalMax !== undefined) updateData.intervalMax = intervalMax;
    if (distributionMethod !== undefined) updateData.distributionMethod = distributionMethod;
    if (templates !== undefined) updateData.templates = JSON.stringify(templates);

    // Se o grupo for alterado, regera a fila
    if (groupId !== undefined && groupId !== campaign.groupId) {
      const group = await db('groups').where({ id: groupId }).first();
      if (!group) return res.status(404).json({ error: 'Group not found' });

      updateData.groupId = groupId;
      updateData.groupName = group.name;

      const groupContacts = await db('contacts')
        .join('group_contacts', 'contacts.id', 'group_contacts.contactId')
        .where('group_contacts.groupId', group.id)
        .select('contacts.*');

      updateData.totalContacts = groupContacts.length;
      updateData.sent = 0;
      updateData.failed = 0;

      // Deleta fila antiga e cria nova
      await db('campaign_pending_contacts').where({ campaignId: campaign.id }).delete();
      await db('campaign_logs').where({ campaignId: campaign.id }).delete();

      if (groupContacts.length > 0) {
        const queueEntries = groupContacts.map(c => ({
          campaignId: campaign.id,
          contactId: c.id,
          paused: false
        }));
        await db.batchInsert('campaign_pending_contacts', queueEntries, 100);
      }
    }

    if (campaign.status === 'Draft' || campaign.status === 'Paused') {
      if (startTime !== undefined) {
        updateData.nextSendTime = new Date(startTime);
      }
    }

    if (Object.keys(updateData).length > 0) {
      await db('campaigns').where({ id: campaign.id }).update(updateData);
    }

    // Retorna a campanha atualizada
    const updated = await db('campaigns').where({ id: campaign.id }).first();
    res.json({
      id: updated.id,
      name: updated.name,
      groupId: updated.groupId,
      groupName: updated.groupName,
      sessions: JSON.parse(updated.sessions),
      startTime: updated.startTime,
      endTime: updated.endTime,
      schedules: JSON.parse(updated.schedules || '[]'),
      intervalMin: updated.intervalMin,
      intervalMax: updated.intervalMax,
      distributionMethod: updated.distributionMethod,
      templates: JSON.parse(updated.templates),
      status: updated.status
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/campaigns/:id', async (req, res) => {
  try {
    const campaign = await db('campaigns').where({ id: req.params.id }).first();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Busca fila e logs
    const pendings = await db('contacts')
      .join('campaign_pending_contacts', 'contacts.id', 'campaign_pending_contacts.contactId')
      .where('campaign_pending_contacts.campaignId', campaign.id)
      .select('contacts.*', 'campaign_pending_contacts.paused');

    const logs = await db('campaign_logs')
      .where({ campaignId: campaign.id })
      .select('log')
      .orderBy('id', 'desc');

    res.json({
      id: campaign.id,
      name: campaign.name,
      groupId: campaign.groupId,
      groupName: campaign.groupName,
      sessions: JSON.parse(campaign.sessions),
      startTime: campaign.startTime,
      endTime: campaign.endTime,
      schedules: JSON.parse(campaign.schedules || '[]'),
      intervalMin: campaign.intervalMin,
      intervalMax: campaign.intervalMax,
      distributionMethod: campaign.distributionMethod,
      templates: JSON.parse(campaign.templates),
      status: campaign.status,
      totalContacts: campaign.totalContacts,
      sent: campaign.sent,
      failed: campaign.failed,
      createdAt: campaign.createdAt,
      nextSendTime: campaign.nextSendTime,
      pendingContacts: pendings.map(p => ({
        _id: p.id,
        name: p.name,
        phone: p.phone,
        _paused: !!p.paused
      })),
      logs: logs.map(l => l.log)
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/campaigns/:id/toggle', async (req, res) => {
  try {
    const campaign = await db('campaigns').where({ id: req.params.id }).first();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    let newStatus = campaign.status;

    if (campaign.status === 'Paused' || campaign.status === 'Draft') {
      const now = new Date();
      const start = new Date(campaign.startTime);
      newStatus = start > now ? 'Scheduled' : 'Running';
    } else if (campaign.status === 'Running' || campaign.status === 'Scheduled') {
      newStatus = 'Paused';
    }

    await db('campaigns').where({ id: campaign.id }).update({ status: newStatus });
    
    res.json({
      id: campaign.id,
      status: newStatus
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/campaigns/:id', async (req, res) => {
  try {
    const campaign = await db('campaigns').where({ id: req.params.id }).first();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    await db('campaigns').where({ id: req.params.id }).delete();
    res.json({ status: 'success' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Queue API
app.get('/api/queue', async (req, res) => {
  try {
    // Carrega a fila ordenada de campanhas ativas
    const queue = await db('campaign_pending_contacts')
      .join('campaigns', 'campaign_pending_contacts.campaignId', 'campaigns.id')
      .join('contacts', 'campaign_pending_contacts.contactId', 'contacts.id')
      .whereIn('campaigns.status', ['Running', 'Paused'])
      .select(
        'campaign_pending_contacts.campaignId',
        'campaigns.name as campaignName',
        'campaigns.status as campaignStatus',
        'contacts.id as contactId',
        'contacts.name as contactName',
        'contacts.phone as contactPhone',
        'campaign_pending_contacts.paused as isPaused'
      )
      .orderBy('campaign_pending_contacts.campaignId')
      .orderBy('contacts.id')
      .limit(1000); // Evitar payloads absurdamente gigantes

    res.json(queue.map((q, idx) => ({
      campaignId: q.campaignId,
      campaignName: q.campaignName,
      contactName: q.contactName || 'N/A',
      contactPhone: q.contactPhone || 'N/A',
      index: idx, // Mantém o index simulado para o front antigo
      isPaused: !!q.isPaused,
      campaignStatus: q.campaignStatus
    })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/campaigns/:id/queue/:index', async (req, res) => {
  try {
    const idx = parseInt(req.params.index);
    if (isNaN(idx) || idx < 0) return res.status(400).json({ error: 'Invalid index' });

    // Busca fila da campanha ordenada de forma estável para achar pelo index
    const queue = await db('campaign_pending_contacts')
      .where({ campaignId: req.params.id })
      .orderBy('contactId')
      .select('*');

    const target = queue[idx];
    if (!target) return res.status(404).json({ error: 'Not found' });

    await db('campaign_pending_contacts')
      .where({ campaignId: req.params.id, contactId: target.contactId })
      .delete();

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/campaigns/:id/queue/:index/toggle', async (req, res) => {
  try {
    const idx = parseInt(req.params.index);
    if (isNaN(idx) || idx < 0) return res.status(400).json({ error: 'Invalid index' });

    // Busca fila da campanha ordenada de forma estável para achar pelo index
    const queue = await db('campaign_pending_contacts')
      .where({ campaignId: req.params.id })
      .orderBy('contactId')
      .select('*');

    const target = queue[idx];
    if (!target) return res.status(404).json({ error: 'Not found' });

    const newPaused = !target.paused;
    await db('campaign_pending_contacts')
      .where({ campaignId: req.params.id, contactId: target.contactId })
      .update({ paused: newPaused });

    res.json({ success: true, paused: newPaused });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Campaign Runner Background Job ---
const processCampaigns = async () => {
  try {
    const settings = await getActiveSettings();
    if (!settings.wahaUrl) return; // Requer URL configurada

    const now = new Date();

    // Busca campanhas agendadas ou rodando
    const activeCampaigns = await db('campaigns')
      .whereIn('status', ['Scheduled', 'Running']);

    for (const campaign of activeCampaigns) {
      const startTimeDate = new Date(campaign.startTime);
      const endTimeDate = campaign.endTime ? new Date(campaign.endTime) : null;

      if (startTimeDate > now) continue;

      if (endTimeDate && endTimeDate < now) {
        await db('campaigns').where({ id: campaign.id }).update({ status: 'Completed' });
        continue;
      }

      // Ativa campanhas agendadas que iniciaram
      if (campaign.status === 'Scheduled') {
        campaign.status = 'Running';
        await db('campaigns').where({ id: campaign.id }).update({ status: 'Running' });
      }

      // Busca quantidade de contatos restantes na fila da campanha
      const pendingCountRes = await db('campaign_pending_contacts')
        .where({ campaignId: campaign.id })
        .count({ count: '*' })
        .first();

      const pendingCount = Number(pendingCountRes?.count || 0);

      if (pendingCount === 0) {
        await db('campaigns').where({ id: campaign.id }).update({ status: 'Completed' });
        continue;
      }

      // Validação de Janela de Horários (Schedules)
      if (campaign.schedules) {
        const schedules = JSON.parse(campaign.schedules);
        if (schedules && schedules.length > 0) {
          const today = now.getDay(); // 0 = Domingo, 1 = Segunda, etc.
          const daySchedule = schedules.find((s: any) => s.dayOfWeek === today);
          
          if (!daySchedule || !daySchedule.slots || daySchedule.slots.length === 0) continue; // Sem envio hoje
          
          const currentHourStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
          let inSlot = false;
          for (const slot of daySchedule.slots) {
            if (currentHourStr >= slot.start && currentHourStr <= slot.end) {
              inSlot = true;
              break;
            }
          }
          if (!inSlot) continue; // Fora do horário configurado
        }
      }

      // Validação de intervalo de tempo entre envios
      let shouldSend = false;
      if (!campaign.nextSendTime) {
        shouldSend = true;
      } else {
        if (now >= new Date(campaign.nextSendTime)) {
          shouldSend = true;
        }
      }

      if (shouldSend) {
        // Busca o primeiro contato não pausado da fila desta campanha
        const pendingContact = await db('campaign_pending_contacts')
          .join('contacts', 'campaign_pending_contacts.contactId', 'contacts.id')
          .where({ 'campaign_pending_contacts.campaignId': campaign.id, 'campaign_pending_contacts.paused': false })
          .select('contacts.*')
          .first();

        if (!pendingContact) {
          // Todos os contatos na fila estão marcados como pausados
          continue;
        }

        // Define a hora do próximo envio
        const min = campaign.intervalMin || 30;
        const max = campaign.intervalMax || 60;
        const delaySecs = Math.floor(Math.random() * ((max - min) / 10 + 1)) * 10 + min;
        const nextSendTimeStr = new Date(now.getTime() + delaySecs * 1000).toISOString();

        await db('campaigns').where({ id: campaign.id }).update({
          nextSendTime: nextSendTimeStr
        });

        // Deleta o contato da fila
        await db('campaign_pending_contacts')
          .where({ campaignId: campaign.id, contactId: pendingContact.id })
          .delete();

        // Valida se o contato está na blacklist global
        if (pendingContact.blacklisted) {
          const logMsg = `[${now.toISOString()}] Skipped ${pendingContact.phone} (Blacklisted)`;
          await db('campaigns').where({ id: campaign.id }).increment('failed', 1);
          await db('campaign_logs').insert({ campaignId: campaign.id, log: logMsg });
          continue;
        }

        // Escolhe a sessão do WAHA (Rodízio ou Aleatório)
        const sessionsList = JSON.parse(campaign.sessions);
        if (!sessionsList || sessionsList.length === 0) {
          const logMsg = `[${now.toISOString()}] Failed: Nenhuma sessão WAHA configurada.`;
          await db('campaigns').where({ id: campaign.id }).increment('failed', 1);
          await db('campaign_logs').insert({ campaignId: campaign.id, log: logMsg });
          continue;
        }

        let selectedSession = sessionsList[0];
        if (campaign.distributionMethod === 'round_robin') {
          const sessionIndex = campaign.sent % sessionsList.length;
          selectedSession = sessionsList[sessionIndex];
        } else {
          const randIndex = Math.floor(Math.random() * sessionsList.length);
          selectedSession = sessionsList[randIndex];
        }

        // Escolhe o template
        const templatesList = JSON.parse(campaign.templates);
        const template = templatesList[Math.floor(Math.random() * templatesList.length)];
        if (!template) continue;

        let messageText = template;
        
        // Mapeamento de placeholders {{name}} ou {{phone}}
        const placeholders = {
          name: pendingContact.name || 'Cliente',
          phone: pendingContact.phone,
          id: pendingContact.id
        };

        Object.keys(placeholders).forEach((key) => {
          const value = String((placeholders as any)[key] || '');
          const regex = new RegExp(`{{${key}}}`, 'gi');
          messageText = messageText.replace(regex, value);
        });

        // Spintax processing: {bom dia|olá|oPA}
        const resolveSpintax = (text: string): string => {
          const regex = /\{([^{}]+)\}/g;
          let matches = text.match(regex);
          while (matches) {
            for (const match of matches) {
              const options = match.substring(1, match.length - 1).split('|');
              const replacement = options[Math.floor(Math.random() * options.length)];
              text = text.replace(match, replacement);
            }
            matches = text.match(regex);
          }
          return text;
        };
        
        messageText = resolveSpintax(messageText);

        // Higieniza telefone
        let targetPhone = pendingContact.phone.replace(/\D/g, '');
        if (!targetPhone) {
          const logMsg = `[${now.toISOString()}] Failed: Sem telefone válido para ${pendingContact.name || pendingContact.id}`;
          await db('campaigns').where({ id: campaign.id }).increment('failed', 1);
          await db('campaign_logs').insert({ campaignId: campaign.id, log: logMsg });
          continue;
        }

        if (!targetPhone.includes('@')) {
          targetPhone += '@c.us';
        }

        // Disparo via WAHA
        try {
          const client = await getWahaClient();
          console.log(`[Campaign Runner] Disparando para ${targetPhone} via sessão "${selectedSession}"`);

          // Simula digitação humana
          try {
            await client.post('/api/startTyping', {
              chatId: targetPhone,
              session: selectedSession
            });
            const typingDelay = Math.min(Math.max(messageText.length * 50, 2000), 8000);
            await new Promise(resolve => setTimeout(resolve, typingDelay));
            await client.post('/api/stopTyping', {
              chatId: targetPhone,
              session: selectedSession
            });
          } catch (simError) {
            console.log('[Campaign Runner] Simulação de digitação ignorada:', simError);
          }

          // Disparo final
          await client.post('/api/sendText', {
            chatId: targetPhone,
            text: messageText,
            session: selectedSession
          });

          const logMsg = `[${now.toISOString()}] Sent to ${targetPhone} via ${selectedSession}`;
          await db('campaigns').where({ id: campaign.id }).increment('sent', 1);
          await db('campaign_logs').insert({ campaignId: campaign.id, log: logMsg });

        } catch (err: any) {
          console.error(`[Campaign Runner] Erro no envio para ${targetPhone}:`, err.message);
          const logMsg = `[${now.toISOString()}] Error ${targetPhone}: ${err.message}`;
          await db('campaigns').where({ id: campaign.id }).increment('failed', 1);
          await db('campaign_logs').insert({ campaignId: campaign.id, log: logMsg });
        }
      }
    }
  } catch (globalErr: any) {
    console.error('[Campaign Runner Error] Erro geral no runner:', globalErr.message);
  }
};

// Runner a cada 2 segundos
setInterval(processCampaigns, 2000);

// --- Vite Middleware & Boot Server ---
async function startServer() {
  console.log('[Boot] Inicializando servidor...');
  
  try {
    // 1. Executa Migrations do Knex
    await runMigrations();
    
    // 2. Importa dados históricos de data.json se houver
    await migrateLegacyJsonData();
  } catch (bootErr: any) {
    console.error('[Boot Error] Erro ao preparar banco de dados:', bootErr.message);
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
