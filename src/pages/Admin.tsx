import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  adminStats,
  adminListUsers,
  adminSetUserStatus,
  adminSetUserPlan,
  adminListPlans,
} from '../lib/api';

interface Stats {
  totalUsers: number;
  activeSubscriptions: number;
  messagesThisPeriod: number;
  mrrCents: number;
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function Admin() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  const load = async () => {
    const [s, u, p] = await Promise.all([adminStats(), adminListUsers(search), adminListPlans()]);
    setStats(s);
    setUsers(u);
    setPlans(p);
  };

  useEffect(() => {
    load().catch(() => toast.error('Acesso restrito a administradores'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleStatus = async (u: any) => {
    const next = u.status === 'suspended' ? 'active' : 'suspended';
    await adminSetUserStatus(u.id, next);
    toast.success(next === 'suspended' ? 'Usuário suspenso' : 'Usuário reativado');
    await load();
  };

  const changePlan = async (u: any, slug: string) => {
    await adminSetUserPlan(u.id, slug);
    toast.success('Plano atualizado');
    await load();
  };

  return (
    <div className="max-w-6xl space-y-8">
      <h1 className="text-2xl font-bold text-slate-800">Administração</h1>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Usuários', value: stats?.totalUsers ?? '—' },
          { label: 'Assinaturas ativas', value: stats?.activeSubscriptions ?? '—' },
          { label: 'Mensagens no mês', value: stats?.messagesThisPeriod ?? '—' },
          { label: 'MRR', value: stats ? brl(stats.mrrCents) : '—' },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs uppercase tracking-wide text-slate-400">{c.label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800">{c.value}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-800">Tenants</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Buscar e-mail..."
            className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">E-mail</th>
                <th className="px-4 py-2">Plano</th>
                <th className="px-4 py-2">Uso (mês)</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-700">{u.email}</div>
                    <div className="text-xs text-slate-400">{u.role}{u.emailVerified ? '' : ' · não verificado'}</div>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={u.planSlug || 'free'}
                      onChange={(e) => changePlan(u, e.target.value)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.slug}>{p.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">{u.messagesUsed || 0}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${u.status === 'suspended' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {u.role !== 'admin' && (
                      <button onClick={() => toggleStatus(u)} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                        {u.status === 'suspended' ? 'Reativar' : 'Suspender'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
