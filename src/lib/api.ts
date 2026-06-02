import axios from 'axios';
import toast from 'react-hot-toast';
import { Group, Settings, WahaSession, Campaign } from '../types';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// Redirect to /login on 401 + surface errors via toast (except auth flows)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url: string = error?.config?.url || '';
    const isAuthFlow = url.startsWith('/auth/');
    if (status === 401) {
      if (!isAuthFlow && typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    } else if (status >= 400 && !isAuthFlow) {
      const msg = error?.response?.data?.error || error?.message || 'Erro inesperado';
      toast.error(typeof msg === 'string' ? msg : 'Erro inesperado');
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

export const importGlobalContacts = async (contacts: any[]): Promise<{success: boolean, count: number, skipped?: number, limitReached?: boolean, limit?: number, planName?: string}> => {
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

export const deleteAllContacts = async (): Promise<{ deleted: number }> => {
  const { data } = await api.delete('/contacts');
  return data;
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

export const getQueue = async (params?: { page?: number; campaign?: string; status?: string }): Promise<any> => {
  const { data } = await api.get('/queue', { params });
  return data;
};

export const deleteQueueItem = async (campaignId: string, index: number): Promise<void> => {
  await api.delete(`/campaigns/${campaignId}/queue/${index}`);
};

export const toggleQueueItem = async (campaignId: string, index: number): Promise<any> => {
  const { data } = await api.post(`/campaigns/${campaignId}/queue/${index}/toggle`);
  return data;
};

export const cleanupCancelledQueue = async (): Promise<{ deleted: number }> => {
  const { data } = await api.post('/queue/cleanup-cancelled');
  return data;
};

// === v2.1 endpoints ===
export const listTemplates = async () => (await api.get('/templates')).data;
export const createTemplate = async (p: any) => (await api.post('/templates', p)).data;
export const updateTemplate = async (id: string, p: any) => (await api.put(`/templates/${id}`, p)).data;
export const deleteTemplate = async (id: string) => api.delete(`/templates/${id}`);

export const listApiTokens = async () => (await api.get('/api-tokens')).data;
export const createApiToken = async (p: { name: string; expiresAt?: string | null }) =>
  (await api.post('/api-tokens', p)).data;
export const revokeApiToken = async (id: string) => api.delete(`/api-tokens/${id}`);

export const listOutboundWebhooks = async () => (await api.get('/outbound-webhooks')).data;
export const createOutboundWebhook = async (p: any) => (await api.post('/outbound-webhooks', p)).data;
export const updateOutboundWebhook = async (id: string, p: any) =>
  (await api.put(`/outbound-webhooks/${id}`, p)).data;
export const deleteOutboundWebhook = async (id: string) => api.delete(`/outbound-webhooks/${id}`);

export const previewCsv = async (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await api.post('/contacts/csv/preview', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

export const commitCsv = async (file: File, mapping?: Record<string, string>) => {
  const fd = new FormData();
  fd.append('file', file);
  if (mapping) fd.append('mapping', JSON.stringify(mapping));
  const { data } = await api.post('/contacts/csv/commit', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

export const updateProfile = async (data: { name?: string; email?: string }) =>
  (await api.patch('/auth/profile', data)).data as { user: any };

export const changePassword = async (oldPassword: string, newPassword: string) =>
  (await api.post('/auth/change-password', { oldPassword, newPassword })).data;

// === Auth self-service ===
export const forgotPassword = async (email: string) =>
  (await api.post('/auth/forgot-password', { email })).data;
export const resetPassword = async (token: string, newPassword: string) =>
  (await api.post('/auth/reset-password', { token, newPassword })).data;
export const verifyEmail = async (token: string) =>
  (await api.post('/auth/verify-email', { token })).data;
export const resendVerification = async () =>
  (await api.post('/auth/resend-verification')).data;

// === Billing ===
export const getPublicPlans = async () => (await api.get('/public/plans')).data;
export const getPlans = async () => (await api.get('/billing/plans')).data;
export const getSubscription = async () => (await api.get('/billing/subscription')).data;
export const getUsage = async () => (await api.get('/billing/usage')).data;
export const getInvoices = async () => (await api.get('/billing/invoices')).data;
export const startCheckout = async (planSlug: string) =>
  (await api.post('/billing/checkout', { planSlug })).data as { checkoutUrl: string; mock: boolean };
export const cancelSubscription = async () => (await api.post('/billing/cancel')).data;

// === Account / LGPD ===
export const exportAccountData = async () => (await api.get('/account/export')).data;
export const deleteAccount = async () => (await api.post('/account/delete', { confirm: 'EXCLUIR' })).data;

// === Platform admin ===
export const adminStats = async () => (await api.get('/admin/stats')).data;
export const adminListUsers = async (params: { search?: string; status?: string } = {}) =>
  (await api.get('/admin/users', { params })).data;
export const adminCreateUser = async (data: { email: string; name?: string; password: string; role: string; planSlug?: string }) =>
  (await api.post('/admin/users', data)).data;
export const adminUpdateUser = async (id: string, patch: { name?: string; email?: string; role?: string }) =>
  (await api.patch(`/admin/users/${id}`, patch)).data;
export const adminDeleteUser = async (id: string) =>
  (await api.delete(`/admin/users/${id}`)).data;
export const adminSetUserStatus = async (id: string, status: 'active' | 'suspended') =>
  (await api.post(`/admin/users/${id}/status`, { status })).data;
export const adminSetUserPlan = async (id: string, planSlug: string) =>
  (await api.post(`/admin/users/${id}/plan`, { planSlug })).data;
export const adminListPlans = async () => (await api.get('/admin/plans')).data;
export const adminCreatePlan = async (data: any) => (await api.post('/admin/plans', data)).data;
export const adminUpdatePlan = async (id: string, patch: any) =>
  (await api.put(`/admin/plans/${id}`, patch)).data;
export const adminListPayments = async (params: { status?: string; userId?: string; limit?: number; offset?: number } = {}) =>
  (await api.get('/admin/payments', { params })).data;
export const adminListAudit = async (params: { userId?: string; action?: string; entityType?: string; limit?: number; offset?: number } = {}) =>
  (await api.get('/admin/audit', { params })).data;
