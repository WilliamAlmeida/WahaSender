import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  adminStats,
  adminListUsers,
  adminCreateUser,
  adminUpdateUser,
  adminDeleteUser,
  adminSetUserStatus,
  adminSetUserPlan,
  adminImpersonateUser,
  adminListPlans,
  adminCreatePlan,
  adminUpdatePlan,
  adminListPayments,
  adminListAudit,
} from '../lib/api';
import {
  Users,
  CreditCard,
  MessageSquare,
  TrendingUp,
  Plus,
  Edit2,
  Trash2,
  ShieldCheck,
  ShieldOff,
  Search,
  ChevronDown,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  ToggleLeft,
  ToggleRight,
  LogIn,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../lib/auth';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function brl(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmt(d: string | null) {
  if (!d) return '—';
  try { return format(new Date(d), 'dd/MM/yy HH:mm', { locale: ptBR }); } catch { return '—'; }
}

function limitLabel(v: number) {
  return v === -1 ? '∞' : String(v);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'users' | 'plans' | 'payments' | 'audit';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Visão Geral', icon: TrendingUp },
  { id: 'users', label: 'Usuários', icon: Users },
  { id: 'plans', label: 'Planos', icon: ShieldCheck },
  { id: 'payments', label: 'Pagamentos', icon: CreditCard },
  { id: 'audit', label: 'Auditoria', icon: MessageSquare },
];

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase font-black text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

