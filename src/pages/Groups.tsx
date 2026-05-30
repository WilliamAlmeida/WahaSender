import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getGroups, createGroup, deleteGroup, getContacts } from '../lib/api';
import { Group } from '../types';
import { Upload, Users, Trash2, Eye, UserCheck, Search } from 'lucide-react';
import { Modal } from '../components/Modal';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export default function Groups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupName, setGroupName] = useState('');
  const [contacts, setContacts] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null);

  // Estados para seleção de contatos globais
  const [globalContacts, setGlobalContacts] = useState<any[]>([]);
  const [showSelectSavedModal, setShowSelectSavedModal] = useState(false);
  const [savedSearchTerm, setSavedSearchTerm] = useState('');
  const [selectedSavedIds, setSelectedSavedIds] = useState<Set<string>>(new Set());
  const [savedCurrentPage, setSavedCurrentPage] = useState(1);
  const savedItemsPerPage = 10;

  const fetchGroups = async () => {
    try {
      const data = await getGroups();
      setGroups(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const fetchGlobalContacts = async () => {
    try {
      const data = await getContacts();
      setGlobalContacts(data);
    } catch (e) {
      console.error('Erro ao buscar contatos globais', e);
    }
  };

  useEffect(() => {
    fetchGroups();
    fetchGlobalContacts();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isCSV = file.name.endsWith('.csv');
    if (isCSV) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          setContacts(prev => [...prev, ...results.data]);
        }
      });
    } else {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        setContacts(prev => [...prev, ...data]);
      };
      reader.readAsBinaryString(file);
    }
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      { nome: 'Geraldo Alencar', telefone: '5511999999999' },
      { nome: 'Ana Carolina', telefone: '5521988888888' }
    ];
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Modelo_Importacao');
    worksheet['!cols'] = [{ wch: 25 }, { wch: 18 }];
    XLSX.writeFile(workbook, 'layout_modelo_contatos.xlsx');
  };

  const handleAddManualContact = () => {
    if (!manualPhone.trim()) {
      setAlertMsg('Insira pelo menos o telefone.');
      return;
    }
    setContacts(prev => [...prev, { name: manualName.trim(), phone: manualPhone.trim() }]);
    setManualName('');
    setManualPhone('');
  };

  // Lógica de seleção e filtragem dos contatos globais salvos
  const filteredGlobalContacts = globalContacts.filter((c: any) => 
    (c.name?.toLowerCase().includes(savedSearchTerm.toLowerCase())) ||
    ((c.phone || c.telefone)?.toString().includes(savedSearchTerm))
  );

  const savedTotalPages = Math.ceil(filteredGlobalContacts.length / savedItemsPerPage);
  const paginatedGlobalContacts = filteredGlobalContacts.slice(
    (savedCurrentPage - 1) * savedItemsPerPage,
    savedCurrentPage * savedItemsPerPage
  );

  const handleToggleSelectSaved = (cid: string) => {
    const newSet = new Set(selectedSavedIds);
    if (newSet.has(cid)) {
      newSet.delete(cid);
    } else {
      newSet.add(cid);
    }
    setSelectedSavedIds(newSet);
  };

  const handleToggleSelectAllSaved = () => {
    if (selectedSavedIds.size === filteredGlobalContacts.length) {
      setSelectedSavedIds(new Set());
    } else {
      setSelectedSavedIds(new Set(filteredGlobalContacts.map((c: any) => c._id)));
    }
  };

  const handleConfirmSelectSaved = () => {
    const selectedContacts = globalContacts.filter((c: any) => selectedSavedIds.has(c._id));
    
    setContacts(prev => {
      const existingPhones = new Set(prev.map(c => (c.phone || c.telefone)?.toString().replace(/\D/g, '')));
      const newContacts = [...prev];
      
      selectedContacts.forEach(sc => {
        const phoneClean = (sc.phone || sc.telefone)?.toString().replace(/\D/g, '');
        if (!existingPhones.has(phoneClean)) {
          newContacts.push({ name: sc.name, phone: phoneClean });
          existingPhones.add(phoneClean);
        }
      });
      
      return newContacts;
    });

    setShowSelectSavedModal(false);
    setSelectedSavedIds(new Set());
    setSavedSearchTerm('');
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || contacts.length === 0) {
      setAlertMsg('Insira um nome e carregue contatos.');
      return;
    }
    setUploading(true);
    try {
      await createGroup(groupName, contacts);
      setGroupName('');
      setContacts([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await fetchGroups();
    } catch (e) {
      setAlertMsg('Erro ao criar grupo.');
    }
    setUploading(false);
  };

  const handleDelete = (id: string) => {
    setGroupToDelete(id);
  };

  const confirmDelete = async () => {
    if (!groupToDelete) return;
    try {
      await deleteGroup(groupToDelete);
      await fetchGroups();
      setGroupToDelete(null);
    } catch (e: any) {
      setGroupToDelete(null);
      setAlertMsg(e.response?.data?.error || 'Erro ao excluir.');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight mb-6">Contatos e Grupos</h1>
        
        <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-5">Novo Grupo de Disparo</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-[11px] uppercase font-black text-slate-400 mb-1.5">Nome do Grupo</label>
              <input
                type="text"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                placeholder="Ex: Leads de Lançamento"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </div>
            
            <div>
              <label className="block text-[11px] uppercase font-black text-slate-400 mb-1.5">Importar Contatos da Planilha (CSV/XLSX)</label>
              <input
                type="file"
                accept=".csv, .xlsx, .xls"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600 file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 transition-colors"
              />
              <div className="flex justify-between items-center mt-1.5 mb-4">
                <p className="text-[10px] text-slate-500 italic">* Cabeçalho na primeira linha. Auto-detecta "nome", "telefone".</p>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  Baixar Planilha Modelo
                </button>
              </div>
              
              <div className="flex justify-between items-center mb-1.5 mt-2">
                <label className="block text-[11px] uppercase font-black text-slate-400">Ou Adicionar Avulso Manualmente</label>
                <button
                  type="button"
                  onClick={() => { fetchGlobalContacts(); setShowSelectSavedModal(true); }}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-1"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  Selecionar dos Contatos Salvos
                </button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="Nome (Opcional)"
                  value={manualName}
                  onChange={e => setManualName(e.target.value)}
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                />
                <input
                  type="text"
                  placeholder="WhatsApp Ex: 551199999999"
                  value={manualPhone}
                  onChange={e => setManualPhone(e.target.value)}
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                  onKeyDown={e => e.key === 'Enter' ? handleAddManualContact() : null}
                />
                <button
                  type="button"
                  onClick={handleAddManualContact}
                  className="px-4 py-2 bg-slate-900 text-white font-bold rounded-lg hover:bg-black transition-colors"
                >
                  Adicionar
                </button>
              </div>
            </div>
          </div>

          {contacts.length > 0 && (
            <div className="mb-6 p-3 bg-indigo-50/50 rounded-lg border border-indigo-100 text-sm text-indigo-800 font-medium">
              <span className="font-bold">{contacts.length}</span> contatos carregados e prontos para salvar.
            </div>
          )}

          <div className="pt-4 border-t border-slate-100">
            <button
              onClick={handleCreateGroup}
              disabled={uploading || contacts.length === 0 || !groupName.trim()}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow-lg shadow-indigo-200 transition-all w-full md:w-auto justify-center"
            >
              <Upload className="w-4 h-4" />
              Salvar Novo Grupo
            </button>
          </div>
        </section>
      </div>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600 mb-4">Meus Grupos Cadastrados</h2>
        {loading ? (
          <div className="text-sm text-slate-500">Carregando...</div>
        ) : groups.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-xl shadow-sm border border-slate-200 text-slate-400">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">Nenhum grupo cadastrado.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Nome do Grupo</th>
                    <th className="px-6 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Volume de Contatos</th>
                    <th className="px-6 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-wider">Ações</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {groups.map((group) => (
                    <tr key={group.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-3 whitespace-nowrap text-sm font-bold text-slate-800">{group.name}</td>
                      <td className="px-6 py-3 whitespace-nowrap text-xs font-medium text-slate-600 bg-slate-50/50">{group.count} destinatários</td>
                      <td className="px-6 py-3 whitespace-nowrap text-right flex items-center justify-end gap-2">
                        <Link to={`/groups/${group.id}`} className="text-slate-400 hover:text-indigo-600 transition-colors p-1.5 rounded-md hover:bg-indigo-50 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider">
                          <Eye className="w-4 h-4" /> 
                          Ver
                        </Link>
                        <button onClick={() => handleDelete(group.id)} className="text-slate-400 hover:text-red-600 transition-colors p-1.5 rounded-md hover:bg-red-50 inline-flex">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <Modal isOpen={!!alertMsg} onClose={() => setAlertMsg(null)} title="Aviso">
        <div className="mb-6 text-sm text-slate-600">{alertMsg}</div>
        <div className="flex justify-end">
          <button onClick={() => setAlertMsg(null)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-colors">
            Entendido
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!groupToDelete} onClose={() => setGroupToDelete(null)} title="Excluir Grupo">
        <div className="mb-6 text-sm text-slate-600">Tem certeza que deseja excluir este grupo? Esta ação não pode ser desfeita.</div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setGroupToDelete(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={confirmDelete} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors">
            Excluir
          </button>
        </div>
      </Modal>

      <Modal 
        isOpen={showSelectSavedModal} 
        onClose={() => { setShowSelectSavedModal(false); setSelectedSavedIds(new Set()); }} 
        title="Selecionar dos Contatos Salvos"
        size="lg"
      >
        <div className="space-y-4">
          <div className="flex bg-slate-50 p-2 rounded-lg border border-slate-200">
            <Search className="w-4 h-4 text-slate-400 mx-2 self-center" />
            <input 
              type="text" 
              placeholder="Buscar por nome ou telefone..." 
              value={savedSearchTerm}
              onChange={e => { setSavedSearchTerm(e.target.value); setSavedCurrentPage(1); }}
              className="flex-1 bg-transparent border-none focus:ring-0 text-xs py-1"
            />
          </div>

          <div className="max-h-[300px] overflow-y-auto border border-slate-100 rounded-lg">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-2 text-left w-10">
                    <input 
                      type="checkbox" 
                      checked={filteredGlobalContacts.length > 0 && selectedSavedIds.size === filteredGlobalContacts.length}
                      onChange={handleToggleSelectAllSaved}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" 
                    />
                  </th>
                  <th className="px-4 py-2 text-left text-[9px] font-black text-slate-400 uppercase tracking-wider">Nome</th>
                  <th className="px-4 py-2 text-left text-[9px] font-black text-slate-400 uppercase tracking-wider">Telefone</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {paginatedGlobalContacts.map((c: any) => (
                  <tr 
                    key={c._id} 
                    onClick={() => handleToggleSelectSaved(c._id)}
                    className={`hover:bg-slate-50/50 cursor-pointer transition-colors ${selectedSavedIds.has(c._id) ? 'bg-indigo-50/30' : ''}`}
                  >
                    <td className="px-4 py-2 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <input 
                        type="checkbox" 
                        checked={selectedSavedIds.has(c._id)} 
                        onChange={() => handleToggleSelectSaved(c._id)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" 
                      />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${c.blacklisted ? 'text-red-700 line-through' : 'text-slate-800'}`}>{c.name || '-'}</span>
                        {c.blacklisted && <span className="text-[8px] uppercase font-bold bg-red-100 text-red-700 px-1 py-0.5 rounded">Blacklist</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="text-xs font-mono text-slate-600">{c.phone || c.telefone}</span>
                    </td>
                  </tr>
                ))}
                {filteredGlobalContacts.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-xs text-slate-400 font-medium">Nenhum contato encontrado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Paginação do Modal */}
          {savedTotalPages > 1 && (
            <div className="flex items-center justify-between pt-2 shrink-0">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                Pág. {savedCurrentPage} de {savedTotalPages}
              </span>
              <div className="flex gap-1">
                <button 
                  disabled={savedCurrentPage === 1} 
                  onClick={() => setSavedCurrentPage(prev => prev - 1)}
                  className="px-2 py-1 text-[10px] font-bold uppercase bg-white border border-slate-200 rounded text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm"
                >
                  Anterior
                </button>
                <button 
                  disabled={savedCurrentPage === savedTotalPages} 
                  onClick={() => setSavedCurrentPage(prev => prev + 1)}
                  className="px-2 py-1 text-[10px] font-bold uppercase bg-white border border-slate-200 rounded text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button 
              onClick={() => { setShowSelectSavedModal(false); setSelectedSavedIds(new Set()); }} 
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs transition-colors"
            >
              Cancelar
            </button>
            <button 
              onClick={handleConfirmSelectSaved} 
              disabled={selectedSavedIds.size === 0}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-1"
            >
              <UserCheck className="w-3.5 h-3.5" />
              Adicionar Selecionados ({selectedSavedIds.size})
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
