import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Check } from 'lucide-react';
import {
  getSubscription,
  getPlans,
  getInvoices,
  startCheckout,
  cancelSubscription,
} from '../lib/api';

interface Plan {
  id: string;
  slug: string;
  name: string;
  priceCents: number;
  monthlyMessageQuota: number;
  maxContacts: number;
  maxSessions: number;
  maxCampaigns: number;
  features: string[];
}

interface Snapshot {
  plan: Plan;
  subscription: { status: string; currentPeriodEnd: string | null } | null;
  period: string;
  messagesUsed: number;
  messagesQuota: number;
  messagesRemaining: number | null;
  contactsUsed: number;
  campaignsUsed: number;
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function Billing() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const [s, p, i] = await Promise.all([getSubscription(), getPlans(), getInvoices()]);
    setSnap(s);
    setPlans(p);
    setInvoices(i);
  };

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const onSubscribe = async (slug: string) => {
    setBusy(slug);
    try {
      const { checkoutUrl, mock } = await startCheckout(slug);
      if (mock) {
        toast.success('Plano ativado!');
        await load();
      } else {
        window.location.href = checkoutUrl;
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao iniciar checkout');
    } finally {
      setBusy(null);
    }
  };

  const onCancel = async () => {
    if (!confirm('Cancelar sua assinatura? Você voltará ao plano Free no fim do período.')) return;
    await cancelSubscription();
    toast.success('Assinatura cancelada');
    await load();
  };

  if (!snap) return <div className="text-sm text-slate-500">Carregando...</div>;

  const used = snap.messagesUsed;
  const quota = snap.messagesQuota;
  const pct = quota < 0 ? 0 : Math.min(100, Math.round((used / Math.max(1, quota)) * 100));

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Plano e cobrança</h1>
        <p className="text-sm text-slate-500">Gerencie sua assinatura e acompanhe o uso do mês.</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400">Plano atual</div>
            <div className="text-xl font-bold text-slate-800">{snap.plan.name}</div>
            <div className="text-sm text-slate-500">
              {snap.plan.priceCents === 0 ? 'Grátis' : `${brl(snap.plan.priceCents)}/mês`}
              {snap.subscription?.currentPeriodEnd && (
                <> · renova em {new Date(snap.subscription.currentPeriodEnd).toLocaleDateString('pt-BR')}</>
              )}
            </div>
          </div>
          {snap.plan.slug !== 'free' && (
            <button onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Cancelar
            </button>
          )}
        </div>

        <div className="mt-5">
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-slate-600">Mensagens em {snap.period}</span>
            <span className="font-medium text-slate-800">
              {used} {quota < 0 ? '' : `/ ${quota}`}
            </span>
          </div>
          {quota >= 0 && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-indigo-600'}`} style={{ width: `${pct}%` }} />
            </div>
          )}
          {quota < 0 && <div className="text-xs text-emerald-600">Mensagens ilimitadas</div>}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
          <div><span className="text-slate-400">Contatos</span><div className="font-medium">{snap.contactsUsed}{snap.plan.maxContacts < 0 ? '' : ` / ${snap.plan.maxContacts}`}</div></div>
          <div><span className="text-slate-400">Campanhas</span><div className="font-medium">{snap.campaignsUsed}{snap.plan.maxCampaigns < 0 ? '' : ` / ${snap.plan.maxCampaigns}`}</div></div>
          <div><span className="text-slate-400">Instâncias WAHA</span><div className="font-medium">{snap.plan.maxSessions < 0 ? '∞' : snap.plan.maxSessions}</div></div>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Mudar de plano</h2>
        <div className="grid gap-4 md:grid-cols-4">
          {plans.map((p) => {
            const current = p.slug === snap.plan.slug;
            return (
              <div key={p.id} className={`rounded-xl border p-5 ${p.slug === 'pro' ? 'border-indigo-400' : 'border-slate-200'}`}>
                <h3 className="font-bold">{p.name}</h3>
                <div className="mt-1 text-2xl font-extrabold">
                  {p.priceCents === 0 ? 'Grátis' : brl(p.priceCents)}
                  {p.priceCents > 0 && <span className="text-sm font-medium text-slate-500">/mês</span>}
                </div>
                <ul className="mt-3 space-y-1 text-xs text-slate-600">
                  {p.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-1"><Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />{f}</li>
                  ))}
                </ul>
                <button
                  disabled={current || busy === p.slug}
                  onClick={() => onSubscribe(p.slug)}
                  className="mt-4 w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-500"
                >
                  {current ? 'Plano atual' : busy === p.slug ? 'Aguarde...' : 'Assinar'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Faturas</h2>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">Data</th>
                <th className="px-4 py-2">Valor</th>
                <th className="px-4 py-2">Método</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">Nenhuma fatura ainda.</td></tr>
              )}
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">{new Date(inv.createdAt).toLocaleDateString('pt-BR')}</td>
                  <td className="px-4 py-2">{brl(inv.amountCents)}</td>
                  <td className="px-4 py-2 capitalize">{inv.method || '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${inv.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                      {inv.status}
                    </span>
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
