import { Router } from 'express';
import multer from 'multer';
import axios from 'axios';
import crypto from 'crypto';
import { z } from 'zod';
import db from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { requireAuth, requireWebhookSecret } from '../auth/middleware';
import { verifyHmacSignature } from '../auth/hmac';
import { audit } from '../lib/audit';
import storage from '../storage';
import templatesRouter from './templates';
import apiTokensRouter from './api-tokens';
import outboundWebhooksRouter from './outbound-webhooks';
import contactsCsvRouter from './contacts-csv';
import { enqueueContactsBulk, removeCampaignJobs, SendJobData } from '../queue';
import { toWhatsappChatId } from '../lib/messaging';
import {
  getEntitlements,
  getRemainingQuota,
  countActiveContacts,
  countActiveCampaigns,
} from '../lib/entitlements';

const router = Router();

// All API routes require auth except auth/* and webhook.
router.use(requireAuth);

/**
 * Plan-limit guard. Returns null when allowed, or an {status,error} object to
 * send. Admins (platform owner) bypass all tenant quotas.
 */
async function checkLimit(
  userId: string,
  role: string,
  kind: 'contacts' | 'campaigns' | 'sessions',
  needed: number,
): Promise<{ status: number; error: string } | null> {
  if (role === 'admin') return null;
  const { plan } = await getEntitlements(userId);
  if (kind === 'contacts') {
    if (plan.maxContacts < 0) return null;
    const used = await countActiveContacts(userId);
    if (used + needed > plan.maxContacts) {
      return { status: 402, error: `Limite de ${plan.maxContacts} contatos do plano ${plan.name} atingido. Faça upgrade.` };
    }
  } else if (kind === 'campaigns') {
    if (plan.maxCampaigns < 0) return null;
    const used = await countActiveCampaigns(userId);
    if (used + needed > plan.maxCampaigns) {
      return { status: 402, error: `Limite de ${plan.maxCampaigns} campanhas do plano ${plan.name} atingido. Faça upgrade.` };
    }
  } else if (kind === 'sessions') {
    if (plan.maxSessions < 0) return null;
    if (needed > plan.maxSessions) {
      return { status: 402, error: `Plano ${plan.name} permite até ${plan.maxSessions} instância(s) WAHA por campanha.` };
    }
  }
  return null;
}

// Sub-routers (also under requireAuth)
router.use('/templates', templatesRouter);
router.use('/api-tokens', apiTokensRouter);
router.use('/outbound-webhooks', outboundWebhooksRouter);
router.use('/contacts/csv', contactsCsvRouter);

// -----------------------------------------------------------------------------
// Helpers (per-user scoped)
// -----------------------------------------------------------------------------
async function getActiveSettings(userId: string) {
  let row = await db('settings').where({ userId }).first();
  if (!row) {
    await db('settings').insert({
      // settings.id is auto-increment; new row per user
      wahaUrl: '',
      apiKey: '',
      userId,
    });
    row = await db('settings').where({ userId }).first();
  }
  return row;
}

async function getWahaClient(userId: string) {
  const settings = await getActiveSettings(userId);
  return axios.create({
    baseURL: settings.wahaUrl,
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { 'X-Api-Key': settings.apiKey } : {}),
    },
    timeout: 30_000,
  });
}

function maskApiKey(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

const MASKED_TOKEN_PREFIX = '****';

// -----------------------------------------------------------------------------
// Multer (validation handled by storage.uploadFile)
// -----------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.UPLOAD_MAX_BYTES },
});

// =============================================================================
// UPLOADS
// =============================================================================
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const result = await storage.uploadFile(
      {
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      },
      req.user!.id,
    );
    res.json(result);
  } catch (err: any) {
    const status = err?.status || 500;
    logger.warn({ err: err.message }, '[Upload] Rejected');
    res.status(status).json({ error: err.message });
  }
});

router.get('/uploads/:filename', (req, res) => {
  const provider: any = storage;
  if (typeof provider.serveLocal !== 'function') {
    return res.status(404).json({ error: 'Not found' });
  }
  const result = provider.serveLocal(req.user!.id, req.params.filename);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.mimetype) res.type(result.mimetype);
  result.stream.pipe(res);
});

