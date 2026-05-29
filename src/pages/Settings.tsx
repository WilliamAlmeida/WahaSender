import { useState, useEffect } from 'react';
import { getSettings, saveSettings, testWahaConnection } from '../lib/api';
import { Save, Link as LinkIcon, Server } from 'lucide-react';

export default function Settings() {
  const [wahaUrl, setWahaUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; message: string } | null>(null);

  useEffect(() => {
    getSettings().then((data) => {
      if (data) {
        setWahaUrl(data.wahaUrl);
        setApiKey(data.apiKey);
      }
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings({ wahaUrl, apiKey });
      alert('Configurações salvas!');
    } catch (e) {
      alert('Erro ao salvar.');
    }
    setSaving(false);
  };

  const handleTest = async () => {
    setTestResult(null);
    try {
      const data = await testWahaConnection(wahaUrl, apiKey);
      if (data && data.message === 'pong' || data.status === 'ok') {
        setTestResult({ status: 'success', message: 'Conexão estabelecida com sucesso!' });
      } else {
        setTestResult({ status: 'error', message: 'Conexão retornou um formato inesperado.' });
      }
    } catch (e: any) {
      setTestResult({ status: 'error', message: e.response?.data?.message || e.message });
    }
  };

  if (loading) return <div className="text-slate-500 text-sm">Carregando...</div>;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 tracking-tight mb-6">Configurações do WAHA</h1>
      
      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-6 flex items-center gap-2">
          <Server className="w-4 h-4" />
          Configuração da API
        </h2>
        <div className="space-y-5">
          <div>
            <label className="block text-[11px] uppercase font-black text-slate-400 mb-1.5">WAHA API URL</label>
            <input
              type="text"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
              placeholder="http://localhost:3000"
              value={wahaUrl}
              onChange={(e) => setWahaUrl(e.target.value)}
            />
            <p className="mt-1.5 text-[10px] text-slate-500 italic">A URL base onde sua API do WAHA está rodando.</p>
          </div>
          
          <div>
            <label className="block text-[11px] uppercase font-black text-slate-400 mb-1.5">X-Api-Key (Opcional)</label>
            <input
              type="password"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
              placeholder="••••••••••••••••"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-6 mt-6 border-t border-slate-100">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow-lg shadow-indigo-200 transition-all"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
            
            <button
              onClick={handleTest}
              className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-black text-white px-5 py-2.5 rounded-lg text-sm font-bold transition-all"
            >
              <LinkIcon className="w-4 h-4" />
              Testar Conexão
            </button>
          </div>

          {testResult && (
            <div className={`mt-4 p-3 rounded-lg border text-xs font-semibold ${testResult.status === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {testResult.message}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
