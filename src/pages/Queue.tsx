import { useState, useEffect } from 'react';
import { getQueue, deleteQueueItem, toggleQueueItem, getCampaigns, cleanupCancelledQueue } from '../lib/api';
import { PlayCircle, PauseCircle, Trash2, Clock, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Queue() {
  const [queue, setQueue] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [campaignFilter, setCampaignFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const fetchQueue = async (page = 1, campaign = '', status = '') => {
    try {
      setLoading(true);
      const data = await getQueue({
        page,
        campaign: campaign || undefined,
        status: status || undefined
      });
      setQueue(data.items);
      setCurrentPage(data.pagination.page);
      setTotalPages(data.pagination.totalPages);
    } catch (e) {
      console.error('Error fetching queue:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchCampaigns = async () => {
    try {
      const data = await getCampaigns();
      setCampaigns(data);
    } catch (e) {
      console.error('Error fetching campaigns:', e);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  useEffect(() => {
    fetchQueue(1, campaignFilter, statusFilter);
  }, [campaignFilter, statusFilter]);

  const handlePageChange = (newPage: number) => {
    fetchQueue(newPage, campaignFilter, statusFilter);
  };

  const handleDelete = async (campaignId: string, index: number) => {
    if (!window.confirm('Tem certeza que deseja remover este contato da fila? Ele não receberá a mensagem.')) return;
    try {
      await deleteQueueItem(campaignId, index);
      fetchQueue(currentPage, campaignFilter, statusFilter);
    } catch (e) {
      console.error('Delete failed', e);
    }
  };

  const handleToggle = async (campaignId: string, index: number) => {
    try {
      await toggleQueueItem(campaignId, index);
      fetchQueue(currentPage, campaignFilter, statusFilter);
    } catch (e) {
      console.error('Toggle failed', e);
    }
  };

  const handleCleanupCancelled = async () => {
    if (!window.confirm('Tem certeza que deseja remover TODOS os contatos de campanhas canceladas? Esta ação não pode ser desfeita.')) return;
    try {
      const result = await cleanupCancelledQueue();
      toast.success(`${result.deleted} contatos removidos das campanhas canceladas`);
      fetchQueue(1, campaignFilter, statusFilter);
    } catch (e) {
      console.error('Cleanup failed', e);
      toast.error('Erro ao limpar campanhas canceladas');
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Fila de Disparos</h1>
          <p className="text-sm text-slate-500">Próximas mensagens agendadas para envio (50 por página)</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleCleanupCancelled} className="flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-bold rounded-lg border border-red-200 transition-colors">
            <AlertCircle className="w-4 h-4"/> Limpar Canceladas
          </button>
          <button onClick={() => fetchQueue(currentPage, campaignFilter, statusFilter)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg transition-colors">
            Atualizar Fila
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Filtros</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Campanha</label>
            <select
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Todas as campanhas</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Status da Fila</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Todos os status</option>
              <option value="waiting">Aguardando</option>
              <option value="paused">Pausado</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 text-sm">Carregando fila...</div>
        ) : queue.length === 0 ? (
          <div className="p-16 text-center">
            <Clock className="w-12 h-12 mx-auto mb-4 text-slate-300" />
            <h3 className="text-lg font-bold text-slate-700 mb-1">Fila Vazia</h3>
            <p className="text-sm text-slate-500">Não há contatos na fila para os filtros selecionados.</p>
          </div>
        ) : (
          <>
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

            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="text-sm text-slate-600">
                Página <span className="font-bold text-slate-800">{currentPage}</span> de <span className="font-bold text-slate-800">{totalPages}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" /> Anterior
                </button>
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Próxima <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
