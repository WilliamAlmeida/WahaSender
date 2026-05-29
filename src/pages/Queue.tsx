import { useState, useEffect } from 'react';
import { getQueue, deleteQueueItem, toggleQueueItem } from '../lib/api';
import { PlayCircle, PauseCircle, Trash2, Clock, AlertCircle } from 'lucide-react';

export default function Queue() {
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchQueue = async () => {
    try {
      const data = await getQueue();
      setQueue(data);
    } catch (e) {
      console.error('Error fetching queue:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
    // Auto refresh queue
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleDelete = async (campaignId: string, index: number) => {
    if (!window.confirm('Tem certeza que deseja remover este contato da fila? Ele não receberá a mensagem.')) return;
    try {
      await deleteQueueItem(campaignId, index);
      fetchQueue();
    } catch (e) {
      console.error('Delete failed', e);
    }
  };

  const handleToggle = async (campaignId: string, index: number) => {
    try {
      await toggleQueueItem(campaignId, index);
      fetchQueue();
    } catch (e) {
      console.error('Toggle failed', e);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Fila de Disparos</h1>
          <p className="text-sm text-slate-500">Próximas mensagens agendadas para envio (Top 200)</p>
        </div>
        <button onClick={fetchQueue} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg transition-colors">
          Atualizar Fila
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 text-sm">Carregando fila...</div>
        ) : queue.length === 0 ? (
          <div className="p-16 text-center">
            <Clock className="w-12 h-12 mx-auto mb-4 text-slate-300" />
            <h3 className="text-lg font-bold text-slate-700 mb-1">Fila Vazia</h3>
            <p className="text-sm text-slate-500">Não há contatos na fila para campanhas em andamento.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-500 tracking-wider">Campanha</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-500 tracking-wider">Contato</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-500 tracking-wider">Telefone</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-500 tracking-wider">Status Fila</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-500 tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queue.map((item, i) => (
                  <tr key={`${item.campaignId}-${item.index}-${i}`} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-slate-800">{item.campaignName}</span>
                        <span className="text-[10px] uppercase font-bold text-indigo-500">{item.campaignStatus}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-slate-700">{item.contactName}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-mono text-slate-600">{item.contactPhone}</span>
                    </td>
                    <td className="px-6 py-4">
                      {item.isPaused ? (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold">
                          <PauseCircle className="w-3 h-3" /> Pausado
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
                          <PlayCircle className="w-3 h-3" /> Aguardando
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => handleToggle(item.campaignId, item.index)}
                        className={`inline-flex items-center justify-center p-2 rounded-lg border transition-colors ${
                          item.isPaused 
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' 
                            : 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100'
                        }`}
                        title={item.isPaused ? 'Retomar' : 'Pausar da Fila'}
                      >
                        {item.isPaused ? <PlayCircle className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => handleDelete(item.campaignId, item.index)}
                        className="inline-flex items-center justify-center p-2 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                        title="Remover da Fila"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
