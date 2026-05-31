import axios from 'axios';
import { Group, Settings, WahaSession, Campaign } from '../types';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// Redirect to /login on 401 (except on the login/register/me flows themselves)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      const url: string = error?.config?.url || '';
      const isAuthFlow = url.startsWith('/auth/');
      if (!isAuthFlow && typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export default api;

export const getSettings = async (): Promise<Settings> => {
  const { data } = await api.get('/settings');
  return data;
};

export const saveSettings = async (settings: Settings): Promise<void> => {
  await api.post('/settings', settings);
};

export const getWahaSessions = async (): Promise<WahaSession[]> => {
  const { data } = await api.get('/waha/sessions');
  return data;
};

export const testWahaConnection = async (wahaUrl?: string, apiKey?: string): Promise<any> => {
  const { data } = await api.post('/waha/ping', { wahaUrl, apiKey });
  return data;
};

export const getGroups = async (): Promise<Group[]> => {
  const { data } = await api.get('/groups');
  return data;
};

export const createGroup = async (name: string, contacts: any[]): Promise<Group> => {
  const { data } = await api.post('/groups', { name, contacts });
  return data;
};

export const deleteGroup = async (id: string): Promise<void> => {
  await api.delete(`/groups/${id}`);
};

export const getGroup = async (id: string): Promise<any> => {
  const { data } = await api.get(`/groups/${id}`);
  return data;
};

export const updateGroup = async (id: string, updates: any): Promise<any> => {
  const { data } = await api.put(`/groups/${id}`, updates);
  return data;
};

export const getCampaigns = async (): Promise<Campaign[]> => {
  const { data } = await api.get('/campaigns');
  return data;
};

export const getCampaign = async (id: string): Promise<Campaign> => {
  const { data } = await api.get(`/campaigns/${id}`);
  return data;
};

export const createCampaign = async (payload: Partial<Campaign>): Promise<Campaign> => {
  const { data } = await api.post('/campaigns', payload);
  return data;
};

export const updateCampaign = async (id: string, payload: Partial<Campaign>): Promise<Campaign> => {
  const { data } = await api.put(`/campaigns/${id}`, payload);
  return data;
};

export const getContacts = async (): Promise<any[]> => {
  const { data } = await api.get('/contacts');
  return data;
};

export const importGlobalContacts = async (contacts: any[]): Promise<{success: boolean, count: number}> => {
  const { data } = await api.post('/contacts/import', { contacts });
  return data;
};

export const getContactCampaigns = async (id: string): Promise<any[]> => {
  const { data } = await api.get(`/contacts/${id}/campaigns`);
  return data;
};

export const updateContact = async (id: string, updates: any): Promise<any> => {
  const { data } = await api.put(`/contacts/${id}`, updates);
  return data;
};

export const deleteContact = async (id: string): Promise<void> => {
  await api.delete(`/contacts/${id}`);
};

export const deleteCampaign = async (id: string): Promise<void> => {
  await api.delete(`/campaigns/${id}`);
};

export const toggleCampaign = async (id: string): Promise<Campaign> => {
  const { data } = await api.post(`/campaigns/${id}/toggle`);
  return data;
};

export const sendTestMessage = async (session: string, phone: string, text: string): Promise<any> => {
  const { data } = await api.post('/waha/sendTestMessage', { session, phone, text });
  return data;
};

export const getQueue = async (): Promise<any[]> => {
  const { data } = await api.get('/queue');
  return data;
};

export const deleteQueueItem = async (campaignId: string, index: number): Promise<void> => {
  await api.delete(`/campaigns/${campaignId}/queue/${index}`);
};

export const toggleQueueItem = async (campaignId: string, index: number): Promise<any> => {
  const { data } = await api.post(`/campaigns/${campaignId}/queue/${index}/toggle`);
  return data;
};
