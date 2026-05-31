import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Copy } from 'lucide-react';
import { listApiTokens, createApiToken, revokeApiToken } from '../lib/api';

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}

export default function ApiTokens() {
  const [items, setItems] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [expires, setExpires] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      setItems(await listApiTokens());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const res = await createApiToken({ name, expiresAt: expires || null });
      setRevealed(res.token);
      setName('');
      setExpires('');
      await reload();
    } catch {
      /* toast já feito pelo interceptor */
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revogar este token?')) return;
    await revokeApiToken(id);
    toast.success('Token revogado');
    await reload();
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">API Tokens</h1>
      <p className="text-sm text-slate-600">
        Use no header <code className="bg-slate-100 px-1 rounded">Authorization: ApiKey wks_...</code>
        ou <code className="bg-slate-100 px-1 rounded">X-Api-Token: wks_...</code>.
      </p>

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className="border border-slate-300 rounded px-3 py-2"
            placeholder="Nome (ex: integração CRM)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="date"
            className="border border-slate-300 rounded px-3 py-2"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
          />
        </div>
        <button className="inline-flex items-center gap-2 bg-indigo-600 text-white rounded px-4 py-2 text-sm">
          <Plus className="w-4 h-4" /> Gerar token
        </button>
      </form>

      {revealed && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-2">
          <div className="font-semibold text-amber-900">Copie agora — não será exibido novamente</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white px-3 py-2 rounded font-mono text-xs break-all">{revealed}</code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(revealed);
                toast.success('Copiado');
              }}
              className="p-2 text-amber-900 hover:bg-amber-100 rounded"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <button onClick={() => setRevealed(null)} className="text-xs text-amber-900 underline">
            Já anotei, esconder
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg divide-y">
        {loading && <div className="p-4 text-sm text-slate-500">Carregando...</div>}
        {!loading && items.length === 0 && (
          <div className="p-4 text-sm text-slate-500">Nenhum token criado.</div>
        )}
        {items.map((t) => (
          <div key={t.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-semibold">{t.name}</div>
              <div className="text-xs text-slate-500 font-mono">
                {t.prefix}... · criado em {new Date(t.createdAt).toLocaleString()}
                {t.expiresAt && ` · expira ${new Date(t.expiresAt).toLocaleDateString()}`}
                {t.lastUsedAt && ` · último uso ${new Date(t.lastUsedAt).toLocaleString()}`}
              </div>
            </div>
            <button
              onClick={() => revoke(t.id)}
              className="p-2 text-slate-500 hover:text-red-600"
              title="Revogar"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
