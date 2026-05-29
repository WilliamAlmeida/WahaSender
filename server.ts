import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import axios from 'axios';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

// In-memory data store for persistence
const DATA_FILE = path.join(process.cwd(), 'data.json');
let dataStore = {
  settings: { wahaUrl: '', apiKey: '' },
  contacts: [] as any[],
  groups: [] as any[],
  campaigns: [] as any[],
};

// Save data
const saveData = () => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(dataStore, null, 2));
};

// Load data
if (fs.existsSync(DATA_FILE)) {
  try {
    dataStore = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    
    let modified = false;
    
    // Initialize global contacts if missing
    if (!dataStore.contacts) {
      dataStore.contacts = [];
      modified = true;
    }

    // Migrate old groups to ensure all contacts use the global index
    dataStore.groups.forEach(g => {
      if (g.contacts) {
        g.contactIds = [];
        g.contacts.forEach((c: any) => {
          let cleanPhone = (c.phone || c.telefone || '').toString().trim();
          let existing = null;
          
          if (cleanPhone) {
            existing = dataStore.contacts.find(x => (x.phone || x.telefone) === cleanPhone);
          }
          
          if (!existing) {
            existing = { ...c, _id: c._id || Date.now().toString() + Math.random().toString(36).substr(2, 9) };
            dataStore.contacts.push(existing);
          }
          
          if (!g.contactIds.includes(existing._id)) {
            g.contactIds.push(existing._id);
          }
        });
        delete g.contacts;
        modified = true;
      }
    });

    if (modified) {
      saveData();
    }
  } catch (e) {
    console.error('Error reading data file', e);
  }
}

// Global Contact population helper
const getPopulatedContacts = (groupId: string) => {
  const group = dataStore.groups.find(g => g.id === groupId);
  if (!group || !group.contactIds) return [];
  return group.contactIds.map((id: string) => dataStore.contacts.find(c => c._id === id)).filter(Boolean);
};


// Helper: WAHA Axios Instance
const getWahaClient = () => {
  return axios.create({
    baseURL: dataStore.settings.wahaUrl,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': dataStore.settings.apiKey,
    },
  });
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/settings', (req, res) => {
  res.json(dataStore.settings);
});

app.post('/api/settings', (req, res) => {
  dataStore.settings = { ...dataStore.settings, ...req.body };
  saveData();
  res.json({ status: 'success' });
});

