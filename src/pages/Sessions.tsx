import { useState, useEffect } from 'react';
import { getWahaSessions, sendTestMessage } from '../lib/api';
import { WahaSession } from '../types';
import { Server, Activity, RefreshCw, X, Send, Globe } from 'lucide-react';

export default function Sessions() {
  const [sessions, setSessions] = useState<WahaSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [selectedSession, setSelectedSession] = useState<WahaSession | null>(null);
  const [activeTab, setActiveTab] = useState<'status' | 'test'>('status');
  const [testPhone, setTestPhone] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  const [sendingTest, setSendingTest] = useState(false);

  const fetchSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getWahaSessions();
      setSessions(data);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao buscar sessões. Verifique as configurações.');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleSendTest = async () => {
    if (!testPhone || !testMsg || !selectedSession) return;
    setSendingTest(true);
    setTestResult(null);
    try {
      await sendTestMessage(selectedSession.name, testPhone, testMsg);
      setTestResult({ type: 'success', message: 'Mensagem de teste enviada com sucesso!' });
      setTestPhone('');
      setTestMsg('');
    } catch (e: any) {
      setTestResult({ type: 'error', message: e.response?.data?.error || e.message || 'Erro ao enviar.' });
    }
    setSendingTest(false);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Instâncias WAHA</h1>
        <button
          onClick={fetchSessions}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-white text-indigo-700 rounded-md border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {error ? (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg border border-red-200 text-sm font-medium">{error}</div>
      ) : loading ? (
        <div className="text-slate-500 text-sm">Carregando sessões...</div>
      ) : sessions.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-xl shadow-sm border border-slate-200 text-slate-400">
          <Server className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm font-medium">Nenhuma sessão encontrada ou falha de conexão.</p>
        </div>
      ) : (
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Instâncias Ativas</h2>
            <span className="text-[10px] font-bold text-slate-400 uppercase">{sessions.filter(s => s.status === 'WORKING').length} de {sessions.length} online</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sessions.map((s, i) => (
              <div 
                key={i} 
                onClick={() => { setSelectedSession(s); setTestResult(null); setActiveTab('status'); }}
                className={`flex items-center justify-between p-4 rounded-lg border cursor-pointer hover:-translate-y-0.5 transition-all ${s.status === 'WORKING' ? 'bg-green-50/50 border-green-200 hover:shadow-md hover:shadow-green-100' : 'bg-slate-50 border-slate-200 hover:shadow-md'}`}
              >
                <div className="flex flex-col gap-1 w-full relative pr-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-slate-800 italic truncate pr-2">{s.name}</span>
                    <div className={`shrink-0 w-2 h-2 rounded-full ${s.status === 'WORKING' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-amber-400'}`}></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${s.status === 'WORKING' ? 'text-green-600' : 'text-slate-500'}`}>
                      {s.status === 'WORKING' ? 'Online & Conectado' : s.status}
                    </span>
                    <span className={`flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${s.config?.proxy ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500'}`}>
                      <Globe className="w-3 h-3" />
                      {s.config?.proxy ? 'Proxy ON' : 'Proxy OFF'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {selectedSession && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 shrink-0">
              <h2 className="text-lg font-bold text-slate-800">
                Instância: <span className="italic text-indigo-600">{selectedSession.name}</span>
              </h2>
              <button onClick={() => setSelectedSession(null)} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded">
                <X className="w-5 h-5"/>
              </button>
            </div>

            <div className="flex border-b border-slate-100 px-4 shrink-0 overflow-x-auto">
              <button 
                onClick={() => setActiveTab('status')} 
                className={`py-3 px-4 text-sm font-bold border-b-2 whitespace-nowrap transition-colors ${activeTab === 'status' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
              >
                Geral & Proxy
              </button>
              <button 
                onClick={() => setActiveTab('test')} 
                className={`py-3 px-4 text-sm font-bold border-b-2 whitespace-nowrap transition-colors ${activeTab === 'test' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
              >
                Ações (Teste)
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto w-full">
              {activeTab === 'status' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Config Details */}
                  <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                    <h3 className="text-xs font-black uppercase text-slate-500 tracking-wider mb-4"><Server className="w-3.5 h-3.5 inline mr-1"/> Configurações e Status</h3>
                    <div className="space-y-4">
                      <div>
                        <span className="block text-[10px] text-slate-400 font-bold uppercase">Status Engine</span>
                        <span className="text-sm font-mono text-slate-800 font-bold">{selectedSession.status}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400 font-bold uppercase">Conectado como (Me)</span>
                        <span className="text-sm font-mono text-slate-800">
                          {typeof selectedSession.me === 'object' && selectedSession.me !== null
                            ? selectedSession.me.pushName || selectedSession.me.id || JSON.stringify(selectedSession.me)
                            : selectedSession.me || 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400 font-bold uppercase">Engine Version</span>
                        <span className="text-sm font-mono text-slate-800">{selectedSession.config?.engine || 'waha'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Proxy Details */}
                  <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                    <h3 className="text-xs font-black uppercase text-slate-500 tracking-wider mb-4"><Activity className="w-3.5 h-3.5 inline mr-1"/> Proxy Configurado</h3>
                    <div className="space-y-4">
                      {!selectedSession.config?.proxy ? (
                        <div className="text-sm text-slate-500 italic">Nenhum proxy configurado para esta instância.</div>
                      ) : (
                        <>
                          <div>
                            <span className="block text-[10px] text-slate-400 font-bold uppercase">Servidor Proxy</span>
                            <span className="text-sm font-mono text-slate-800">{selectedSession.config.proxy.server || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="block text-[10px] text-slate-400 font-bold uppercase">Usuário Proxy</span>
                            <span className="text-sm font-mono text-slate-800">{selectedSession.config.proxy.username || 'Não utiliza'}</span>
                          </div>
                          <div>
                            <span className="block text-[10px] text-slate-400 font-bold uppercase">Senha Proxy</span>
                            <span className="text-sm font-mono text-slate-800">{'*'.repeat((selectedSession.config.proxy.password || '').length) || 'Não utiliza'}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'test' && (
                <div className="max-w-md mx-auto">
                  <h3 className="text-xs font-black uppercase text-slate-500 tracking-wider mb-4 flex items-center gap-1.5"><Send className="w-3.5 h-3.5"/> Enviar Mensagem de Teste</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">WhatsApp de Destino</label>
                      <input 
                        type="text" 
                        placeholder="Ex: 551199999999" 
                        value={testPhone} 
                        onChange={(e) => setTestPhone(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-sans text-sm focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Mensagem</label>
                      <textarea 
                        rows={4} 
                        placeholder="Olá, testando a conexão da instância..." 
                        value={testMsg} 
                        onChange={(e) => setTestMsg(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm resize-none focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>
                    <button 
                      onClick={handleSendTest} 
                      disabled={sendingTest || selectedSession.status !== 'WORKING'}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg shadow-md hover:shadow-lg transition-all flex justify-center items-center gap-2"
                    >
                      {sendingTest ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Send className="w-4 h-4" />}
                      Enviar Teste Agora
                    </button>

                    {testResult && (
                      <div className={`mt-4 p-3 rounded-lg text-xs font-bold ${testResult.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                        {testResult.message}
                      </div>
                    )}
                    {selectedSession.status !== 'WORKING' && (
                      <div className="text-[10px] text-amber-600 font-bold bg-amber-50 p-2 rounded-lg mt-2 border border-amber-200">
                        A instância precisa estar WORKING para enviar mensagens. Status atual: {selectedSession.status}.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
