import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getCampaign } from '../lib/api';
import { ArrowLeft, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { Campaign } from '../types';

export default function CampaignLogs() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCampaign = async () => {
    try {
      const data = await getCampaign(id!);
      setCampaign(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCampaign();
  }, [id]);

  if (loading) return <div className="p-8 text-slate-500">Carregando logs...</div>;
  if (!campaign) return <div className="p-8 text-red-500">Campanha não encontrada.</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6 flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center gap-4 shrink-0">
        <Link to="/campaigns" className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">{campaign.name} - Logs</h1>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            {campaign.totalContacts} Contatos | {campaign.sent} Enviados | {campaign.failed} Falhas
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-800">Histórico de Disparos</h2>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-2">
          {!campaign.logs || campaign.logs.length === 0 ? (
            <div className="text-slate-400 text-sm text-center py-8">Nenhum log registrado ainda.</div>
          ) : (
             campaign.logs.map((log, idx) => {
               const isError = log.includes('Error') || log.includes('Failed');
               return (
                 <div key={idx} className={`p-3 rounded-lg border text-sm font-mono ${isError ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                   <div className="flex items-start gap-2">
                     {isError ? <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-500" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />}
                     <span className="break-all">{log}</span>
                   </div>
                 </div>
               );
             })
          )}
        </div>
      </div>
    </div>
  );
}