// Proxy to WAHA for sessions
app.get('/api/waha/sessions', async (req, res) => {
  if (!dataStore.settings.wahaUrl) return res.json([]);
  try {
    const client = getWahaClient();
    const response = await client.get('/api/sessions');
    res.json(response.data);
  } catch (e: any) {
    console.error('Error fetching WAHA sessions:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Proxy to test WAHA connection
app.post('/api/waha/ping', async (req, res) => {
  const targetUrl = req.body.wahaUrl || dataStore.settings.wahaUrl;
  const targetKey = req.body.apiKey !== undefined ? req.body.apiKey : dataStore.settings.apiKey;

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
  if (!dataStore.settings.wahaUrl) return res.status(400).json({ error: 'WAHA URL not set' });
  try {
    const { session, phone, text } = req.body;
    let targetPhone = phone.replace(/\D/g, ''); // keep only numbers
    if (!targetPhone.includes('@')) {
      targetPhone += '@c.us';
    }

    const client = getWahaClient();
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
app.get('/api/contacts', (req, res) => {
  const contactsWithGroups = (dataStore.contacts || []).map(contact => {
    const contactGroups = dataStore.groups
      .filter(g => g.contactIds && g.contactIds.includes(contact._id))
      .map(g => ({ id: g.id, name: g.name }));
    return { ...contact, groups: contactGroups };
  });
  res.json(contactsWithGroups);
});

app.post('/api/contacts/import', (req, res) => {
  const { contacts } = req.body;
  if (!contacts || !Array.isArray(contacts)) return res.status(400).json({ error: 'Invalid contacts list' });
  
  let addedCount = 0;
  contacts.forEach((c: any) => {
    let cleanPhone = (c.phone || c.telefone || '').toString().trim();
    if (!cleanPhone) return;
    
    let existing = dataStore.contacts.find(x => (x.phone || x.telefone) === cleanPhone);
    if (!existing) {
      existing = { ...c, _id: Date.now().toString() + Math.random().toString(36).substr(2, 9), blacklisted: !!c.blacklisted };
      dataStore.contacts.push(existing);
      addedCount++;
    } else {
      if (c.name !== undefined) existing.name = c.name;
    }
  });
  
  saveData();
  res.json({ success: true, count: addedCount });
});

app.get('/api/contacts/:id/campaigns', (req, res) => {
  const contact = dataStore.contacts.find(c => c._id === req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  
  const phoneStr = (contact.phone || contact.telefone || '').toString().trim();
  const contactCampaigns: any[] = [];
  
  if (phoneStr) {
    dataStore.campaigns.forEach((camp: any) => {
      let status = '';
      let logAt = null;
      let logMsg = '';
      
      const relatedLogs = (camp.logs || []).filter((l: string) => l.includes(phoneStr));
      const isPending = camp.pendingContacts && camp.pendingContacts.some((pc: any) => (pc.phone || pc.telefone) === phoneStr);
      
      if (relatedLogs.length > 0) {
        const lastLog: string = relatedLogs[0]; // descending order
        if (lastLog.includes('Sent to')) status = 'Enviado';
        else if (lastLog.includes('Skipped') || lastLog.includes('Blacklisted')) status = 'Bloqueado/Blacklist';
        else status = 'Erro';
        
        logAt = lastLog.split(']')[0].replace('[', '');
        logMsg = lastLog;
      } else if (isPending) {
        status = 'Na fila';
      }
      
      if (status) {
        contactCampaigns.push({
          id: camp.id,
          name: camp.name,
          startTime: camp.startTime,
          status,
          logAt,
          logMsg
        });
      }
    });
  }
  
  res.json(contactCampaigns);
});

app.put('/api/contacts/:id', (req, res) => {
  const index = dataStore.contacts.findIndex(c => c._id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Contact not found' });
  dataStore.contacts[index] = { ...dataStore.contacts[index], ...req.body };
  saveData();
  res.json(dataStore.contacts[index]);
});

app.delete('/api/contacts/:id', (req, res) => {
  // Remove from global
  dataStore.contacts = dataStore.contacts.filter(c => c._id !== req.params.id);
  // Remove from all groups
  dataStore.groups.forEach(g => {
    if (g.contactIds) {
      g.contactIds = g.contactIds.filter((id: string) => id !== req.params.id);
    }
  });
  saveData();
  res.json({ status: 'success' });
});

// Groups
app.get('/api/groups', (req, res) => {
  res.json(dataStore.groups.map(g => ({ id: g.id, name: g.name, count: g.contactIds ? g.contactIds.length : 0 })));
});

app.post('/api/groups', (req, res) => {
  const { name, contacts } = req.body;
  const contactIds: string[] = [];
  
  (contacts || []).forEach((c: any) => {
    let cleanPhone = (c.phone || c.telefone || '').toString().trim();
    let existing = null;
    
    if (cleanPhone) {
      existing = dataStore.contacts.find(x => (x.phone || x.telefone) === cleanPhone);
    }
    
    if (!existing) {
      existing = { ...c, _id: c._id || Date.now().toString() + Math.random().toString(36).substr(2, 9), blacklisted: !!c.blacklisted };
      dataStore.contacts.push(existing);
    } else {
      if (c.name && !existing.name) existing.name = c.name;
      if (c.blacklisted !== undefined) existing.blacklisted = c.blacklisted;
    }
    
    if (!contactIds.includes(existing._id)) {
      contactIds.push(existing._id);
    }
  });

  const newGroup = {
    id: Date.now().toString(),
    name,
    contactIds,
  };
  dataStore.groups.push(newGroup);
  saveData();
  res.json(newGroup);
});

app.get('/api/groups/:id', (req, res) => {
  const group = dataStore.groups.find(g => g.id === req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  res.json({ ...group, contacts: getPopulatedContacts(group.id) });
});

app.put('/api/groups/:id', (req, res) => {
  const groupIndex = dataStore.groups.findIndex(g => g.id === req.params.id);
  if (groupIndex === -1) return res.status(404).json({ error: 'Group not found' });
  
  const { name, contacts } = req.body;
  const group = dataStore.groups[groupIndex];
  
  if (name !== undefined) group.name = name;
  
  if (contacts !== undefined && Array.isArray(contacts)) {
    const contactIds: string[] = [];
    contacts.forEach((c: any) => {
      let cleanPhone = (c.phone || c.telefone || '').toString().trim();
      let existing = null;
      
      if (c._id) {
        existing = dataStore.contacts.find(x => x._id === c._id);
      } 
      if (!existing && cleanPhone) {
        existing = dataStore.contacts.find(x => (x.phone || x.telefone) === cleanPhone);
      }
      
      if (!existing) {
        existing = { ...c, _id: c._id || Date.now().toString() + Math.random().toString(36).substr(2, 9), blacklisted: !!c.blacklisted };
        dataStore.contacts.push(existing);
      } else {
        if (c.name !== undefined) existing.name = c.name;
        if (c.phone !== undefined) existing.phone = c.phone;
        if (c.blacklisted !== undefined) existing.blacklisted = c.blacklisted;
      }
      
      if (!contactIds.includes(existing._id)) {
        contactIds.push(existing._id);
      }
    });
    group.contactIds = contactIds;
  }
  
  saveData();
  res.json({ ...group, contacts: getPopulatedContacts(group.id) });
});

app.delete('/api/groups/:id', (req, res) => {
  const isUsedInRunningCampaign = dataStore.campaigns.some(c => c.groupId === req.params.id && c.status === 'Running');
  if (isUsedInRunningCampaign) {
    return res.status(400).json({ error: 'Não é possível excluir um grupo que está sendo usado em uma campanha em andamento.' });
  }
  dataStore.groups = dataStore.groups.filter(g => g.id !== req.params.id);
  saveData();
  res.json({ status: 'success' });
});

// Campaigns
app.get('/api/campaigns', (req, res) => {
  res.json(dataStore.campaigns);
});

app.post('/api/campaigns', (req, res) => {
  const group = dataStore.groups.find(g => g.id === req.body.groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const newCampaign = {
    id: Date.now().toString(),
    name: req.body.name,
    groupId: req.body.groupId,
    groupName: group.name,
    sessions: req.body.sessions,
    startTime: req.body.startTime,
    endTime: req.body.endTime,
    schedules: req.body.schedules || [],
    intervalMin: req.body.intervalMin || 30,
    intervalMax: req.body.intervalMax || 60,
    distributionMethod: req.body.distributionMethod || 'round_robin',
    templates: req.body.templates || [],
    status: 'Draft',
    totalContacts: getPopulatedContacts(group.id).length,
    sent: 0,
    failed: 0,
    pendingContacts: [...getPopulatedContacts(group.id)],
    logs: [],
    createdAt: new Date().toISOString(),
    nextSendTime: req.body.startTime,
  };

  dataStore.campaigns.push(newCampaign);
  saveData();
  res.json(newCampaign);
});

app.put('/api/campaigns/:id', (req, res) => {
  const campaignIndex = dataStore.campaigns.findIndex(c => c.id === req.params.id);
  if (campaignIndex === -1) return res.status(404).json({ error: 'Campaign not found' });

  const campaign = dataStore.campaigns[campaignIndex];
  
  if (req.body.groupId && req.body.groupId !== campaign.groupId) {
    const group = dataStore.groups.find(g => g.id === req.body.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    campaign.groupId = req.body.groupId;
    campaign.groupName = group.name;
    const populatedContacts = getPopulatedContacts(group.id);
    campaign.totalContacts = populatedContacts.length;
    // reset pending contacts
    campaign.pendingContacts = [...populatedContacts];
    campaign.sent = 0;
    campaign.failed = 0;
    campaign.logs = [];
  }

  campaign.name = req.body.name || campaign.name;
  campaign.sessions = req.body.sessions || campaign.sessions;
  campaign.startTime = req.body.startTime || campaign.startTime;
  campaign.endTime = req.body.endTime !== undefined ? req.body.endTime : campaign.endTime;
  campaign.schedules = req.body.schedules || campaign.schedules;
  campaign.intervalMin = req.body.intervalMin || campaign.intervalMin;
  campaign.intervalMax = req.body.intervalMax || campaign.intervalMax;
  campaign.distributionMethod = req.body.distributionMethod || campaign.distributionMethod;
  campaign.templates = req.body.templates || campaign.templates;
  if (campaign.status === 'Draft' || campaign.status === 'Paused') {
     campaign.nextSendTime = req.body.startTime || campaign.startTime;
  }
  
  saveData();
  res.json(campaign);
});


app.get('/api/campaigns/:id', (req, res) => {
  const campaign = dataStore.campaigns.find(c => c.id === req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  res.json(campaign);
});

app.post('/api/campaigns/:id/toggle', (req, res) => {
  const campaign = dataStore.campaigns.find(c => c.id === req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  
  if (campaign.status === 'Paused' || campaign.status === 'Draft') {
    const now = new Date();
    const start = new Date(campaign.startTime);
    campaign.status = start > now ? 'Scheduled' : 'Running';
  } else if (campaign.status === 'Running' || campaign.status === 'Scheduled') {
    campaign.status = 'Paused';
  }
  saveData();
  res.json(campaign);
});

app.delete('/api/campaigns/:id', (req, res) => {
  dataStore.campaigns = dataStore.campaigns.filter(c => c.id !== req.params.id);
  saveData();
  res.json({ status: 'success' });
});

// Queue API
app.get('/api/queue', (req, res) => {
  const queue: any[] = [];
  dataStore.campaigns.forEach(c => {
    if (c.status === 'Running' || c.status === 'Paused') {
      // Return top 200 to avoid massive payloads
      c.pendingContacts.slice(0, 200).forEach((contact: any, idx: number) => {
        queue.push({
          campaignId: c.id,
          campaignName: c.name,
          contactName: contact.name || contact.Name || contact.nome || 'N/A',
          contactPhone: contact.phone || contact.Phone || contact.telefone || contact.Telefone || contact.telefone1 || 'N/A',
          index: idx,
          isPaused: !!contact._paused,
          campaignStatus: c.status
        });
      });
    }
  });
  res.json(queue);
});

app.delete('/api/campaigns/:id/queue/:index', (req, res) => {
  const campaign = dataStore.campaigns.find(c => c.id === req.params.id);
  if (campaign && campaign.pendingContacts) {
    const idx = parseInt(req.params.index);
    if (!isNaN(idx) && idx >= 0 && idx < campaign.pendingContacts.length) {
      campaign.pendingContacts.splice(idx, 1);
      saveData();
      return res.json({ success: true });
    }
  }
  res.status(404).json({ error: 'Not found' });
});

app.post('/api/campaigns/:id/queue/:index/toggle', (req, res) => {
  const campaign = dataStore.campaigns.find(c => c.id === req.params.id);
  if (campaign && campaign.pendingContacts) {
    const idx = parseInt(req.params.index);
    if (!isNaN(idx) && idx >= 0 && idx < campaign.pendingContacts.length) {
      campaign.pendingContacts[idx]._paused = !campaign.pendingContacts[idx]._paused;
      saveData();
      return res.json({ success: true, paused: campaign.pendingContacts[idx]._paused });
    }
  }
  res.status(404).json({ error: 'Not found' });
});


// --- Campaign Runner Background Job ---
const processCampaigns = async () => {
  if (!dataStore.settings.wahaUrl) return; // Need WAHA config

  const now = new Date();
  const activeCampaigns = dataStore.campaigns.filter(c => {
    if (c.status !== 'Scheduled' && c.status !== 'Running') return false;
    const startTimeDate = new Date(c.startTime);
    const endTimeDate = c.endTime ? new Date(c.endTime) : null;
    if (startTimeDate > now) return false;
    if (endTimeDate && endTimeDate < now) {
      c.status = 'Completed';
      saveData();
      return false;
    }
    return true;
  });

  for (const campaign of activeCampaigns) {
    if (campaign.status === 'Scheduled') {
      campaign.status = 'Running';
      saveData();
    }

    if (campaign.pendingContacts.length === 0) {
      campaign.status = 'Completed';
      saveData();
      continue;
    }

    // Check if we are inside a valid schedule window for today
    if (campaign.schedules && campaign.schedules.length > 0) {
      const today = now.getDay();
      const daySchedule = campaign.schedules.find(s => s.dayOfWeek === today);
      if (!daySchedule || !daySchedule.slots || daySchedule.slots.length === 0) continue; // Not allowed to send today
      
      const currentHourStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
      let inSlot = false;
      for (const slot of daySchedule.slots) {
        if (currentHourStr >= slot.start && currentHourStr <= slot.end) {
          inSlot = true;
          break;
        }
      }
      if (!inSlot) continue;
    }

    // Check interval
    let shouldSend = false;
    if (!campaign.nextSendTime) {
      shouldSend = true;
    } else {
      if (now >= new Date(campaign.nextSendTime)) {
        shouldSend = true;
      }
    }

    if (shouldSend) {
      const min = campaign.intervalMin || 30;
      const max = campaign.intervalMax || 60;
      const delaySecs = Math.floor(Math.random() * ((max - min) / 10 + 1)) * 10 + min;
      campaign.nextSendTime = new Date(now.getTime() + delaySecs * 1000).toISOString();
      
      let contactIdx = -1;
      for (let i=0; i<campaign.pendingContacts.length; i++) {
        if (!campaign.pendingContacts[i]._paused) {
          contactIdx = i;
          break;
        }
      }
      
      if (contactIdx === -1) {
        // all remaining contacts are paused, wait.
        continue;
      }
      
      const contact = campaign.pendingContacts.splice(contactIdx, 1)[0];
      
      // Check if contact is globally blacklisted
      const globalContact = dataStore.contacts.find(c => c._id === contact._id);
      if (globalContact && globalContact.blacklisted) {
        campaign.failed++;
        campaign.logs.unshift(`[${now.toISOString()}] Skipped ${globalContact.phone || globalContact.telefone} (Blacklisted)`);
        saveData();
        continue;
      }
      
      // Determine Session/Instance to use
      let selectedSession = campaign.sessions[0];
      if (campaign.distributionMethod === 'round_robin') {
        const sessionIndex = campaign.sent % campaign.sessions.length;
        selectedSession = campaign.sessions[sessionIndex];
      } else {
        // Random
        const randIndex = Math.floor(Math.random() * campaign.sessions.length);
        selectedSession = campaign.sessions[randIndex];
      }

      // Pick a random template if multiple
      const template = campaign.templates[Math.floor(Math.random() * campaign.templates.length)];
      if (!template) continue;

      let messageText = template;
      // Replace placeholders e.g., {{name}} or {{Phone}}
      Object.keys(contact).forEach((key) => {
        const value = String(contact[key] || '');
        // Case insensitive replacement
        const regex = new RegExp(`{{${key}}}`, 'gi');
        messageText = messageText.replace(regex, value);
      });

      // Spintax processing: {option1|option2}
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

      // Target Phone cleanup
      let targetPhone = '' + (contact.phone || contact.Phone || contact.telefone || contact.Telefone || contact.telefone1 || '');
      targetPhone = targetPhone.replace(/\D/g, ''); // keep only numbers

      if (!targetPhone) {
        campaign.failed++;
        campaign.logs.unshift(`[${now.toISOString()}] Failed: No valid phone for contact ${contact.name || JSON.stringify(contact)}`);
        saveData();
        continue;
      }

      // Append @c.us if missing (assumes WAHA format)
      if (!targetPhone.includes('@')) {
        targetPhone += '@c.us';
      }

      // Send to WAHA
      try {
        const client = getWahaClient();
        console.log(`[Campaign ${campaign.name}] Sending to ${targetPhone} via session ${selectedSession}`);
        
        // Simulating human typing
        try {
          // 1. send typing status
          await client.post('/api/startTyping', {
            chatId: targetPhone,
            session: selectedSession
          });
          
          // 2. Wait simulating typing speed (e.g. 50ms per char, min 2s, max 8s)
          const typingDelay = Math.min(Math.max(messageText.length * 50, 2000), 8000);
          await new Promise(resolve => setTimeout(resolve, typingDelay));
          
          // 3. stop typing
          await client.post('/api/stopTyping', {
            chatId: targetPhone,
            session: selectedSession
          });
        } catch (simError) {
           console.log(`[Campaign ${campaign.name}] Typing simulation failed (ignored):`, simError);
        }

        await client.post('/api/sendText', {
          chatId: targetPhone,
          text: messageText,
          session: selectedSession
        });
        campaign.sent++;
        campaign.logs.unshift(`[${now.toISOString()}] Sent to ${targetPhone} via ${selectedSession}`);
      } catch (e: any) {
        console.error(`[Campaign ${campaign.name}] Failed to send to ${targetPhone}:`, e.message);
        campaign.failed++;
        campaign.logs.unshift(`[${now.toISOString()}] Error ${targetPhone}: ${e.message}`);
      }
      
      saveData();
    }
  }
};

setInterval(processCampaigns, 2000); // Check every 2 seconds

// --- Vite Middleware ---
async function startServer() {
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