const INPUT = 'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500 transition-colors';
const SELECT = INPUT + ' appearance-none';
const BTN_PRIMARY = 'flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all';
const BTN_DANGER = 'flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all';
const BTN_GHOST = 'flex items-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-600 px-4 py-2 rounded-lg text-sm font-medium transition-all';

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ stats }: { stats: any }) {
  const cards = [
    { label: 'Usuários', value: stats?.totalUsers ?? '—', icon: Users, color: 'text-indigo-600 bg-indigo-50' },
    { label: 'Assinaturas ativas', value: stats?.activeSubscriptions ?? '—', icon: ShieldCheck, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Mensagens no mês', value: stats?.messagesThisPeriod ?? '—', icon: MessageSquare, color: 'text-sky-600 bg-sky-50' },
    { label: 'MRR', value: stats ? brl(stats.mrrCents) : '—', icon: TrendingUp, color: 'text-amber-600 bg-amber-50' },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wide text-slate-400">{c.label}</span>
            <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center', c.color)}>
              <c.icon className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl font-bold text-slate-800">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function CreateUserModal({ plans, onClose, onCreated }: { plans: any[]; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'user', planSlug: '' });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await adminCreateUser({ ...form, planSlug: form.planSlug || undefined });
      toast.success('Usuário criado!');
      onCreated();
      onClose();
    } catch { setSaving(false); }
  };

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <Modal title="Criar Usuário" onClose={onClose}>
      <div className="space-y-4">
        <Field label="E-mail *"><input className={INPUT} type="email" placeholder="email@exemplo.com" value={form.email} onChange={f('email')} /></Field>
        <Field label="Nome"><input className={INPUT} type="text" placeholder="Nome completo" value={form.name} onChange={f('name')} /></Field>
        <Field label="Senha *"><input className={INPUT} type="password" placeholder="Mínimo 8 caracteres" value={form.password} onChange={f('password')} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Role">
            <select className={SELECT} value={form.role} onChange={f('role')}>
              <option value="user">Usuário</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <Field label="Plano">
            <select className={SELECT} value={form.planSlug} onChange={f('planSlug')}>
              <option value="">Free (padrão)</option>
              {plans.map((p) => <option key={p.id} value={p.slug}>{p.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className={BTN_GHOST} onClick={onClose}>Cancelar</button>
          <button className={BTN_PRIMARY} disabled={saving || !form.email || !form.password} onClick={submit}>
            <Plus className="w-4 h-4" />{saving ? 'Criando...' : 'Criar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditUserModal({ user, onClose, onSaved }: { user: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: user.name || '', email: user.email || '', role: user.role || 'user' });
  const [emailVerified, setEmailVerified] = useState<boolean>(!!user.emailVerified);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await adminUpdateUser(user.id, { ...form, emailVerified });
      toast.success('Usuário atualizado!');
      onSaved();
      onClose();
    } catch { setSaving(false); }
  };

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <Modal title={`Editar: ${user.email}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Nome"><input className={INPUT} type="text" value={form.name} onChange={f('name')} /></Field>
        <Field label="E-mail">
          <input className={INPUT} type="email" value={form.email} onChange={f('email')} />
          {form.email !== user.email && (
            <p className="mt-1 text-[10px] text-amber-600">Alterar o e-mail removerá a verificação atual.</p>
          )}
        </Field>
        <Field label="Role">
          <select className={SELECT} value={form.role} onChange={f('role')}>
            <option value="user">Usuário</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={emailVerified}
            onChange={(e) => setEmailVerified(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          E-mail verificado
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button className={BTN_GHOST} onClick={onClose}>Cancelar</button>
          <button className={BTN_PRIMARY} disabled={saving} onClick={submit}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteUserModal({ user, onClose, onDeleted }: { user: any; onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  const submit = async () => {
    setDeleting(true);
    try {
      await adminDeleteUser(user.id);
      toast.success('Usuário excluído.');
      onDeleted();
      onClose();
    } catch { setDeleting(false); }
  };

  return (
    <Modal title="Excluir usuário" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Todos os dados de <strong>{user.email}</strong> serão anonimizados. Essa ação é <strong>irreversível</strong>.
        </p>
        <Field label={`Digite o e-mail "${user.email}" para confirmar`}>
          <input className={INPUT} type="text" placeholder={user.email} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button className={BTN_GHOST} onClick={onClose}>Cancelar</button>
          <button className={BTN_DANGER} disabled={deleting || confirm !== user.email} onClick={submit}>
            <Trash2 className="w-4 h-4" />{deleting ? 'Excluindo...' : 'Excluir'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function UsersTab({ plans }: { plans: any[] }) {
  const { user: currentUser, refresh } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [deleteUser, setDeleteUser] = useState<any>(null);

  const load = useCallback(async () => {
    const params: any = {};
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    const data = await adminListUsers(params);
    setUsers(data);
  }, [search, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const toggleStatus = async (u: any) => {
    const next = u.status === 'suspended' ? 'active' : 'suspended';
    const label = next === 'suspended' ? 'Suspender' : 'Reativar';
    if (!window.confirm(`${label} o usuário ${u.email}?`)) return;
    await adminSetUserStatus(u.id, next);
    toast.success(next === 'suspended' ? 'Usuário suspenso' : 'Usuário reativado');
    load();
  };

  const changePlan = async (u: any, slug: string) => {
    if (!window.confirm(`Trocar plano de ${u.email} para "${slug}"?`)) return;
    await adminSetUserPlan(u.id, slug);
    toast.success('Plano atualizado');
    load();
  };

  const impersonate = async (u: any) => {
    if (!window.confirm(`Entrar como ${u.email}? Você navegará como este usuário até clicar em "Voltar à minha conta".`)) return;
    await adminImpersonateUser(u.id);
    await refresh();
    toast.success(`Impersonando ${u.email}`);
    navigate('/');
  };

  return (
    <div className="space-y-4">
      {createOpen && <CreateUserModal plans={plans} onClose={() => setCreateOpen(false)} onCreated={load} />}
      {editUser && <EditUserModal user={editUser} onClose={() => setEditUser(null)} onSaved={load} />}
      {deleteUser && <DeleteUserModal user={deleteUser} onClose={() => setDeleteUser(null)} onDeleted={load} />}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Buscar por e-mail..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Todos os status</option>
          <option value="active">Ativo</option>
          <option value="suspended">Suspenso</option>
        </select>
        <button className={BTN_PRIMARY} onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> Novo Usuário
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3">Usuário</th>
              <th className="px-4 py-3">Plano</th>
              <th className="px-4 py-3 text-right">Msgs/mês</th>
              <th className="px-4 py-3">Cadastro</th>
              <th className="px-4 py-3">Último login</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">Nenhum usuário encontrado.</td></tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{u.name || <span className="text-slate-400 italic">sem nome</span>}</div>
                  <div className="text-xs text-slate-500 flex items-center gap-1">
                    {u.email}
                    {!u.emailVerified && <span className="text-amber-500" title="E-mail não verificado">·</span>}
                    {u.role === 'admin' && <span className="ml-1 bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] font-bold">ADMIN</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={u.planSlug || 'free'}
                    onChange={(e) => changePlan(u, e.target.value)}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none"
                  >
                    {plans.map((p) => <option key={p.id} value={p.slug}>{p.name}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-700">{u.messagesUsed || 0}</td>
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmt(u.createdAt)}</td>
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmt(u.lastLoginAt)}</td>
                <td className="px-4 py-3">
                  <span className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                    u.status === 'suspended' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700',
                  )}>
                    {u.status === 'suspended' ? <ShieldOff className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                    {u.status === 'suspended' ? 'Suspenso' : 'Ativo'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditUser(u)}
                      title="Editar"
                      className="p-1.5 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {u.id !== currentUser?.id && u.status !== 'suspended' && (
                      <button
                        onClick={() => impersonate(u)}
                        title="Entrar como este usuário"
                        className="p-1.5 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                      >
                        <LogIn className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {u.role !== 'admin' && (
                      <>
                        <button
                          onClick={() => toggleStatus(u)}
                          title={u.status === 'suspended' ? 'Reativar' : 'Suspender'}
                          className="p-1.5 rounded-md text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                        >
                          {u.status === 'suspended' ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => setDeleteUser(u)}
                          title="Excluir"
                          className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">{users.length} resultado(s) — limite de 200</p>
    </div>
  );
}

// ─── Plans Tab ────────────────────────────────────────────────────────────────

function PlanModal({ plan, onClose, onSaved }: { plan: any | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !plan;
  const [form, setForm] = useState({
    name: plan?.name || '',
    slug: plan?.slug || '',
    priceCents: plan?.priceCents ?? 0,
    monthlyMessageQuota: plan?.monthlyMessageQuota ?? -1,
    maxContacts: plan?.maxContacts ?? -1,
    maxSessions: plan?.maxSessions ?? -1,
    maxCampaigns: plan?.maxCampaigns ?? -1,
    active: plan?.active ?? true,
  });
  const [saving, setSaving] = useState(false);

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    setForm((p) => ({ ...p, [k]: v }));
  };

  const submit = async () => {
    setSaving(true);
    try {
      if (isNew) {
        await adminCreatePlan(form);
        toast.success('Plano criado!');
      } else {
        const { slug: _, ...patch } = form;
        await adminUpdatePlan(plan.id, patch);
        toast.success('Plano atualizado!');
      }
      onSaved();
      onClose();
    } catch { setSaving(false); }
  };

  const LIMIT_NOTE = 'Use -1 para ilimitado';

  return (
    <Modal title={isNew ? 'Criar Plano' : `Editar: ${plan.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nome *"><input className={INPUT} type="text" value={form.name} onChange={f('name')} placeholder="Pro" /></Field>
          <Field label="Slug *">
            <input className={INPUT} type="text" value={form.slug} onChange={f('slug')} placeholder="pro" disabled={!isNew} />
            {!isNew && <p className="mt-0.5 text-[10px] text-slate-400">Slug não pode ser alterado</p>}
          </Field>
        </div>
        <Field label="Preço (centavos) — 0 = grátis">
          <input className={INPUT} type="number" min={0} value={form.priceCents} onChange={f('priceCents')} />
          <p className="mt-0.5 text-[10px] text-slate-400">{brl(form.priceCents)}/mês</p>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={`Msgs/mês (${LIMIT_NOTE})`}>
            <input className={INPUT} type="number" min={-1} value={form.monthlyMessageQuota} onChange={f('monthlyMessageQuota')} />
          </Field>
          <Field label={`Contatos (${LIMIT_NOTE})`}>
            <input className={INPUT} type="number" min={-1} value={form.maxContacts} onChange={f('maxContacts')} />
          </Field>
          <Field label={`Sessões (${LIMIT_NOTE})`}>
            <input className={INPUT} type="number" min={-1} value={form.maxSessions} onChange={f('maxSessions')} />
          </Field>
          <Field label={`Campanhas (${LIMIT_NOTE})`}>
            <input className={INPUT} type="number" min={-1} value={form.maxCampaigns} onChange={f('maxCampaigns')} />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setForm((p) => ({ ...p, active: !p.active }))}
            className={cn('text-2xl transition-colors', form.active ? 'text-emerald-500' : 'text-slate-300')}
          >
            {form.active ? <ToggleRight /> : <ToggleLeft />}
          </button>
          <span className="text-sm text-slate-600">{form.active ? 'Plano ativo (visível para clientes)' : 'Plano inativo (oculto)'}</span>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className={BTN_GHOST} onClick={onClose}>Cancelar</button>
          <button className={BTN_PRIMARY} disabled={saving || !form.name || !form.slug} onClick={submit}>
            {saving ? 'Salvando...' : isNew ? 'Criar' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PlansTab() {
  const [plans, setPlans] = useState<any[]>([]);
  const [modal, setModal] = useState<any | null | 'new'>(null);

  const load = async () => setPlans(await adminListPlans());
  useEffect(() => { load(); }, []);

  const toggleActive = async (p: any) => {
    await adminUpdatePlan(p.id, { active: !p.active });
    toast.success(p.active ? 'Plano desativado' : 'Plano ativado');
    load();
  };

  return (
    <div className="space-y-4">
      {modal !== null && (
        <PlanModal
          plan={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
      <div className="flex justify-end">
        <button className={BTN_PRIMARY} onClick={() => setModal('new')}>
          <Plus className="w-4 h-4" /> Novo Plano
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => (
          <div
            key={p.id}
            className={cn(
              'rounded-xl border bg-white p-5 flex flex-col gap-3',
              p.active ? 'border-slate-200' : 'border-slate-100 opacity-60',
            )}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-800">{p.name}</span>
                <span className="ml-2 text-xs text-slate-400 font-mono">{p.slug}</span>
              </div>
              <span className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                p.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500',
              )}>
                {p.active ? 'Ativo' : 'Inativo'}
              </span>
            </div>
            <div className="text-2xl font-bold text-slate-800">{brl(p.priceCents)}<span className="text-sm font-normal text-slate-400">/mês</span></div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>Msgs/mês: <strong>{limitLabel(p.monthlyMessageQuota)}</strong></span>
              <span>Contatos: <strong>{limitLabel(p.maxContacts)}</strong></span>
              <span>Sessões: <strong>{limitLabel(p.maxSessions)}</strong></span>
              <span>Campanhas: <strong>{limitLabel(p.maxCampaigns)}</strong></span>
            </div>
            <div className="flex gap-2 mt-auto pt-2 border-t border-slate-100">
              <button className={BTN_GHOST + ' flex-1 justify-center'} onClick={() => setModal(p)}>
                <Edit2 className="w-3.5 h-3.5" /> Editar
              </button>
              <button
                onClick={() => toggleActive(p)}
                className={cn(BTN_GHOST, 'flex-1 justify-center', p.active ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50')}
              >
                {p.active ? <ToggleLeft className="w-4 h-4" /> : <ToggleRight className="w-4 h-4" />}
                {p.active ? 'Desativar' : 'Ativar'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Payments Tab ─────────────────────────────────────────────────────────────

const PAYMENT_STATUS_BADGE: Record<string, string> = {
  approved: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-700',
  refunded: 'bg-slate-100 text-slate-600',
  mock: 'bg-indigo-100 text-indigo-700',
};

function PaymentsTab() {
  const [payments, setPayments] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const load = useCallback(async (off = 0) => {
    const params: any = { limit: LIMIT, offset: off };
    if (statusFilter) params.status = statusFilter;
    const data = await adminListPayments(params);
    setPayments(data);
    setOffset(off);
  }, [statusFilter]);

  useEffect(() => { load(0); }, [load]);

  const total = payments.filter((p) => p.status === 'approved').reduce((s, p) => s + p.amountCents, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Todos os status</option>
          <option value="approved">Aprovado</option>
          <option value="pending">Pendente</option>
          <option value="rejected">Rejeitado</option>
          <option value="refunded">Reembolsado</option>
        </select>
        {total > 0 && (
          <span className="ml-auto text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
            Total aprovado: {brl(total)}
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3">Usuário</th>
              <th className="px-4 py-3">Plano</th>
              <th className="px-4 py-3">Método</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Data</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Nenhum pagamento encontrado.</td></tr>
            )}
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="px-4 py-3 text-slate-700">{p.userEmail}</td>
                <td className="px-4 py-3 text-slate-500">{p.planName || '—'}</td>
                <td className="px-4 py-3 text-slate-500 uppercase text-xs">{p.method || '—'}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">{brl(p.amountCents)}</td>
                <td className="px-4 py-3">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', PAYMENT_STATUS_BADGE[p.status] || 'bg-slate-100 text-slate-600')}>
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmt(p.paidAt || p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-400">{payments.length} resultado(s)</p>
        <div className="flex gap-2">
          {offset > 0 && (
            <button className={BTN_GHOST} onClick={() => load(offset - LIMIT)}>← Anterior</button>
          )}
          {payments.length === LIMIT && (
            <button className={BTN_GHOST} onClick={() => load(offset + LIMIT)}>Próximo →</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Audit Tab ────────────────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, string> = {
  login: 'bg-sky-100 text-sky-700',
  register: 'bg-indigo-100 text-indigo-700',
  logout: 'bg-slate-100 text-slate-600',
  update: 'bg-amber-100 text-amber-700',
  create: 'bg-emerald-100 text-emerald-700',
  delete: 'bg-red-100 text-red-700',
  'password-change': 'bg-purple-100 text-purple-700',
};

function AuditTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const load = useCallback(async (off = 0) => {
    const params: any = { limit: LIMIT, offset: off };
    if (actionFilter) params.action = actionFilter;
    if (entityFilter) params.entityType = entityFilter;
    const data = await adminListAudit(params);
    setRows(data);
    setOffset(off);
  }, [actionFilter, entityFilter]);

  useEffect(() => { load(0); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Todas as ações</option>
          <option value="login">login</option>
          <option value="logout">logout</option>
          <option value="register">register</option>
          <option value="create">create</option>
          <option value="update">update</option>
          <option value="delete">delete</option>
          <option value="password-change">password-change</option>
        </select>
        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Todas as entidades</option>
          <option value="user">user</option>
          <option value="subscription">subscription</option>
          <option value="plan">plan</option>
          <option value="account">account</option>
          <option value="campaign">campaign</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Usuário</th>
              <th className="px-4 py-3">Ação</th>
              <th className="px-4 py-3">Entidade</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Nenhum registro encontrado.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">{fmt(r.createdAt)}</td>
                <td className="px-4 py-2.5 text-xs text-slate-600">{r.userEmail || r.userId?.slice(0, 8) || '—'}</td>
                <td className="px-4 py-2.5">
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', ACTION_COLORS[r.action] || 'bg-slate-100 text-slate-600')}>
                    {r.action}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  <span className="font-mono">{r.entityType}</span>
                  {r.entityId && <span className="text-slate-300 ml-1">#{r.entityId.slice(0, 6)}</span>}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">{r.ip || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-400">{rows.length} resultado(s)</p>
        <div className="flex gap-2">
          {offset > 0 && (
            <button className={BTN_GHOST} onClick={() => load(offset - LIMIT)}>← Anterior</button>
          )}
          {rows.length === LIMIT && (
            <button className={BTN_GHOST} onClick={() => load(offset + LIMIT)}>Próximo →</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Admin() {
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([adminStats(), adminListPlans()])
      .then(([s, p]) => { setStats(s); setPlans(p); })
      .catch(() => toast.error('Acesso restrito a administradores'));
  }, []);

  return (
    <div className="max-w-7xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Administração</h1>

      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap',
              tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab stats={stats} />}
      {tab === 'users' && <UsersTab plans={plans} />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'payments' && <PaymentsTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}
