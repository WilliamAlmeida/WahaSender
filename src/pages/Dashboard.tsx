import { useState, useEffect } from 'react';
import { getCampaigns, getGroups, getWahaSessions, getContacts } from '../lib/api';
import { Campaign, Group, WahaSession } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { Users, PlayCircle, CheckCircle2, MessageSquare, AlertCircle, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function Dashboard() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [sessions, setSessions] = useState<WahaSession[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [c, g, s, conts] = await Promise.all([
          getCampaigns(),
          getGroups(),
          getWahaSessions(),
          getContacts()
        ]);
        setCampaigns(c);
        setGroups(g);
        setSessions(s);
        setContacts(conts);
      } catch (e) {
        console.error('Error fetching dashboard data:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-500">
        Carregando painel de controle...
      </div>
    );
  }

  // --- STATS CALCULATION ---
  const activeSessions = sessions.filter(s => s.status === 'WORKING').length;

  const totalContacts = contacts.length;
  
  const activeCampaigns = campaigns.filter(c => c.status === 'Running').length;
  
  const totalSent = campaigns.reduce((acc, c) => acc + c.sent, 0);
  const totalFailed = campaigns.reduce((acc, c) => acc + c.failed, 0);
  const totalPending = campaigns.reduce((acc, c) => acc + Math.max(0, c.totalContacts - c.sent - c.failed), 0);

  const totalBlacklisted = contacts.filter(c => c.blacklisted).length;

  // --- CHART DATA ---
  
  // Status Distribution (Pie)
  const pieData = [
    { name: 'Enviadas', value: totalSent, color: '#10b981' }, // emerald-500
    { name: 'Falhas', value: totalFailed, color: '#ef4444' }, // red-500
    { name: 'Pendentes', value: totalPending, color: '#f59e0b' } // ambar-500
  ].filter(d => d.value > 0);

  // Top 5 Campaigns by Progress (Bar)
  const barData = campaigns
    .slice(0, 5)
    .map(c => ({
      name: c.name.length > 15 ? c.name.substring(0, 15) + '...' : c.name,
      Enviado: c.sent,
      Falha: c.failed,
      Pendente: Math.max(0, c.totalContacts - c.sent - c.failed)
    }));

  // --- DAILY SENT MESSAGES FOR LAST 7 DAYS ---
  const last7DaysData = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dateStr = d.toISOString().split('T')[0];
    return {
      date: dateStr,
      label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      'Mensagens Enviadas': 0
    };
  });

  campaigns.forEach(c => {
    if (c.logs) {
      c.logs.forEach(log => {
        const match = log.match(/^\[(.*?)\] Sent to/);
        if (match) {
          const logDateStr = match[1].split('T')[0];
          const dayData = last7DaysData.find(d => d.date === logDateStr);
          if (dayData) {
            dayData['Mensagens Enviadas'] += 1;
          }
        }
      });
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Painel de Controle</h1>
          <p className="text-sm text-slate-500">Visão geral do seu sistema de disparos.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/campaigns" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg transition-colors">
            Nova Campanha
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">
            <PlayCircle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Campanhas Ativas</p>
            <h3 className="text-2xl font-black text-slate-800">{activeCampaigns}</h3>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Msg Enviadas</p>
            <h3 className="text-2xl font-black text-slate-800">{totalSent}</h3>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Total de Contatos</p>
            <h3 className="text-2xl font-black text-slate-800">{totalContacts}</h3>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-red-50 text-red-600 rounded-lg">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Blacklisted</p>
            <h3 className="text-2xl font-black text-slate-800">{totalBlacklisted}</h3>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-slate-50 text-slate-600 rounded-lg">
            <MessageSquare className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Instâncias Ativas</p>
            <h3 className="text-2xl font-black text-slate-800">{activeSessions} / {sessions.length}</h3>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Progress Bar Chart */}
        <div className="lg:col-span-2 bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col h-96">
          <h2 className="text-sm font-bold text-slate-800 mb-4">Progresso das Campanhas</h2>
          {campaigns.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              Nenhuma campanha encontrada.
            </div>
          ) : (
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="Enviado" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="Falha" stackId="a" fill="#ef4444" />
                  <Bar dataKey="Pendente" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Global Distribution Pie Chart */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col h-96">
          <h2 className="text-sm font-bold text-slate-800 mb-4">Distribuição de Status</h2>
          {pieData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              Sem dados de disparo.
            </div>
          ) : (
            <div className="flex-1 min-h-0 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-xs font-bold text-slate-400 uppercase">Total</span>
                <span className="text-xl font-black text-slate-800">
                  {pieData.reduce((acc, curr) => acc + curr.value, 0)}
                </span>
              </div>
            </div>
          )}
          
          {/* Legend */}
          {pieData.length > 0 && (
            <div className="flex justify-center gap-4 mt-4 text-xs font-medium text-slate-600">
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-emerald-500"></div> Enviadas</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-amber-500"></div> Pendentes</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-red-500"></div> Falhas</div>
            </div>
          )}
        </div>

      </div>

      {/* 7 Days Performance Chart */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col h-[300px]">
        <h2 className="text-sm font-bold text-slate-800 mb-4">Desempenho nos Últimos 7 Dias</h2>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={last7DaysData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Line type="step" dataKey="Mensagens Enviadas" stroke="#4f46e5" strokeWidth={3} dot={{ r: 4, fill: '#4f46e5' }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    
      {/* Alert Warning for Sessions */}
      {sessions.length > 0 && activeSessions === 0 && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3 shadow-sm">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-sm">Nenhuma instância conectada</h4>
            <p className="text-sm opacity-90 mt-1">
              As campanhas não poderão disparar mensagens. Vá até a tela de <Link to="/sessions" className="underline font-bold">Instâncias</Link> e conecte seu WhatsApp.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
