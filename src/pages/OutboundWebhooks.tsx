import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import {
  listOutboundWebhooks,
  createOutboundWebhook,
  updateOutboundWebhook,
  deleteOutboundWebhook,
} from '../lib/api';

const EVENTS = [
  'campaign.started',
  'campaign.completed',
  'campaign.paused',
  'message.sent',
  'message.failed',
] as const;

interface Hook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secret?: string;
}

export default function OutboundWebhooks() {
  const [items, setItems] = useState<Hook[]>([]);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [selected, setSelected] = useState<string[]>([...EVENTS]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      setItems(await listOutboundWebhooks());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || !selected.length) return;
    try {
      await createOutboundWebhook({ url, secret: secret || null, events: selected, active: true });
      setUrl('');
      setSecret('');
      toast.success('Webhook criado');
      await reload();
    } catch {
      /* */
    }
  }

  async function toggleActive(h: Hook) {
    await updateOutboundWebhook(h.id, { active: !h.active });
    await reload();
  }

  async function remove(id: string) {
    if (!confirm('Excluir webhook?')) return;
    await deleteOutboundWebhook(id);
    toast.success('Removido');
    await reload();
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Webhooks Outbound</h1>
      <p className="text-sm text-slate-600">
        Receba notificações HTTPS dos eventos de campanha. O payload é assinado em
        <code className="bg-slate-100 px-1 rounded mx-1">X-WahaSender-Signature: sha256=...</code>
        quando um segredo é informado.
      </p>

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <input
          className="w-full border border-slate-300 rounded px-3 py-2"
          placeholder="https://exemplo.com/hooks/waha"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          className="w-full border border-slate-300 rounded px-3 py-2"
          placeholder="Segredo (opcional)"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {EVENTS.map((ev) => (
            <label key={ev} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(ev)}
                onChange={(e) =>
                  setSelected((s) => (e.target.checked ? [...s, ev] : s.filter((x) => x !== ev)))
                }
              />
              <span className="font-mono text-xs">{ev}</span>
            </label>
          ))}
        </div>
        <button className="inline-flex items-center gap-2 bg-indigo-600 text-white rounded px-4 py-2 text-sm">
          <Plus className="w-4 h-4" /> Adicionar
        </button>
      </form>

      <div className="bg-white border border-slate-200 rounded-lg divide-y">
        {loading && <div className="p-4 text-sm text-slate-500">Carregando...</div>}
        {!loading && items.length === 0 && (
          <div className="p-4 text-sm text-slate-500">Nenhum webhook cadastrado.</div>
        )}
        {items.map((h) => (
          <div key={h.id} className="p-4 flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-mono text-sm truncate">{h.url}</div>
              <div className="text-xs text-slate-500 mt-1">
                {h.events.join(', ')} · {h.active ? 'ativo' : 'inativo'}
              </div>
            </div>
            <button
              onClick={() => toggleActive(h)}
              className="text-xs px-2 py-1 rounded border border-slate-300"
            >
              {h.active ? 'Desativar' : 'Ativar'}
            </button>
            <button
              onClick={() => remove(h.id)}
              className="p-2 text-slate-500 hover:text-red-600"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
