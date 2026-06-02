import { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { getContacts, updateContact, deleteContact, deleteAllContacts, importGlobalContacts, getContactCampaigns } from '../lib/api';
import {
  Users, Search, Trash2, Edit2, ShieldAlert, Shield, Upload, List, History,
  PlayCircle, XCircle, CheckCircle, UserPlus, Table, ArrowRight, Check, ChevronDown, MoreVertical, AlertTriangle
} from 'lucide-react';
import { format } from 'date-fns';
import { Modal } from '../components/Modal';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

const formatPhone = (phone: string) => {
  const p = (phone || '').toString().replace(/\D/g, '');
  if (p.length === 12 || p.length === 13) {
    if (p.startsWith('55')) {
      const ddd = p.slice(2, 4);
      if (p.length === 13) {
        return `+55 (${ddd}) ${p.slice(4, 9)}-${p.slice(9)}`;
      } else {
        return `+55 (${ddd}) ${p.slice(4, 8)}-${p.slice(8)}`;
      }
    }
  }
  if (p.length === 10 || p.length === 11) {
    const ddd = p.slice(0, 2);
    if (p.length === 11) {
      return `(${ddd}) ${p.slice(2, 7)}-${p.slice(7)}`;
    } else {
      return `(${ddd}) ${p.slice(2, 6)}-${p.slice(6)}`;
    }
  }
  return phone || '-';
};

export default function GlobalContacts() {
  const [searchParams] = useSearchParams();
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Resultado da importação (modal informativo)
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
    invalid: number;
    limit?: number;
    planName?: string;
  } | null>(null);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');

  // Bulk action
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contactToDelete, setContactToDelete] = useState<string | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [showBulkRestoreConfirm, setShowBulkRestoreConfirm] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

  // Groups
  const [showGroupsForContact, setShowGroupsForContact] = useState<any | null>(null);

  // Tabs and History
  const DefaultTab = searchParams.get('tab') === 'blacklisted' ? 'blacklisted' : 'all';
  const [activeTab, setActiveTab] = useState<'all' | 'blacklisted'>(DefaultTab);
  const [campaignsHistoryFor, setCampaignsHistoryFor] = useState<any | null>(null);
  const [campaignsHistory, setCampaignsHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Manual Contact Add
  const [showAddModal, setShowAddModal] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');

  // --- Estados do importador inteligente com mapeamento de colunas ---
  const [showMapModal, setShowMapModal] = useState(false);
  const [rawImportData, setRawImportData] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [selectedNameCol, setSelectedNameCol] = useState<string>('');
  const [selectedPhoneCol, setSelectedPhoneCol] = useState<string>('');

  const filterValidContacts = (data: any[]) => {
    return data.filter(c => {
      const p = (c.phone || '').toString().replace(/\D/g, '');
      return p.length >= 10 && p.length <= 15; // valid basic numeric length 
    });
  };

  const fetchContacts = async () => {
    try {
      const data = await getContacts();
      setContacts(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);

    const processRawData = (data: any[]) => {
      if (data.length === 0) {
        alert("O arquivo selecionado está vazio.");
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      // Extrai os cabeçalhos das colunas
      const fileHeaders = Object.keys(data[0]);
      setHeaders(fileHeaders);
      setRawImportData(data);

      // Auto-detecção de colunas inteligente
      const nameMatch = fileHeaders.find(h => /nome|name|client|cliente|usuario|user/i.test(h)) || '';
      const phoneMatch = fileHeaders.find(h => /tel|phone|cel|whats|num|fone|contato/i.test(h)) || '';

      setSelectedNameCol(nameMatch);
      setSelectedPhoneCol(phoneMatch || fileHeaders[0] || ''); // fallback obrigatório

      // Abre o modal de mapeamento
      setShowMapModal(true);
      setImporting(false);
    };

    const isCSV = file.name.endsWith('.csv');
    if (isCSV) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          processRawData(results.data);
        }
      });
    } else {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const bstr = evt.target?.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const data = XLSX.utils.sheet_to_json(ws);
          processRawData(data);
        } catch (err) {
          alert('Erro ao ler a planilha Excel. Verifique o formato.');
          setImporting(false);
        }
      };
      reader.readAsBinaryString(file);
    }
  };

  const handleConfirmMapping = async () => {
    if (!selectedPhoneCol) {
      alert("A coluna de Telefone é obrigatória para importação!");
      return;
    }

    setImporting(true);
    setShowMapModal(false);

    try {
      // Mapeia os dados usando as colunas relacionadas pelo usuário
      const mappedData = rawImportData.map((item: any) => {
        return {
          name: selectedNameCol ? (item[selectedNameCol] || '').toString().trim() : '',
          phone: selectedPhoneCol ? (item[selectedPhoneCol] || '').toString().replace(/\D/g, '').trim() : ''
        };
      });

      const validData = filterValidContacts(mappedData);
      const invalid = mappedData.length - validData.length;

      if (validData.length === 0) {
        setImportResult({ imported: 0, skipped: 0, invalid });
        if (fileInputRef.current) fileInputRef.current.value = '';
        setImporting(false);
        return;
      }

      const res = await importGlobalContacts(validData);
      await fetchContacts();

      setImportResult({
        imported: res.count ?? 0,
        skipped: res.skipped ?? 0,
        invalid,
        limit: res.limit,
        planName: res.planName,
      });

    } catch (err: any) {
      console.error('Erro ao importar contatos', err);
      const apiMsg = err?.response?.data?.error;
      alert(apiMsg || 'Falha ao importar contatos.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setRawImportData([]);
    }
  };

  const handleDownloadTemplate = () => {
    // Layout de exemplo com dados fictícios elegantes
    const templateData = [
      { nome: 'Geraldo Alencar', telefone: '5511999999999' },
      { nome: 'Ana Carolina', telefone: '5521988888888' },
      { nome: 'Waha Sender Suporte', telefone: '5541977777777' }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Modelo_Importacao');

    // Estilo básico de tamanho de coluna
    worksheet['!cols'] = [
      { wch: 25 }, // Nome
      { wch: 18 }  // Telefone
    ];

    XLSX.writeFile(workbook, 'layout_modelo_contatos.xlsx');
  };

  const handleViewHistory = async (contact: any) => {
    setCampaignsHistoryFor(contact);
    setLoadingHistory(true);
    try {
      const data = await getContactCampaigns(contact._id);
      setCampaignsHistory(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleAddManualContact = async () => {
    const p = manualPhone.replace(/\D/g, '');
    if (p.length < 10 || p.length > 15) {
      alert('Telefone inválido. Insira apenas números, com DDD. Ex: 5511999999999');
      return;
    }
    try {
      await importGlobalContacts([{ name: manualName, phone: p }]);
      await fetchContacts();
      setManualName('');
      setManualPhone('');
      setShowAddModal(false);
    } catch (e: any) {
      console.error('Failed to add manual contact', e);
      alert(e?.response?.data?.error || 'Falha ao adicionar contato.');
    }
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  const filteredContacts = contacts.filter((c: any) => {
    if (activeTab === 'blacklisted' && !c.blacklisted) return false;
    
    return (c.name?.toLowerCase().includes(searchTerm.toLowerCase())) || 
           ((c.phone)?.toString().includes(searchTerm));
  });

  const totalPages = Math.ceil(filteredContacts.length / itemsPerPage);
  const paginatedContacts = filteredContacts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const p = editPhone.replace(/\D/g, '');
    if (p.length < 10 || p.length > 15) {
      alert('Telefone inválido. Insira apenas números, com DDD. Ex: 5511999999999');
      return;
    }
    try {
      await updateContact(editingId, { name: editName, phone: p });
      setContacts(prev => prev.map(c => c._id === editingId ? { ...c, name: editName, phone: p } : c));
      setEditingId(null);
    } catch (e) {
      console.error('Failed to update contact', e);
    }
  };

  const handleToggleBlacklist = async (id: string, currentlyBlacklisted: boolean) => {
    try {
      await updateContact(id, { blacklisted: !currentlyBlacklisted });
      setContacts(prev => prev.map(c => c._id === id ? { ...c, blacklisted: !currentlyBlacklisted } : c));
    } catch (e) {
      console.error('Failed to toggle blacklist', e);
    }
  };

  const confirmDeleteContact = async () => {
    if (!contactToDelete) return;
    try {
      await deleteContact(contactToDelete);
      setContacts(prev => prev.filter(c => c._id !== contactToDelete));
    } catch (e) {
      console.error('Failed to delete contact', e);
    } finally {
      setContactToDelete(null);
    }
  };

  const confirmBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      await Promise.all(Array.from(selectedIds).map(id => deleteContact(id)));
      setContacts(prev => prev.filter(c => !selectedIds.has(c._id)));
      setSelectedIds(new Set());
    } catch (e) {
      console.error('Failed to bulk delete', e);
    } finally {
      setShowBulkDeleteConfirm(false);
    }
  };

  const confirmBulkRestore = async () => {
    if (selectedIds.size === 0) return;
    try {
      await Promise.all(Array.from(selectedIds).map(id => updateContact(id, { blacklisted: false })));
      setContacts(prev => prev.map(c => selectedIds.has(c._id) ? { ...c, blacklisted: false } : c));
      setSelectedIds(new Set());
    } catch (e) {
      console.error('Failed to bulk restore', e);
    } finally {
      setShowBulkRestoreConfirm(false);
    }
  };

  const confirmDeleteAll = async () => {
    if (contacts.length === 0) return;
    try {
      await deleteAllContacts();
      setContacts([]);
      setSelectedIds(new Set());
    } catch (e) {
      console.error('Failed to delete all contacts', e);
      alert('Erro ao deletar todos os contatos');
    } finally {
      setShowDeleteAllConfirm(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedContacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedContacts.map((c: any) => c._id)));
    }
  };

  const toggleSelect = (cid: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(cid)) newSet.delete(cid);
    else newSet.add(cid);
    setSelectedIds(newSet);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-start justify-between shrink-0 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Diretório Global de Contatos</h1>
          <p className="text-sm text-slate-500">Único repositório contendo {contacts.length} contatos sincronizados.</p>
        </div>
        <div className="flex flex-col gap-3 items-end">
          {/* Ações em Bulk */}
          {selectedIds.size > 0 && activeTab === 'blacklisted' && (
              <div className="flex gap-2 flex-wrap justify-end">
                <button
                  onClick={() => setShowBulkRestoreConfirm(true)}
                  className="flex items-center gap-2 px-3 py-2 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg text-xs font-bold border border-green-200 transition-colors shadow-sm whitespace-nowrap"
                >
                  <Shield className="w-4 h-4" />
                  Remover da Blacklist
                </button>
            </div>
          )}

          {/* Ações de Importação/Adição */}
          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={handleDownloadTemplate}
              className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold border border-slate-200 transition-colors shadow-sm"
              title="Baixar planilha de exemplo com layout correto de colunas"
            >
              <Table className="w-4 h-4" />
              Modelo
            </button>

            <input
              type="file"
              accept=".csv, .xlsx, .xls"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors shadow-sm disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {importing ? 'Proc...' : 'Importar'}
            </button>

            {contacts.length > 0 && selectedIds.size === 0 && (
              <button
                onClick={() => setShowDeleteAllConfirm(true)}
                className="flex items-center gap-2 px-3 py-2 bg-orange-50 hover:bg-orange-100 text-orange-600 rounded-lg text-xs font-bold border border-orange-200 transition-colors shadow-sm"
                title="Deletar todos os contatos importados"
              >
                <Trash2 className="w-4 h-4" />
                Deletar Tudo
              </button>
            )}
            
            {selectedIds.size > 0 && (
              <button
                onClick={() => setShowBulkDeleteConfirm(true)}
                className="flex items-center gap-2 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-bold border border-red-200 transition-colors shadow-sm whitespace-nowrap"
              >
                <Trash2 className="w-4 h-4" />
                Excluir {selectedIds.size}
              </button>
            )}

            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-3 py-2 bg-slate-900 hover:bg-black text-white rounded-lg text-xs font-bold transition-colors shadow-sm"
            >
              <UserPlus className="w-4 h-4" />
              Manual
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-4 border-b border-slate-200 shrink-0">
        <button
          onClick={() => { setActiveTab('all'); setCurrentPage(1); }}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'all' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          Todos os Contatos
        </button>
        <button
          onClick={() => { setActiveTab('blacklisted'); setCurrentPage(1); }}
          className={`pb-3 justify-center flex gap-1.5 items-center text-sm font-bold border-b-2 transition-colors ${activeTab === 'blacklisted' ? 'border-red-600 text-red-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <ShieldAlert className="w-4 h-4" /> Blacklist {contacts.filter(c => c.blacklisted).length > 0 && `(${contacts.filter(c => c.blacklisted).length})`}
        </button>
      </div>

      <div className="flex bg-white p-2 rounded-lg border border-slate-200 shadow-sm shrink-0">
        <Search className="w-5 h-5 text-slate-400 mx-2 self-center" />
        <input 
          type="text" 
          placeholder="Buscar por nome ou telefone no diretório..." 
          value={searchTerm}
          onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
          className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-2"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-8 text-center text-slate-500 text-sm">Carregando diretório...</div>
          ) : contacts.length === 0 ? (
            <div className="p-16 text-center">
              <Users className="w-12 h-12 mx-auto mb-4 text-slate-300" />
              <h3 className="text-lg font-bold text-slate-700 mb-1">Diretório Vazio</h3>
              <p className="text-sm text-slate-500">Importe contatos através da planilha ou adicione manualmente.</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="px-6 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider w-12">
                    <input type="checkbox" checked={selectedIds.size > 0 && selectedIds.size === paginatedContacts.length} onChange={toggleSelectAll} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  </th>
                  <th className="px-6 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider w-1/3">Nome</th>
                  <th className="px-6 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider w-1/4">Telefone</th>
                  <th className="px-6 py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-wider w-24">Grupos</th>
                  <th className="px-6 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {paginatedContacts.map((c: any) => (
                  <tr key={c._id} className={`hover:bg-slate-50/50 transition-colors ${selectedIds.has(c._id) ? 'bg-indigo-50/30' : ''}`}>
                    <td className="px-6 py-3 whitespace-nowrap">
                      <input type="checkbox" checked={selectedIds.has(c._id)} onChange={() => toggleSelect(c._id)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${c.blacklisted ? 'text-red-700 line-through' : 'text-slate-800'}`}>{c.name || '-'}</span>
                        {c.blacklisted && <span className="text-[9px] uppercase font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Blacklist</span>}
                      </div>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap">
                      <span className={`text-sm font-mono px-2 py-0.5 rounded ${c.blacklisted ? 'bg-red-50 text-red-600 line-through' : 'bg-slate-50/50 text-slate-600'}`}>{formatPhone(c.phone)}</span>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-center">
                      <button 
                        onClick={() => setShowGroupsForContact(c)}
                        className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 hover:text-slate-800 transition-colors"
                        title="Ver grupos"
                      >
                        {c.groups?.length || 0}
                      </button>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleViewHistory(c)}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors border border-transparent hover:border-indigo-200"
                          title="Histórico de Campanhas"
                        >
                          <History className="w-4 h-4"/>
                        </button>
                        <button 
                          onClick={() => handleToggleBlacklist(c._id, !!c.blacklisted)} 
                          className={`p-1.5 rounded-md transition-colors border border-transparent ${c.blacklisted ? 'text-red-500 hover:bg-red-50 hover:border-red-200' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'} `}
                          title={c.blacklisted ? 'Remover da Blacklist' : 'Adicionar à Blacklist'}
                        >
                          {c.blacklisted ? <ShieldAlert className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                        </button>
                        <button onClick={() => { setEditingId(c._id); setEditName(c.name || ''); setEditPhone(c.phone || ''); }} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors border border-transparent hover:border-indigo-200">
                          <Edit2 className="w-4 h-4"/>
                        </button>
                        <button onClick={() => setContactToDelete(c._id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors border border-transparent hover:border-red-200">
                          <Trash2 className="w-4 h-4"/>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {paginatedContacts.length === 0 && !loading && (
                  <tr><td colSpan={5} className="p-8 text-center text-slate-400 font-medium">Nenhum contato encontrado na busca.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">
              Página {currentPage} de {totalPages}
            </span>
            <div className="flex gap-2">
              <button 
                disabled={currentPage === 1} 
                onClick={() => setCurrentPage(prev => prev - 1)}
                className="px-3 py-1.5 text-xs font-bold uppercase bg-white border border-slate-200 rounded text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm"
              >
                Anterior
              </button>
              <button 
                disabled={currentPage === totalPages} 
                onClick={() => setCurrentPage(prev => prev + 1)}
                className="px-3 py-1.5 text-xs font-bold uppercase bg-white border border-slate-200 rounded text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* --- MODAL DO IMPORTADOR DE PLANILHA COM MAPEAMENTO INTELIGENTE --- */}
      <Modal 
        isOpen={showMapModal} 
        onClose={() => { setShowMapModal(false); setRawImportData([]); }} 
        title="Mapeamento de Colunas da Planilha"
        size="lg"
      >
        <div className="space-y-5">
          <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
            <div className="flex gap-3">
              <Table className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-indigo-900">Relacione as colunas da sua planilha</h4>
                <p className="text-xs text-indigo-700 mt-1">
                  Encontramos <span className="font-bold">{rawImportData.length}</span> contatos no seu arquivo.
                  Selecione quais colunas correspondem aos dados de cadastro do sistema.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] uppercase font-black text-slate-400 mb-1.5">Coluna de Telefone (Obrigatório)</label>
              <select 
                value={selectedPhoneCol} 
                onChange={(e) => setSelectedPhoneCol(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
              >
                <option value="">-- Selecione a coluna do telefone --</option>
                {headers.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <p className="text-[10px] text-slate-500 mt-1">Identifica o número do WhatsApp com DDD.</p>
            </div>

            <div>
              <label className="block text-[10px] uppercase font-black text-slate-400 mb-1.5">Coluna de Nome (Opcional)</label>
              <select 
                value={selectedNameCol} 
                onChange={(e) => setSelectedNameCol(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
              >
                <option value="">-- Não importar Nome (Deixar Vazio) --</option>
                {headers.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <p className="text-[10px] text-slate-500 mt-1">Coluna que contém o nome dos contatos.</p>
            </div>
          </div>

          {/* Preview da Importação */}
          {selectedPhoneCol && (
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
              <div className="bg-slate-100/80 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-slate-600 tracking-wider">Preview de Dados (Primeiras 3 linhas)</span>
                <span className="text-[9px] uppercase font-black bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">Mapeado</span>
              </div>
              <div className="p-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead>
                    <tr>
                      <th className="px-3 py-1.5 text-left font-bold text-slate-500">Nome do Contato</th>
                      <th className="px-3 py-1.5 text-left font-bold text-slate-500">WhatsApp</th>
                      <th className="px-3 py-1.5 text-right font-bold text-slate-400">Linha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rawImportData.slice(0, 3).map((item, idx) => {
                      const telRaw = item[selectedPhoneCol] || '';
                      const telClean = telRaw.toString().replace(/\D/g, '');
                      return (
                        <tr key={idx}>
                          <td className="px-3 py-1.5 font-semibold text-slate-700 max-w-[12rem] truncate">
                            {selectedNameCol ? (item[selectedNameCol] || <span className="text-slate-400 italic">Vazio</span>) : <span className="text-slate-400 italic">Ignorado</span>}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-slate-600">
                            {telClean ? formatPhone(telClean) : <span className="text-red-500 italic">Sem número</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right text-[10px] text-slate-400 font-bold">#{idx + 2}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button 
              onClick={() => { setShowMapModal(false); setRawImportData([]); }} 
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs transition-colors"
            >
              Cancelar
            </button>
            <button 
              onClick={handleConfirmMapping}
              disabled={!selectedPhoneCol}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-all flex items-center gap-1.5 shadow-md shadow-indigo-100"
            >
              <Check className="w-4 h-4" />
              Confirmar e Importar
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!contactToDelete} onClose={() => setContactToDelete(null)} title="Excluir Contato Globalmente">
        <div className="mb-6 text-sm text-slate-600">Tem certeza que deseja excluir este contato? Ele será removido do sistema global e de TODOS os grupos que o utilizam.</div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setContactToDelete(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={confirmDeleteContact} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors">
            Excluir
          </button>
        </div>
      </Modal>

      <Modal isOpen={showBulkDeleteConfirm} onClose={() => setShowBulkDeleteConfirm(false)} title="Exclusão em Massa Global">
        <div className="mb-6 text-sm text-slate-600">Tem certeza que deseja excluir os {selectedIds.size} contatos globalmente? Eles serão removidos de todos os grupos.</div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setShowBulkDeleteConfirm(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={confirmBulkDelete} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors">
            Excluir
          </button>
        </div>
      </Modal>

      <Modal isOpen={showBulkRestoreConfirm} onClose={() => setShowBulkRestoreConfirm(false)} title="Remover em Massa da Blacklist">
        <div className="mb-6 text-sm text-slate-600">Tem certeza que deseja remover os {selectedIds.size} contatos selecionados da blacklist? Eles voltarão a receber campanhas.</div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setShowBulkRestoreConfirm(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={confirmBulkRestore} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-colors">
            Confirmar e Restaurar
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!editingId} onClose={() => setEditingId(null)} title="Editar Contato">
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Nome</label>
            <input 
              type="text" 
              value={editName} 
              onChange={e => setEditName(e.target.value)} 
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Telefone / WhatsApp</label>
            <input 
              type="text" 
              inputMode="numeric"
              value={editPhone} 
              onChange={e => setEditPhone(e.target.value.replace(/\D/g, ''))} 
              placeholder="Ex: 5511999999999"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setEditingId(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={handleSaveEdit} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-colors">
            Salvar
          </button>
        </div>
      </Modal>

      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Adicionar Contato">
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Nome (opcional)</label>
            <input 
              type="text" 
              value={manualName} 
              onChange={e => setManualName(e.target.value)} 
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Telefone / WhatsApp</label>
            <input 
              type="text" 
              inputMode="numeric"
              value={manualPhone} 
              onChange={e => setManualPhone(e.target.value.replace(/\D/g, ''))} 
              onKeyDown={e => e.key === 'Enter' ? handleAddManualContact() : null}
              placeholder="Ex: 5511999999999"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setShowAddModal(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={handleAddManualContact} className="px-4 py-2 bg-slate-900 hover:bg-black text-white font-bold rounded-lg transition-colors flex items-center gap-1.5">
            <UserPlus className="w-4 h-4" /> Add
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!showGroupsForContact} onClose={() => setShowGroupsForContact(null)} title={`Grupos de ${showGroupsForContact?.name || showGroupsForContact?.phone || '...'}`}>
        <div className="mb-6 space-y-2 max-h-60 overflow-y-auto pr-1">
          {showGroupsForContact?.groups?.length > 0 ? (
            showGroupsForContact.groups.map((g: any, idx: number) => (
              <div key={idx} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-lg">
                <div className="w-8 h-8 rounded bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                  <List className="w-4 h-4" />
                </div>
                <span className="font-bold text-slate-700 text-sm">{g.name}</span>
              </div>
            ))
          ) : (
            <div className="text-center p-6 bg-slate-50 rounded-lg border border-slate-100">
              <span className="text-slate-500 text-sm">Este contato não está em nenhum grupo.</span>
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <button onClick={() => setShowGroupsForContact(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            Fechar
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!campaignsHistoryFor} onClose={() => setCampaignsHistoryFor(null)} title={`Histórico: ${campaignsHistoryFor?.name || campaignsHistoryFor?.phone || '...'}`}>
        <div className="mb-6 space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {loadingHistory ? (
            <div className="text-center p-6 text-slate-500">Carregando histórico...</div>
          ) : campaignsHistory.length > 0 ? (
            campaignsHistory.map((camp: any, idx: number) => {
              let StatusIcon = PlayCircle;
              let statusColor = 'text-slate-500 bg-slate-50 border-slate-200';
              if (camp.status === 'Enviado') {
                StatusIcon = CheckCircle;
                statusColor = 'text-green-600 bg-green-50 border-green-200';
              } else if (camp.status === 'Erro') {
                StatusIcon = XCircle;
                statusColor = 'text-red-600 bg-red-50 border-red-200';
              } else if (camp.status === 'Bloqueado/Blacklist') {
                StatusIcon = ShieldAlert;
                statusColor = 'text-amber-600 bg-amber-50 border-amber-200';
              }

              return (
                <div key={idx} className={`p-4 border rounded-lg ${statusColor}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <StatusIcon className="w-5 h-5" />
                      <span className="font-bold text-sm">{camp.name}</span>
                    </div>
                    {camp.logAt && <span className="text-xs opacity-70 font-mono">{format(new Date(camp.logAt), 'dd/MM/yyyy HH:mm')}</span>}
                  </div>
                  <div className="flex justify-between items-center text-xs opacity-80">
                    <span className="uppercase tracking-wider font-bold">{camp.status}</span>
                  </div>
                  {camp.logMsg && <div className="mt-2 text-xs font-mono bg-white/50 p-2 rounded truncate" title={camp.logMsg}>{camp.logMsg}</div>}
                </div>
              );
            })
          ) : (
             <div className="text-center p-6 bg-slate-50 rounded-lg border border-slate-100">
               <span className="text-slate-500 text-sm">Nenhum envio registrado para este contato.</span>
             </div>
          )}
        </div>
        <div className="flex justify-end">
          <button onClick={() => setCampaignsHistoryFor(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            Fechar
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!importResult} onClose={() => setImportResult(null)} title="Resultado da Importação">
        {importResult && (
          <>
            <div className="mb-6 space-y-3">
              {importResult.imported > 0 && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                  <p className="text-sm font-bold text-green-800">
                    {importResult.imported} contato(s) importado(s) com sucesso.
                  </p>
                </div>
              )}

              {importResult.skipped > 0 && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-amber-900">
                      {importResult.skipped} contato(s) não importado(s) — limite do plano atingido.
                    </p>
                    <p className="text-sm text-amber-700 mt-1">
                      Seu plano {importResult.planName || ''} permite até {importResult.limit} contatos.
                      Para importar todos,{' '}
                      <Link to="/billing" className="font-bold underline hover:text-amber-900">
                        faça upgrade do seu plano
                      </Link>
                      .
                    </p>
                  </div>
                </div>
              )}

              {importResult.invalid > 0 && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex gap-3">
                  <XCircle className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-slate-600">
                    {importResult.invalid} linha(s) ignorada(s) por telefone em formato inválido (verifique se contêm DDD).
                  </p>
                </div>
              )}

              {importResult.imported === 0 && importResult.skipped === 0 && importResult.invalid === 0 && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="text-sm text-slate-600">Nenhum contato novo para importar (todos já existem no diretório).</p>
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <button onClick={() => setImportResult(null)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-colors">
                Entendido
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal isOpen={showDeleteAllConfirm} onClose={() => setShowDeleteAllConfirm(false)} title="Deletar Todos os Contatos">
        <div className="mb-6 space-y-4">
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
            <Trash2 className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-900">Ação Irreversível</p>
              <p className="text-sm text-red-700 mt-1">Tem certeza que deseja deletar todos os {contacts.length} contatos globalmente? Eles serão removidos de TODOS os grupos e campanhas.</p>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setShowDeleteAllConfirm(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={confirmDeleteAll} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors flex items-center gap-2">
            <Trash2 className="w-4 h-4" />
            Deletar Tudo
          </button>
        </div>
      </Modal>

    </div>
  );
}