// =============================================================================
// HEALTH
// =============================================================================
router.get('/health', async (_req, res) => {
  try {
    await db.raw('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch (err: any) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// =============================================================================
// SETTINGS
// =============================================================================
router.get('/settings', async (req, res) => {
  try {
    const s = await getActiveSettings(req.user!.id);
    res.json({ wahaUrl: s.wahaUrl || '', apiKey: maskApiKey(s.apiKey) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const settingsSchema = z.object({
  wahaUrl: z.string().url().or(z.literal('')).optional(),
  apiKey: z.string().optional(),
});

router.post('/settings', async (req, res) => {
  try {
    const data = settingsSchema.parse(req.body);
    const current = await getActiveSettings(req.user!.id);
    const update: any = {};
    if (data.wahaUrl !== undefined) update.wahaUrl = data.wahaUrl;
    // Only overwrite apiKey when the client sent a real (non-masked) value.
    if (data.apiKey !== undefined && !data.apiKey.startsWith(MASKED_TOKEN_PREFIX)) {
      update.apiKey = data.apiKey;
    }
    if (Object.keys(update).length > 0) {
      await db('settings').where({ id: current.id }).update(update);
    }
    res.json({ status: 'success' });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// WAHA proxy
// =============================================================================
router.get('/waha/sessions', async (req, res) => {
  try {
    const s = await getActiveSettings(req.user!.id);
    if (!s.wahaUrl) return res.json([]);
    const client = await getWahaClient(req.user!.id);
    const r = await client.get('/api/sessions');
    res.json(r.data);
  } catch (err: any) {
    logger.error({ err: err.message }, '[WAHA] sessions');
    res.status(500).json({ error: err.message });
  }
});

router.post('/waha/ping', async (req, res) => {
  try {
    const s = await getActiveSettings(req.user!.id);
    const targetUrl = req.body.wahaUrl || s.wahaUrl;
    let targetKey = req.body.apiKey !== undefined ? req.body.apiKey : s.apiKey;
    if (typeof targetKey === 'string' && targetKey.startsWith(MASKED_TOKEN_PREFIX)) {
      targetKey = s.apiKey;
    }
    if (!targetUrl) return res.status(400).json({ status: 'error', message: 'WAHA URL not set' });
    const client = axios.create({
      baseURL: targetUrl,
      headers: {
        'Content-Type': 'application/json',
        ...(targetKey ? { 'X-Api-Key': targetKey } : {}),
      },
      timeout: 15_000,
    });
    const r = await client.get('/ping');
    res.json(r.data);
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/waha/sendTestMessage', async (req, res) => {
  try {
    const s = await getActiveSettings(req.user!.id);
    if (!s.wahaUrl) return res.status(400).json({ error: 'WAHA URL not set' });
    const { session, phone, text } = req.body || {};
    const chatId = toWhatsappChatId(phone || '');
    if (!chatId) return res.status(400).json({ error: 'Invalid phone' });
    const client = await getWahaClient(req.user!.id);
    const r = await client.post('/api/sendText', { chatId, text, session });
    res.json(r.data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// CONTACTS
// =============================================================================
router.get('/contacts', async (req, res) => {
  try {
    const userId = req.user!.id;
    const contacts = await db('contacts').where({ userId }).whereNull('deletedAt').orderBy('createdAt', 'desc');
    const relations = await db('group_contacts')
      .join('groups', 'group_contacts.groupId', 'groups.id')
      .where('groups.userId', userId)
      .select('group_contacts.contactId', 'groups.id', 'groups.name');

    const map = new Map<string, any[]>();
    for (const r of relations) {
      if (!map.has(r.contactId)) map.set(r.contactId, []);
      map.get(r.contactId)!.push({ id: r.id, name: r.name });
    }
    res.json(
      contacts.map((c) => ({
        _id: c.id,
        name: c.name,
        phone: c.phone,
        blacklisted: !!c.blacklisted,
        groups: map.get(c.id) || [],
      })),
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/contacts/import', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { contacts } = req.body || {};
    if (!Array.isArray(contacts)) return res.status(400).json({ error: 'Invalid contacts list' });

    const phones = contacts
      .map((c: any) => (c.phone || c.telefone || '').toString().replace(/\D/g, '').trim())
      .filter(Boolean);
    if (phones.length === 0) return res.json({ success: true, count: 0 });

    const existing = await db('contacts').where({ userId }).whereIn('phone', phones);
    const existingMap = new Map<string, any>();
    existing.forEach((c) => existingMap.set(c.phone, c));

    // Enforce plan contact cap on the net-new contacts being added.
    const uniqueNew = new Set(phones.filter((p) => !existingMap.has(p)));
    const limit = await checkLimit(userId, req.user!.role, 'contacts', uniqueNew.size);
    if (limit) return res.status(limit.status).json({ error: limit.error });

    const toInsert: any[] = [];
    let added = 0;
    for (const c of contacts) {
      const phone = (c.phone || c.telefone || '').toString().replace(/\D/g, '').trim();
      if (!phone) continue;
      const ex = existingMap.get(phone);
      if (!ex) {
        toInsert.push({
          id: crypto.randomUUID(),
          name: c.name ?? null,
          phone,
          blacklisted: !!c.blacklisted,
          userId,
        });
        added++;
      } else if (c.name !== undefined) {
        await db('contacts').where({ id: ex.id }).update({ name: c.name });
      }
    }
    if (toInsert.length > 0) await db.batchInsert('contacts', toInsert, 100);
    res.json({ success: true, count: added });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/contacts/:id/campaigns', async (req, res) => {
  try {
    const userId = req.user!.id;
    const contact = await db('contacts').where({ id: req.params.id, userId }).first();
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const logs = await db('campaign_logs')
      .join('campaigns', 'campaign_logs.campaignId', 'campaigns.id')
      .where('campaigns.userId', userId)
      .where('campaign_logs.contactId', contact.id)
      .select(
        'campaigns.id',
        'campaigns.name',
        'campaigns.startTime',
        'campaign_logs.log',
        'campaign_logs.status',
        'campaign_logs.createdAt',
      )
      .orderBy('campaign_logs.createdAt', 'desc');

    const pending = await db('campaign_pending_contacts')
      .join('campaigns', 'campaign_pending_contacts.campaignId', 'campaigns.id')
      .where('campaigns.userId', userId)
      .where('campaign_pending_contacts.contactId', contact.id)
      .select('campaigns.id', 'campaigns.name', 'campaigns.startTime');

    const out = new Map<string, any>();
    for (const l of logs) {
      let status = l.status || '';
      if (!status) {
        if (l.log.includes('Sent to')) status = 'Enviado';
        else if (l.log.includes('Skipped') || l.log.includes('Blacklisted'))
          status = 'Bloqueado/Blacklist';
        else status = 'Erro';
      }
      out.set(l.id, {
        id: l.id,
        name: l.name,
        startTime: l.startTime,
        status,
        logAt: l.createdAt,
        logMsg: l.log,
      });
    }
    for (const p of pending) {
      if (!out.has(p.id)) {
        out.set(p.id, {
          id: p.id,
          name: p.name,
          startTime: p.startTime,
          status: 'Na fila',
          logAt: null,
          logMsg: '',
        });
      }
    }
    res.json(Array.from(out.values()));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const contactUpdateSchema = z.object({
  name: z.string().nullable().optional(),
  phone: z.string().optional(),
  blacklisted: z.boolean().optional(),
});

router.put('/contacts/:id', async (req, res) => {
  try {
    const userId = req.user!.id;
    const data = contactUpdateSchema.parse(req.body);
    const contact = await db('contacts').where({ id: req.params.id, userId }).first();
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const upd: any = {};
    if (data.name !== undefined) upd.name = data.name;
    if (data.phone !== undefined) upd.phone = data.phone.replace(/\D/g, '').trim();
    if (data.blacklisted !== undefined) upd.blacklisted = !!data.blacklisted;
    if (Object.keys(upd).length > 0) {
      await db('contacts').where({ id: contact.id }).update(upd);
    }
    const updated = await db('contacts').where({ id: contact.id }).first();
    res.json({
      _id: updated.id,
      name: updated.name,
      phone: updated.phone,
      blacklisted: !!updated.blacklisted,
    });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/contacts/:id', async (req, res) => {
  try {
    const userId = req.user!.id;
    const contact = await db('contacts').where({ id: req.params.id, userId }).whereNull('deletedAt').first();
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    await db('contacts').where({ id: contact.id }).update({ deletedAt: new Date() });
    await audit({ userId, action: 'delete', entityType: 'contact', entityId: contact.id, ip: req.ip });
    res.json({ status: 'success' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// GROUPS
// =============================================================================
router.get('/groups', async (req, res) => {
  try {
    const userId = req.user!.id;
    const groups = await db('groups')
      .leftJoin('group_contacts', 'groups.id', 'group_contacts.groupId')
      .where('groups.userId', userId)
      .whereNull('groups.deletedAt')
      .select('groups.id', 'groups.name')
      .count({ count: 'group_contacts.contactId' })
      .groupBy('groups.id', 'groups.name')
      .orderBy('groups.name', 'asc');
    res.json(groups.map((g: any) => ({ id: g.id, name: g.name, count: Number(g.count || 0) })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function upsertContactsForUser(userId: string, contacts: any[]): Promise<string[]> {
  const ids: string[] = [];
  for (const c of contacts) {
    const phone = (c.phone || c.telefone || '').toString().replace(/\D/g, '').trim();
    let existing: any = null;
    if (c._id) existing = await db('contacts').where({ id: c._id, userId }).first();
    if (!existing && phone) existing = await db('contacts').where({ phone, userId }).first();

    let cid: string;
    if (!existing) {
      cid = c._id || crypto.randomUUID();
      await db('contacts').insert({
        id: cid,
        name: c.name ?? null,
        phone: phone || '',
        blacklisted: !!c.blacklisted,
        userId,
      });
    } else {
      cid = existing.id;
      const upd: any = {};
      if (c.name !== undefined && c.name !== existing.name) upd.name = c.name;
      if (phone && phone !== existing.phone) upd.phone = phone;
      if (c.blacklisted !== undefined) upd.blacklisted = !!c.blacklisted;
      if (Object.keys(upd).length > 0) await db('contacts').where({ id: cid }).update(upd);
    }
    if (!ids.includes(cid)) ids.push(cid);
  }
  return ids;
}

router.post('/groups', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { name, contacts } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Group name is required' });
    const groupId = crypto.randomUUID();
    await db('groups').insert({ id: groupId, name, userId });
    const ids = Array.isArray(contacts) ? await upsertContactsForUser(userId, contacts) : [];
    if (ids.length > 0) {
      await db.batchInsert('group_contacts', ids.map((cid) => ({ groupId, contactId: cid })), 100);
    }
    res.json({ id: groupId, name, contactIds: ids });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/groups/:id', async (req, res) => {
  try {
    const userId = req.user!.id;
    const group = await db('groups').where({ id: req.params.id, userId }).first();
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const contacts = await db('contacts')
      .join('group_contacts', 'contacts.id', 'group_contacts.contactId')
      .where('group_contacts.groupId', group.id)
      .where('contacts.userId', userId)
      .select('contacts.*');
    res.json({
      id: group.id,
      name: group.name,
      contacts: contacts.map((c) => ({
        _id: c.id,
        name: c.name,
        phone: c.phone,
        blacklisted: !!c.blacklisted,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/groups/:id', async (req, res) => {
  try {
    const userId = req.user!.id;
    const group = await db('groups').where({ id: req.params.id, userId }).first();
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const { name, contacts } = req.body || {};
    if (name !== undefined) await db('groups').where({ id: group.id }).update({ name });
    if (Array.isArray(contacts)) {
      const ids = await upsertContactsForUser(userId, contacts);
      await db('group_contacts').where({ groupId: group.id }).delete();
      if (ids.length > 0) {
        await db.batchInsert(
          'group_contacts',
          ids.map((cid) => ({ groupId: group.id, contactId: cid })),
          100,
        );
      }
    }
    const updated = await db('contacts')
      .join('group_contacts', 'contacts.id', 'group_contacts.contactId')
      .where('group_contacts.groupId', group.id)
      .select('contacts.*');
    res.json({
      id: group.id,
      name: name || group.name,
      contacts: updated.map((c) => ({
        _id: c.id,
        name: c.name,
        phone: c.phone,
        blacklisted: !!c.blacklisted,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/groups/:id', async (req, res) => {
  try {
    const userId = req.user!.id;
    const running = await db('campaigns')
      .where({ groupId: req.params.id, status: 'Running', userId })
      .first();
    if (running) {
      return res
        .status(400)
        .json({ error: 'Não é possível excluir um grupo em uso por campanha em andamento.' });
    }
    const group = await db('groups').where({ id: req.params.id, userId }).whereNull('deletedAt').first();
    if (!group) return res.status(404).json({ error: 'Group not found' });
    await db('groups').where({ id: group.id }).update({ deletedAt: new Date() });
    await audit({ userId, action: 'delete', entityType: 'group', entityId: group.id, ip: req.ip });
    res.json({ status: 'success' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// CAMPAIGNS
// =============================================================================
function shapeCampaign(c: any, pendings: any[], logs: any[]) {
  return {
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
    pendingContacts: pendings.map((p: any) => ({
      _id: p.id,
      name: p.name,
      phone: p.phone,
      _paused: !!p.paused,
    })),
    logs: logs.map((l: any) => l.log),
  };
}

router.get('/campaigns', async (req, res) => {
  try {
    const userId = req.user!.id;
    const campaigns = await db('campaigns')
      .where({ userId })
      .whereNull('deletedAt')
      .select('*')
      .orderBy('createdAt', 'desc');
    const ids = campaigns.map((c) => c.id);

    // Single batched queries to avoid N+1
    const allPendings = ids.length
      ? await db('contacts')
          .join('campaign_pending_contacts', 'contacts.id', 'campaign_pending_contacts.contactId')
          .whereIn('campaign_pending_contacts.campaignId', ids)
          .select(
            'contacts.id',
            'contacts.name',
            'contacts.phone',
            'campaign_pending_contacts.paused',
            'campaign_pending_contacts.campaignId',
            'campaign_pending_contacts.order',
          )
          .orderBy('campaign_pending_contacts.order', 'asc')
      : [];
    const allLogs = ids.length
      ? await db('campaign_logs')
          .whereIn('campaignId', ids)
          .select('campaignId', 'log')
          .orderBy('id', 'desc')
      : [];

    const pendingsByCamp = new Map<string, any[]>();
    for (const p of allPendings) {
      if (!pendingsByCamp.has(p.campaignId)) pendingsByCamp.set(p.campaignId, []);
      const list = pendingsByCamp.get(p.campaignId)!;
      if (list.length < 200) list.push(p);
    }
    const logsByCamp = new Map<string, any[]>();
    for (const l of allLogs) {
      if (!logsByCamp.has(l.campaignId)) logsByCamp.set(l.campaignId, []);
      logsByCamp.get(l.campaignId)!.push(l);
    }

    res.json(
      campaigns.map((c) =>
        shapeCampaign(c, pendingsByCamp.get(c.id) || [], logsByCamp.get(c.id) || []),
      ),
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/campaigns/:id', async (req, res) => {
  try {
    const userId = req.user!.id;
    const c = await db('campaigns').where({ id: req.params.id, userId }).first();
    if (!c) return res.status(404).json({ error: 'Campaign not found' });
    const pendings = await db('contacts')
      .join('campaign_pending_contacts', 'contacts.id', 'campaign_pending_contacts.contactId')
      .where('campaign_pending_contacts.campaignId', c.id)
      .select(
        'contacts.id',
        'contacts.name',
        'contacts.phone',
        'campaign_pending_contacts.paused',
      )
      .orderBy('campaign_pending_contacts.order', 'asc');
    const logs = await db('campaign_logs')
      .where({ campaignId: c.id })
      .select('log')
      .orderBy('id', 'desc');
    res.json(shapeCampaign(c, pendings, logs));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const campaignCreateSchema = z.object({
  name: z.string().min(1),
  groupId: z.string().min(1),
  sessions: z.array(z.string()).default([]),
  startTime: z.string().optional(),
  endTime: z.string().nullable().optional(),
  schedules: z.array(z.any()).optional(),
  intervalMin: z.number().int().min(0).default(30),
  intervalMax: z.number().int().min(0).default(60),
  distributionMethod: z.string().default('round_robin'),
  templates: z.array(z.string()).default([]),
});

router.post('/campaigns', async (req, res) => {
  try {
    const userId = req.user!.id;
    const data = campaignCreateSchema.parse(req.body);
    const group = await db('groups').where({ id: data.groupId, userId }).first();
    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Plan limits: number of campaigns and WAHA sessions per campaign.
    const campLimit = await checkLimit(userId, req.user!.role, 'campaigns', 1);
    if (campLimit) return res.status(campLimit.status).json({ error: campLimit.error });
    const sessLimit = await checkLimit(userId, req.user!.role, 'sessions', data.sessions.length);
    if (sessLimit) return res.status(sessLimit.status).json({ error: sessLimit.error });

    const campId = crypto.randomUUID();
    const groupContacts = await db('contacts')
      .join('group_contacts', 'contacts.id', 'group_contacts.contactId')
      .where('group_contacts.groupId', group.id)
      .where('contacts.userId', userId)
      .select('contacts.*');

    const startTime = data.startTime ? new Date(data.startTime) : new Date();
    await db('campaigns').insert({
      id: campId,
      name: data.name,
      groupId: group.id,
      groupName: group.name,
      sessions: JSON.stringify(data.sessions),
      startTime,
      endTime: data.endTime ? new Date(data.endTime) : null,
      schedules: JSON.stringify(data.schedules || []),
      intervalMin: data.intervalMin,
      intervalMax: data.intervalMax,
      distributionMethod: data.distributionMethod,
      templates: JSON.stringify(data.templates),
      status: 'Draft',
      totalContacts: groupContacts.length,
      sent: 0,
      failed: 0,
      createdAt: new Date(),
      nextSendTime: startTime,
      userId,
    });

    if (groupContacts.length > 0) {
      await db.batchInsert(
        'campaign_pending_contacts',
        groupContacts.map((c, idx) => ({
          campaignId: campId,
          contactId: c.id,
          paused: false,
          order: idx,
        })),
        100,
      );
    }

    res.json({
      id: campId,
      name: data.name,
      groupId: group.id,
      groupName: group.name,
      sessions: data.sessions,
      startTime,
      endTime: data.endTime,
      schedules: data.schedules || [],
      intervalMin: data.intervalMin,
      intervalMax: data.intervalMax,
      distributionMethod: data.distributionMethod,
      templates: data.templates,
      status: 'Draft',
      totalContacts: groupContacts.length,
      sent: 0,
      failed: 0,
      pendingContacts: groupContacts.map((c) => ({ _id: c.id, name: c.name, phone: c.phone })),
      logs: [],
    });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0].message });
    res.status(500).json({ error: err.message });
  }
});

router.put('/campaigns/:id', async (req, res) => {
  try {
    const userId = req.user!.id;
    const camp = await db('campaigns').where({ id: req.params.id, userId }).first();
    if (!camp) return res.status(404).json({ error: 'Campaign not found' });

    const b = req.body || {};
    const upd: any = {};
    if (b.name !== undefined) upd.name = b.name;
    if (b.sessions !== undefined) upd.sessions = JSON.stringify(b.sessions);
    if (b.startTime !== undefined) upd.startTime = new Date(b.startTime);
    if (b.endTime !== undefined) upd.endTime = b.endTime ? new Date(b.endTime) : null;
    if (b.schedules !== undefined) upd.schedules = JSON.stringify(b.schedules);
    if (b.intervalMin !== undefined) upd.intervalMin = b.intervalMin;
    if (b.intervalMax !== undefined) upd.intervalMax = b.intervalMax;
    if (b.distributionMethod !== undefined) upd.distributionMethod = b.distributionMethod;
    if (b.templates !== undefined) upd.templates = JSON.stringify(b.templates);

    if (b.groupId !== undefined && b.groupId !== camp.groupId) {
      const group = await db('groups').where({ id: b.groupId, userId }).first();
      if (!group) return res.status(404).json({ error: 'Group not found' });
      upd.groupId = group.id;
      upd.groupName = group.name;

      const gc = await db('contacts')
        .join('group_contacts', 'contacts.id', 'group_contacts.contactId')
        .where('group_contacts.groupId', group.id)
        .where('contacts.userId', userId)
        .select('contacts.*');
      upd.totalContacts = gc.length;
      upd.sent = 0;
      upd.failed = 0;
      await db('campaign_pending_contacts').where({ campaignId: camp.id }).delete();
      await db('campaign_logs').where({ campaignId: camp.id }).delete();
      await removeCampaignJobs(camp.id);
      if (gc.length > 0) {
        await db.batchInsert(
          'campaign_pending_contacts',
          gc.map((c, idx) => ({
            campaignId: camp.id,
            contactId: c.id,
            paused: false,
            order: idx,
          })),
          100,
        );
      }
    }

    if ((camp.status === 'Draft' || camp.status === 'Paused') && b.startTime !== undefined) {
      upd.nextSendTime = new Date(b.startTime);
    }

    if (Object.keys(upd).length > 0) await db('campaigns').where({ id: camp.id }).update(upd);
    const updated = await db('campaigns').where({ id: camp.id }).first();
    res.json(shapeCampaign(updated, [], []));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/campaigns/:id/toggle', async (req, res) => {
  try {
    const userId = req.user!.id;
    const camp = await db('campaigns').where({ id: req.params.id, userId }).first();
    if (!camp) return res.status(404).json({ error: 'Campaign not found' });

    let newStatus = camp.status;
    if (camp.status === 'Paused' || camp.status === 'Draft') {
      const now = new Date();
      const start = new Date(camp.startTime);
      newStatus = start > now ? 'Scheduled' : 'Running';
    } else if (camp.status === 'Running' || camp.status === 'Scheduled') {
      newStatus = 'Paused';
    }

    if (newStatus === 'Running' || newStatus === 'Scheduled') {
      // Block (re)start when the monthly message quota cannot cover what's left.
      const pendingCount = await db('campaign_pending_contacts')
        .where({ campaignId: camp.id, paused: false })
        .count({ c: '*' })
        .first();
      const needed = Number(pendingCount?.c || 0);
      if (req.user!.role !== 'admin') {
        const remaining = await getRemainingQuota(userId);
        if (remaining < needed) {
          return res.status(402).json({
            error: `Sua cota mensal de mensagens é insuficiente (restam ${remaining}, a campanha precisa de ${needed}). Faça upgrade do plano.`,
            code: 'quota_exceeded',
          });
        }
      }
    }

    await db('campaigns').where({ id: camp.id }).update({ status: newStatus });

    if (newStatus === 'Running') {
      // Enqueue pending contacts that aren't paused.
      const pending = await db('campaign_pending_contacts')
        .where({ campaignId: camp.id, paused: false })
        .select('contactId')
        .orderBy('order', 'asc');
      const payload: SendJobData[] = pending.map((p) => ({
        campaignId: camp.id,
        contactId: p.contactId,
        userId,
      }));
      await enqueueContactsBulk(payload);
    } else if (newStatus === 'Paused') {
      await removeCampaignJobs(camp.id);
    }

    res.json({ id: camp.id, status: newStatus });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/campaigns/:id', async (req, res) => {
  try {
    const userId = req.user!.id;
    const camp = await db('campaigns').where({ id: req.params.id, userId }).whereNull('deletedAt').first();
    if (!camp) return res.status(404).json({ error: 'Campaign not found' });
    await removeCampaignJobs(camp.id);
    await db('campaigns').where({ id: camp.id }).update({ deletedAt: new Date(), status: 'Cancelled' });
    await audit({ userId, action: 'delete', entityType: 'campaign', entityId: camp.id, ip: req.ip });
    res.json({ status: 'success' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// QUEUE (per-user view + paused/delete by stable index per campaign)
// =============================================================================
router.get('/queue', async (req, res) => {
  try {
    const userId = req.user!.id;
    const rows = await db('campaign_pending_contacts')
      .join('campaigns', 'campaign_pending_contacts.campaignId', 'campaigns.id')
      .leftJoin('contacts', 'campaign_pending_contacts.contactId', 'contacts.id')
      .where('campaigns.userId', userId)
      .select(
        'campaign_pending_contacts.campaignId',
        'campaigns.name as campaignName',
        'campaigns.status as campaignStatus',
        'contacts.name as contactName',
        'contacts.phone as contactPhone',
        'campaign_pending_contacts.paused as isPaused',
        'campaign_pending_contacts.order',
      )
      .orderBy('campaign_pending_contacts.campaignId')
      .orderBy('campaign_pending_contacts.order', 'asc')
      .limit(1000);
    res.json(
      rows.map((q: any, idx: number) => ({
        campaignId: q.campaignId,
        campaignName: q.campaignName,
        contactName: q.contactName || 'N/A',
        contactPhone: q.contactPhone || 'N/A',
        index: idx,
        isPaused: !!q.isPaused,
        campaignStatus: q.campaignStatus,
      })),
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/campaigns/:id/queue/:index', async (req, res) => {
  try {
    const userId = req.user!.id;
    const camp = await db('campaigns').where({ id: req.params.id, userId }).first();
    if (!camp) return res.status(404).json({ error: 'Not found' });
    const idx = parseInt(req.params.index, 10);
    if (isNaN(idx) || idx < 0) return res.status(400).json({ error: 'Invalid index' });
    const queue = await db('campaign_pending_contacts')
      .where({ campaignId: camp.id })
      .orderBy('order', 'asc')
      .select('*');
    const target = queue[idx];
    if (!target) return res.status(404).json({ error: 'Not found' });
    await db('campaign_pending_contacts')
      .where({ campaignId: camp.id, contactId: target.contactId })
      .delete();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/campaigns/:id/queue/:index/toggle', async (req, res) => {
  try {
    const userId = req.user!.id;
    const camp = await db('campaigns').where({ id: req.params.id, userId }).first();
    if (!camp) return res.status(404).json({ error: 'Not found' });
    const idx = parseInt(req.params.index, 10);
    if (isNaN(idx) || idx < 0) return res.status(400).json({ error: 'Invalid index' });
    const queue = await db('campaign_pending_contacts')
      .where({ campaignId: camp.id })
      .orderBy('order', 'asc')
      .select('*');
    const target = queue[idx];
    if (!target) return res.status(404).json({ error: 'Not found' });
    const newPaused = !target.paused;
    await db('campaign_pending_contacts')
      .where({ campaignId: camp.id, contactId: target.contactId })
      .update({ paused: newPaused });
    res.json({ success: true, paused: newPaused });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// WAHA WEBHOOK (no JWT — protected by shared secret + optional HMAC)
// =============================================================================
export const webhookRouter = Router();
webhookRouter.post('/waha/webhook', requireWebhookSecret(config.WAHA_WEBHOOK_SECRET), async (req, res) => {
  try {
    // Optional HMAC: when enabled, body MUST come signed in X-Webhook-Signature
    if (config.WAHA_WEBHOOK_HMAC) {
      const raw = (req as any).rawBody as Buffer | undefined;
      const sig = req.header('X-Webhook-Signature') || req.header('X-Hub-Signature-256') || '';
      if (!raw || !verifyHmacSignature(raw, config.WAHA_WEBHOOK_SECRET || '', sig)) {
        return res.status(401).json({ error: 'Invalid HMAC signature' });
      }
    }

    const body = req.body || {};
    const event: string = body.event || body.type || 'unknown';
    const payload = body.payload || body.data || body;
    const wahaMessageId = payload?.id || payload?.messageId || payload?.message?.id;
    const ackStatus = payload?.ack || payload?.status;

    if (!wahaMessageId) return res.json({ ok: true, ignored: 'no-id' });

    const existing = await db('message_status').where({ wahaMessageId }).first();
    const status =
      typeof ackStatus === 'string'
        ? ackStatus.toLowerCase()
        : ackStatus === 1
          ? 'sent'
          : ackStatus === 2
            ? 'delivered'
            : ackStatus === 3
              ? 'read'
              : 'failed';

    if (existing) {
      await db('message_status').where({ id: existing.id }).update({
        status,
        updatedAt: new Date(),
      });
      if (status === 'failed' && existing.status !== 'failed') {
        await db('campaigns').where({ id: existing.campaignId }).increment('failed', 1);
        await db('campaigns').where({ id: existing.campaignId }).decrement('sent', 1);
      }
    }
    res.json({ ok: true, event, status });
  } catch (err: any) {
    logger.error({ err: err.message }, '[Webhook] error');
    res.status(500).json({ error: err.message });
  }
});

export default router;
