import { useState, useEffect } from 'react';
import { getCampaigns, createCampaign, updateCampaign, getGroups, getWahaSessions, toggleCampaign, deleteCampaign } from '../lib/api';
import { Campaign, Group, WahaSession, DaySchedule } from '../types';
import { PlayCircle, PauseCircle, Plus, Trash2, CheckCircle2, Clock, Users, X, RefreshCw, Edit2, Eye, Copy, Calculator, ListTodo } from 'lucide-react';
import { format } from 'date-fns';
import { Modal } from '../components/Modal';
import { Link } from 'react-router-dom';

const DAYS_OF_WEEK = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' },
];

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [sessions, setSessions] = useState<WahaSession[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [schedules, setSchedules] = useState<DaySchedule[]>([]);
  const [intervalMin, setIntervalMin] = useState('30');
  const [intervalMax, setIntervalMax] = useState('60');
  const [distribution, setDistribution] = useState('round_robin');
  const [templates, setTemplates] = useState<string[]>(['']);
  
  // Custom modals and view states
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [campaignToDelete, setCampaignToDelete] = useState<string | null>(null);
  const [campaignToDuplicate, setCampaignToDuplicate] = useState<Campaign | null>(null);
  const [campaignToToggle, setCampaignToToggle] = useState<Campaign | null>(null);
  const [isViewOnly, setIsViewOnly] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [statsData, setStatsData] = useState<any>(null);

  const [statusFilter, setStatusFilter] = useState('All');

  const fetchData = async () => {
    try {
      const [camps, grps, sess] = await Promise.all([getCampaigns(), getGroups(), getWahaSessions()]);
      setCampaigns(camps);
      setGroups(grps);
      setSessions(sess);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const refreshGroups = async () => {
    const grps = await getGroups();
    setGroups(grps);
  };

  const refreshSessions = async () => {
    const sess = await getWahaSessions();
    setSessions(sess);
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(() => {
      getCampaigns().then(setCampaigns).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleTemplateChange = (index: number, val: string) => {
    const newT = [...templates];
    newT[index] = val;
    setTemplates(newT);
  };

  const addTemplate = () => setTemplates([...templates, '']);
  const removeTemplate = (i: number) => setTemplates(templates.filter((_, idx) => idx !== i));

  const addDaySchedule = () => setSchedules([...schedules, { dayOfWeek: 1, slots: [{ start: '08:00', end: '18:00' }] }]);
  const removeDaySchedule = (index: number) => setSchedules(schedules.filter((_, i) => i !== index));
  
  const updateDaySchedule = (index: number, dayOfWeek: number) => {
    const newS = [...schedules];
    newS[index].dayOfWeek = dayOfWeek;
    setSchedules(newS);
  };

  const addSlotToDay = (sIndex: number) => {
    const newS = [...schedules];
    newS[sIndex].slots.push({ start: '08:00', end: '18:00' });
    setSchedules(newS);
  };

  const removeSlotFromDay = (sIndex: number, slotIndex: number) => {
    const newS = [...schedules];
    newS[sIndex].slots.splice(slotIndex, 1);
    setSchedules(newS);
  };

  const updateSlot = (sIndex: number, slotIndex: number, field: 'start'|'end', val: string) => {
    const newS = [...schedules];
    newS[sIndex].slots[slotIndex][field] = val;
    setSchedules(newS);
  };

  const toggleSession = (name: string) => {
    setSelectedSessions(prev => 
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  const insertVariable = (i: number, variable: string) => {
    const textarea = document.getElementById(`template-edit-${i}`) as HTMLTextAreaElement;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const current = templates[i];
      const newValue = current.substring(0, start) + variable + current.substring(end);
      handleTemplateChange(i, newValue);
      
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + variable.length, start + variable.length);
      }, 0);
    } else {
      handleTemplateChange(i, templates[i] + variable);
    }
  };

  const handleEditClick = (campaign: Campaign, view: boolean = false) => {
    setEditId(campaign.id);
    setName(campaign.name);
    setGroupId(campaign.groupId);
    setSelectedSessions(campaign.sessions || []);
    setStartTime(campaign.startTime ? campaign.startTime.substring(0, 16) : '');
    setEndTime(campaign.endTime ? campaign.endTime.substring(0, 16) : '');
    setSchedules(campaign.schedules || []);
    setIntervalMin(campaign.intervalMin.toString());
    setIntervalMax(campaign.intervalMax.toString());
    setDistribution(campaign.distributionMethod);
    setTemplates(campaign.templates && campaign.templates.length > 0 ? campaign.templates : ['']);
    setIsViewOnly(view);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !groupId || !startTime || templates.filter(t => t.trim()).length === 0) {
      setAlertMsg('Preencha os campos obrigatórios (Nome, Grupo, Início, Templates).');
      return;
    }
    try {
      const payload = {
        name,
        groupId,
        sessions: selectedSessions,
        startTime,
        endTime,
        schedules,
        intervalMin: parseInt(intervalMin, 10),
        intervalMax: Math.max(parseInt(intervalMin, 10), parseInt(intervalMax, 10)),
        distributionMethod: distribution,
        templates: templates.filter(t => t.trim())
      };
      
      if (editId) {
        await updateCampaign(editId, payload);
      } else {
        await createCampaign(payload);
      }
      
      setShowForm(false);
      setEditId(null);
      // Reset form
      setName('');
      setGroupId('');
      setSelectedSessions([]);
      setStartTime('');
      setEndTime('');
      setSchedules([]);
      setIntervalMin('30');
      setIntervalMax('60');
      setTemplates(['']);
      setIsViewOnly(false);
      fetchData();
    } catch (err) {
      setAlertMsg('Erro ao salvar campanha');
    }
  };

  const handleToggle = async (camp: Campaign) => {
    if ((camp.status === 'Draft' || camp.status === 'Paused') && (!camp.sessions || camp.sessions.length === 0)) {
      setAlertMsg('Você precisa editar e selecionar pelo menos uma instância antes de iniciar a campanha.');
      return;
    }
    if (camp.status === 'Running' || camp.status === 'Paused') {
      setCampaignToToggle(camp);
    } else {
      await toggleCampaign(camp.id);
      fetchData();
    }
  };

  const confirmToggle = async () => {
    if (!campaignToToggle) return;
    await toggleCampaign(campaignToToggle.id);
    setCampaignToToggle(null);
    fetchData();
  };

  const confirmDelete = async () => {
    if (!campaignToDelete) return;
    await deleteCampaign(campaignToDelete);
    setCampaignToDelete(null);
    fetchData();
  };

  const confirmDuplicate = async () => {
    if (!campaignToDuplicate) return;
    try {
      const payload = {
        name: `${campaignToDuplicate.name} (Cópia)`,
        groupId: campaignToDuplicate.groupId,
        sessions: campaignToDuplicate.sessions || [],
        startTime: campaignToDuplicate.startTime,
        endTime: campaignToDuplicate.endTime,
        intervalMin: campaignToDuplicate.intervalMin,
        intervalMax: campaignToDuplicate.intervalMax,
        distributionMethod: campaignToDuplicate.distributionMethod,
        templates: campaignToDuplicate.templates,
        schedules: campaignToDuplicate.schedules || []
      };
      await createCampaign(payload);
      setCampaignToDuplicate(null);
      fetchData();
      setAlertMsg('Campanha duplicada com sucesso!');
    } catch (e) {
      setCampaignToDuplicate(null);
      setAlertMsg('Erro ao duplicar campanha.');
    }
  };

  const calculateStats = () => {
    if (!groupId) {
      setAlertMsg('Selecione um grupo para calcular as estatísticas.');
      return;
    }
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    const totalContacts = group.count;
    const sessionCount = selectedSessions.length || 1; // if 0, assume 1 as fallback config
    const msgsPerSession = Math.ceil(totalContacts / sessionCount);
    const avgIntervalSec = (parseInt(intervalMin) + parseInt(intervalMax)) / 2;
    
    // total approx time = (messages per session * avg interval) 
    const totalTimeSec = msgsPerSession * avgIntervalSec;
    const totalMins = Math.floor(totalTimeSec / 60);
    const totalHours = Math.floor(totalMins / 60);
    
    let timeStr = '';
    if (totalHours > 0) timeStr += `${totalHours} horas `;
    if (totalMins % 60 > 0) timeStr += `${totalMins % 60} minutos`;
    if (timeStr === '') timeStr = '< 1 minuto';

    let risk = 'Baixo';
    let riskColor = 'text-green-600';
    if (avgIntervalSec < 30) {
      risk = 'Alto (Chance de Banimento)';
      riskColor = 'text-red-600';
    } else if (avgIntervalSec < 60) {
      risk = 'Médio';
      riskColor = 'text-amber-600';
    }

    setStatsData({
      messagesPerSession: selectedSessions.length > 0 ? msgsPerSession : 0,
      totalTime: timeStr,
      risk,
      riskColor,
      totalContacts,
      sessionCount,
    });
    setShowStats(true);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'Draft': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'Running': return 'bg-green-100 text-green-700 border-green-200';
      case 'Paused': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'Completed': return 'bg-slate-100 text-slate-600 border-slate-200';
      default: return 'bg-indigo-50 text-indigo-700 border-indigo-100';
    }
  };

  const filteredCampaigns = statusFilter === 'All' ? campaigns : campaigns.filter(c => c.status === statusFilter);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Campanhas em Massa</h1>
        <div className="flex flex-col md:flex-row items-center gap-3">
          {!showForm && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-sans focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="All">Todos os Status</option>
              <option value="Draft">Rascunho</option>
              <option value="Running">Em Execução</option>
              <option value="Paused">Pausada</option>
              <option value="Completed">Concluída</option>
            </select>
          )}
          <button
            onClick={() => {
              if (!showForm) { setEditId(null); setIsViewOnly(false); }
              setShowForm(!showForm);
            }}
            className="flex items-center gap-2 bg-slate-900 hover:bg-black text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow-md transition-colors"
          >
            {showForm ? 'Cancelar' : <><Plus className="w-4 h-4"/> Nova Campanha</>}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden mb-8">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-tight">{isViewOnly ? 'Visualizar Campanha' : editId ? 'Editar Campanha' : 'Criar Nova Campanha de Massa'}</h2>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[11px] uppercase font-black text-slate-400 mb-1.5">Nome da Campanha</label>
                <input disabled={isViewOnly} type="text" required value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-sans focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-75 disabled:bg-slate-100" placeholder="Ex: Black Friday 2024"/>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[11px] uppercase font-black text-slate-400">Grupo de Contatos</label>
                    <button type="button" disabled={isViewOnly} onClick={refreshGroups} className="text-slate-400 hover:text-indigo-600 transition-colors disabled:opacity-50"><RefreshCw className="w-3.5 h-3.5" /></button>
                </div>
                <select disabled={isViewOnly} required value={groupId} onChange={e => setGroupId(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-sans focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-75 disabled:bg-slate-100">
                  <option value="">Selecione um grupo</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name} ({g.count} pessoas)</option>)}
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[11px] uppercase font-black text-slate-400">Instâncias de Disparo Ativas</label>
                <button type="button" disabled={isViewOnly} onClick={refreshSessions} className="text-slate-400 hover:text-indigo-600 transition-colors disabled:opacity-50"><RefreshCw className="w-3.5 h-3.5" /></button>
              </div>
              <div className="flex flex-wrap gap-2">
                {sessions.filter(s => s.status === 'WORKING' || selectedSessions.includes(s.name)).map(s => (
                  <label key={s.name} className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors ${isViewOnly ? 'opacity-75 cursor-not-allowed' : 'cursor-pointer'} ${selectedSessions.includes(s.name) ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}>
                    <input disabled={isViewOnly} type="checkbox" checked={selectedSessions.includes(s.name)} onChange={() => toggleSession(s.name)} className="rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 disabled:opacity-50"/>
                    <span className="text-xs font-bold text-slate-800 italic">{s.name}</span>
                  </label>
                ))}
                {sessions.length === 0 && <span className="text-xs text-slate-500">Nenhuma instância ativa.</span>}
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-dashed border-slate-300">
              <h3 className="text-[11px] font-black text-slate-500 uppercase mb-4 tracking-wider">Regras de Disparo</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">Início</label>
                  <input disabled={isViewOnly} type="datetime-local" required value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded text-sm disabled:opacity-75 disabled:bg-slate-100"/>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">Término (Opcional)</label>
                  <input disabled={isViewOnly} type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded text-sm disabled:opacity-75 disabled:bg-slate-100"/>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">Intervalo (s)</label>
                  <div className="flex items-center gap-2">
                    <input disabled={isViewOnly} type="number" min={30} max={500} step={10} required value={intervalMin} onChange={e => setIntervalMin(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded text-sm disabled:opacity-75 disabled:bg-slate-100"/>
                    <span className="text-slate-400 text-xs font-bold">a</span>
                    <input disabled={isViewOnly} type="number" min={30} max={500} step={10} required value={intervalMax} onChange={e => setIntervalMax(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded text-sm disabled:opacity-75 disabled:bg-slate-100"/>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">Distribuição de Carga</label>
                  <select disabled={isViewOnly} value={distribution} onChange={e => setDistribution(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded text-sm disabled:opacity-75 disabled:bg-slate-100">
                    <option value="round_robin">Round Robin (Sequencial)</option>
                    <option value="random">Randomize (Aleatório)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-dashed border-slate-300">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-wider">Horários Permitidos de Disparo (Opcional)</h3>
                {!isViewOnly && (
                  <button type="button" onClick={addDaySchedule} className="text-[10px] text-indigo-600 font-bold underline hover:text-indigo-800">
                    + Adicionar Dia
                  </button>
                )}
              </div>
              <p className="text-[10px] text-slate-500 italic mb-4">Define em quais dias da semana e intervalos as mensagens podem ser enviadas. Ex: Pausa pro almoço.</p>

              <div className="space-y-4">
                {schedules.map((schedule, sIndex) => (
                  <div key={sIndex} className="bg-white p-3 rounded border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-start gap-4">
                    <div className="md:w-1/3">
                      <select
                        disabled={isViewOnly}
                        value={schedule.dayOfWeek}
                        onChange={(e) => updateDaySchedule(sIndex, parseInt(e.target.value))}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 font-medium text-slate-700 disabled:opacity-75 disabled:bg-slate-100"
                      >
                        {DAYS_OF_WEEK.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                      </select>
                    </div>
                    <div className="flex-1 space-y-2">
                      {schedule.slots.map((slot, slotIndex) => (
                        <div key={slotIndex} className="flex items-center gap-2">
                          <input disabled={isViewOnly} type="time" value={slot.start} onChange={e => updateSlot(sIndex, slotIndex, 'start', e.target.value)} className="px-2 py-1 border border-slate-200 rounded text-sm disabled:opacity-75 disabled:bg-slate-100"/>
                          <span className="text-xs font-bold text-slate-400">até</span>
                          <input disabled={isViewOnly} type="time" value={slot.end} onChange={e => updateSlot(sIndex, slotIndex, 'end', e.target.value)} className="px-2 py-1 border border-slate-200 rounded text-sm disabled:opacity-75 disabled:bg-slate-100"/>
                          {schedule.slots.length > 1 && !isViewOnly && (
                            <button type="button" onClick={() => removeSlotFromDay(sIndex, slotIndex)} className="text-slate-400 hover:text-red-600 p-1">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                      {!isViewOnly && (
                        <button type="button" onClick={() => addSlotToDay(sIndex)} className="text-[10px] font-bold text-slate-500 hover:text-slate-800 uppercase tracking-widest mt-2 flex items-center gap-1">
                          <Plus className="w-3 h-3"/> Add Horário
                        </button>
                      )}
                    </div>
                    {!isViewOnly && (
                      <div>
                        <button type="button" onClick={() => removeDaySchedule(sIndex)} className="text-slate-400 hover:text-red-600 p-1.5 bg-slate-50 rounded-md border border-slate-200 hover:bg-red-50 hover:border-red-200">
                          <Trash2 className="w-4 h-4"/>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {schedules.length === 0 && (
                  <div className="text-xs text-slate-500">Nenhum horário configurado. O disparo ocorrerá em qualquer horário.</div>
                )}
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-3">
                <label className="block text-[11px] uppercase font-black text-slate-400">Templates de Mensagem</label>
                {!isViewOnly && (
                  <button type="button" onClick={addTemplate} className="text-[10px] text-indigo-600 font-bold underline hover:text-indigo-800">
                    + Adicionar Variação (A/B)
                  </button>
                )}
              </div>
              <p className="text-[10px] text-slate-500 italic mb-3">
                Variáveis do CSV: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-700">{'{{name}}'}</code>, <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-700">{'{{phone}}'}</code>. <br/>
                Para rotacionar texto (Spintax), use o formato: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-700">{'{Opção A|Opção B}'}</code>
              </p>
              <div className="space-y-4">
                {templates.map((tpl, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <div className="flex gap-2 items-start">
                      <textarea 
                        id={`template-edit-${i}`}
                        disabled={isViewOnly}
                        rows={3} 
                        placeholder="Olá {{name}}, temos uma novidade..." 
                        value={tpl} 
                        onChange={e => handleTemplateChange(i, e.target.value)} 
                        className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm font-sans resize-y focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-75 disabled:bg-slate-100"
                      />
                      {templates.length > 1 && !isViewOnly && (
                        <button type="button" onClick={() => removeTemplate(i)} className="text-slate-400 hover:text-red-600 p-2 bg-slate-50 hover:bg-red-50 rounded-lg border border-slate-200 hover:border-red-200 transition-colors">
                          <Trash2 className="w-5 h-5"/>
                        </button>
                      )}
                    </div>
                    {!isViewOnly && (
                      <div className="flex gap-2 items-center pl-1 mt-1">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Inserir:</span>
                        <button type="button" onClick={() => insertVariable(i, '{{name}}')} className="text-[10px] font-mono bg-white hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 py-1 px-2 rounded-md border border-slate-200 hover:border-indigo-300 transition-colors shadow-sm">{'{{name}}'}</button>
                        <button type="button" onClick={() => insertVariable(i, '{{phone}}')} className="text-[10px] font-mono bg-white hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 py-1 px-2 rounded-md border border-slate-200 hover:border-indigo-300 transition-colors shadow-sm">{'{{phone}}'}</button>
                        <button type="button" onClick={() => insertVariable(i, '{Oi|Olá|Eaí}')} className="text-[10px] font-mono bg-white hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 py-1 px-2 rounded-md border border-slate-200 hover:border-emerald-300 transition-colors shadow-sm">Spintax {'{A|B}'}</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col md:flex-row gap-3">
            {!isViewOnly && (
              <button type="button" onClick={calculateStats} className="w-full md:w-auto px-6 py-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg font-bold transition-all text-sm tracking-wide flex items-center justify-center gap-2">
                <Calculator className="w-4 h-4"/> ESTATÍSTICAS
              </button>
            )}
            {isViewOnly ? (
              <button type="button" onClick={() => setShowForm(false)} className="w-full md:flex-1 py-3 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg font-bold transition-all text-sm tracking-wide">
                FECHAR
              </button>
            ) : (
              <button type="submit" className="w-full md:flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-lg shadow-indigo-200 transition-all text-sm tracking-wide">
                {editId ? 'ATUALIZAR CAMPANHA' : 'SALVAR RASCUNHO'}
              </button>
            )}
          </div>
        </form>
      )}

      {!showForm && (
        <div>
          {loading ? (
            <div className="text-sm text-slate-500">Carregando campanhas...</div>
          ) : filteredCampaigns.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-xl shadow-sm border border-slate-200 text-slate-400">
            <PlayCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">
              {statusFilter === 'All' ? 'Nenhuma campanha em andamento.' : 'Nenhuma campanha encontrada para este status.'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredCampaigns.map(camp => {
              const totalProcessed = camp.sent + camp.failed;
              const progress = Math.round((totalProcessed / camp.totalContacts) * 100) || 0;
              const successRate = totalProcessed > 0 ? Math.round((camp.sent / totalProcessed) * 100) : 0;
              
              return (
              <div key={camp.id} className="grid grid-cols-1 lg:grid-cols-12 gap-0 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="col-span-1 lg:col-span-8 p-6 flex flex-col justify-between">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="text-lg font-bold text-slate-900 tracking-tight">{camp.name}</h3>
                        <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase tracking-wider ${statusColor(camp.status)}`}>{camp.status}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-medium text-slate-500 mt-2">
                        <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5"/> Grupo: {camp.groupName}</span>
                        <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5"/> Início: {format(new Date(camp.startTime), 'dd/MM HH:mm')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {camp.status !== 'Completed' && (
                        <button 
                          onClick={() => handleToggle(camp)}
                          className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-slate-50 text-indigo-700 rounded-md border border-slate-200 shadow-sm hover:bg-indigo-50 hover:border-indigo-200 transition-colors flex items-center gap-2"
                        >
                          {camp.status === 'Running' ? <><PauseCircle className="w-4 h-4"/> Pausar</> : camp.status === 'Draft' ? <><PlayCircle className="w-4 h-4"/> Iniciar</> : <><PlayCircle className="w-4 h-4"/> Retomar</>}
                        </button>
                      )}
                      {camp.status === 'Completed' || (camp.logs && camp.logs.length > 0) ? (
                        <Link 
                           to={`/campaigns/${camp.id}/logs`}
                           className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md border border-transparent hover:border-indigo-200 transition-colors"
                           title="Ver Logs Completos"
                        >
                          <ListTodo className="w-4 h-4"/>
                        </Link>
                      ) : null}
                      <button 
                        onClick={() => setCampaignToDuplicate(camp)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md border border-transparent hover:border-indigo-200 transition-colors"
                        title="Duplicar Campanha"
                      >
                        <Copy className="w-4 h-4"/>
                      </button>
                      {(camp.status === 'Draft' || camp.status === 'Paused') ? (
                        <button 
                           onClick={() => handleEditClick(camp)}
                           className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md border border-transparent hover:border-indigo-200 transition-colors"
                           title="Editar"
                        >
                          <Edit2 className="w-4 h-4"/>
                        </button>
                      ) : (
                        <button 
                           onClick={() => handleEditClick(camp, true)}
                           className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md border border-transparent hover:border-indigo-200 transition-colors"
                        >
                          <Eye className="w-4 h-4"/>
                        </button>
                      )}
                        {camp.status !== 'Running' && (
                          <button 
                            onClick={() => setCampaignToDelete(camp.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md border border-transparent hover:border-red-200 transition-colors"
                          >
                            <Trash2 className="w-4 h-4"/>
                          </button>
                        )}
                    </div>
                  </div>

                  <div className="mt-auto">
                    <div className="flex justify-between items-end mb-2">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Processamento: {progress}%</span>
                      <span className="text-xs font-bold text-slate-700">{totalProcessed} / {camp.totalContacts}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
                      <div className="bg-indigo-500 h-full rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
                    </div>
                  </div>
                </div>

                <div className="col-span-1 lg:col-span-4 bg-slate-900 text-slate-300 p-6 flex flex-col h-64 lg:h-auto">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Monitor Tempo Real</h4>
                    {camp.status === 'Running' && (
                      <div className="flex gap-1 opacity-70">
                        <div className="w-1 h-1 bg-indigo-400 rounded-full animate-pulse"></div>
                        <div className="w-1 h-1 bg-indigo-400 rounded-full animate-pulse delay-75"></div>
                        <div className="w-1 h-1 bg-indigo-400 rounded-full animate-pulse delay-150"></div>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 overflow-hidden flex flex-col">
                     <div className="grid grid-cols-2 gap-3 mb-4 shrink-0">
                       <div className="bg-slate-800 p-2.5 rounded-lg border border-slate-700/50">
                         <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Sucesso ({successRate}%)</div>
                         <div className="text-lg font-black text-white flex items-center gap-1.5">
                           <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                           {camp.sent}
                         </div>
                       </div>
                       <div className="bg-slate-800 p-2.5 rounded-lg border border-slate-700/50">
                         <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Falhas</div>
                         <div className="text-lg font-black text-amber-500">
                           {camp.failed}
                         </div>
                       </div>
                     </div>

                     <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 text-[10px] font-mono scrollbar-thin">
                       {camp.logs && camp.logs.slice(0, 10).map((log, li) => {
                         const isError = log.includes('Error') || log.includes('Failed');
                         return (
                           <div key={li} className="p-1.5 bg-slate-800/40 rounded border border-slate-800 text-slate-400 truncate flex items-center gap-2">
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isError ? 'bg-amber-500' : 'bg-green-500'}`}></div>
                              <span>{log}</span>
                           </div>
                         )
                       })}
                       {(!camp.logs || camp.logs.length === 0) && (
                         <div className="text-slate-600 text-center mt-4 text-xs font-sans">Sem logs no momento.</div>
                       )}
                     </div>
                  </div>
                </div>
              </div>
            )})}
          </div>
        )}
      </div>
      )}

      <Modal isOpen={!!alertMsg} onClose={() => setAlertMsg(null)} title="Aviso">
        <div className="mb-6 text-sm text-slate-600">{alertMsg}</div>
        <div className="flex justify-end">
          <button onClick={() => setAlertMsg(null)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-colors">
            Entendido
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!campaignToDelete} onClose={() => setCampaignToDelete(null)} title="Excluir Campanha">
        <div className="mb-6 text-sm text-slate-600">Tem certeza que deseja excluir esta campanha? Esta ação não pode ser desfeita.</div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setCampaignToDelete(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={confirmDelete} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors">
            Excluir
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!campaignToDuplicate} onClose={() => setCampaignToDuplicate(null)} title="Duplicar Campanha">
        <div className="mb-6 text-sm text-slate-600">Tem certeza que deseja criar uma cópia desta campanha? A nova campanha será salva como rascunho.</div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setCampaignToDuplicate(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={confirmDuplicate} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-colors">
            Duplicar
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!campaignToToggle} onClose={() => setCampaignToToggle(null)} title={campaignToToggle?.status === 'Running' ? "Pausar Campanha" : "Retomar Campanha"}>
         <div className="mb-6 text-sm text-slate-600">
           {campaignToToggle?.status === 'Running' 
             ? "Tem certeza que deseja pausar esta campanha? Os envios serão interrompidos até você retomá-la."
             : "Tem certeza que deseja retomar esta campanha? Os envios serão reiniciados a partir de onde pararam."}
         </div>
         <div className="flex justify-end gap-3">
           <button onClick={() => setCampaignToToggle(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
             Cancelar
           </button>
           <button onClick={confirmToggle} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-colors">
             {campaignToToggle?.status === 'Running' ? "Pausar" : "Retomar"}
           </button>
         </div>
      </Modal>

      <Modal isOpen={showStats} onClose={() => setShowStats(false)} title="Estatísticas da Campanha">
        <div className="mb-6 space-y-4">
          <p className="text-sm text-slate-600 border-b pb-4">
            Com base nas suas configurações atuais:
          </p>
          {statsData ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Total de Contatos</span>
                <span className="text-lg font-black text-slate-800">{statsData.totalContacts}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Instâncias Ativas</span>
                <span className="text-lg font-black text-slate-800">{statsData.sessionCount}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Msg por Instância</span>
                <span className="text-lg font-black text-slate-800">~{statsData.messagesPerSession}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Tempo Total Prox.</span>
                <span className="text-lg font-black text-indigo-700">{statsData.totalTime}</span>
              </div>
              <div className="col-span-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Nível de Risco de Ban</span>
                <span className={`text-lg font-black ${statsData.riskColor}`}>{statsData.risk}</span>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">Varia de acordo com o intervalo escolhido. Menos de 30 segundos é considerado alto risco.</p>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500">Calculando...</div>
          )}
        </div>
        <div className="flex justify-end">
          <button onClick={() => setShowStats(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            Fechar
          </button>
        </div>
      </Modal>
    </div>
  );
}
