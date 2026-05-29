import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getGroup, updateGroup } from '../lib/api';
import { ArrowLeft, Search, Trash2, Edit2, Check, X, UserPlus } from 'lucide-react';
import { Modal } from '../components/Modal';

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

export default function GroupContacts() {
  const { id } = useParams<{ id: string }>();
  const [group, setGroup] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;
  
  // Group name editing
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [editGroupNameValue, setEditGroupNameValue] = useState('');

  const handleSaveGroupName = async () => {
    if (!editGroupNameValue.trim() || editGroupNameValue.trim() === group.name) {
      setEditingGroupName(false);
      return;
    }
    const newName = editGroupNameValue.trim();
    setGroup({ ...group, name: newName });
    setEditingGroupName(false);
    await updateGroup(id!, { name: newName });
  };

  // Editing single contact
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');

  // Bulk deletion
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Alerts and Modals
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [contactToDelete, setContactToDelete] = useState<string | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // Manual Contact Add
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const fetchGroup = async () => {
    try {
      const g = await getGroup(id!);
      setGroup(g);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchGroup();
  }, [id]);

  if (loading) return <div className="p-8 text-slate-500">Carregando contatos...</div>;
  if (!group) return <div className="p-8 text-red-500">Grupo não encontrado.</div>;

  const filteredContacts = group.contacts.filter((c: any) => 
    (c.name?.toLowerCase().includes(searchTerm.toLowerCase())) || 
    (c.phone?.toString().includes(searchTerm)) ||
    (c.telefone?.toString().includes(searchTerm))
  );

  const totalPages = Math.ceil(filteredContacts.length / itemsPerPage);
  const paginatedContacts = filteredContacts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const p = editPhone.replace(/\D/g, '');
    if (p.length < 10 || p.length > 15) {
      setAlertMsg('Telefone inválido. Insira apenas números, com DDD. Ex: 5511999999999');
      return;
    }
    const updatedContacts = group.contacts.map((c: any) => {
      if (c._id === editingId) {
        return { ...c, name: editName, phone: p };
      }
      return c;
    });
    setGroup({ ...group, contacts: updatedContacts });
    setEditingId(null);
    await updateGroup(id!, { contacts: updatedContacts });
  };

  const handleAddManualContact = async () => {
    const p = manualPhone.replace(/\D/g, '');
    if (p.length < 10 || p.length > 15) {
      setAlertMsg('Telefone inválido. Insira apenas números, com DDD. Ex: 5511999999999');
      return;
    }
    const newContact = { 
      _id: Date.now().toString() + Math.random().toString(36).substr(2, 9), 
      name: manualName.trim(), 
      phone: p 
    };
    const updatedContacts = [...group.contacts, newContact];
    setGroup({ ...group, contacts: updatedContacts });
    await updateGroup(id!, { contacts: updatedContacts });
    setManualName('');
    setManualPhone('');
    setShowAddModal(false);
    setAlertMsg('Contato adicionado com sucesso!');
  };

  const confirmDeleteContact = async () => {
    if (!contactToDelete) return;
    const updatedContacts = group.contacts.filter((c: any) => c._id !== contactToDelete);
    setGroup({ ...group, contacts: updatedContacts });
    setContactToDelete(null);
    await updateGroup(id!, { contacts: updatedContacts });
  };

  const confirmBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const updatedContacts = group.contacts.filter((c: any) => !selectedIds.has(c._id));
    setGroup({ ...group, contacts: updatedContacts });
    setSelectedIds(new Set());
    setShowBulkDeleteConfirm(false);
    await updateGroup(id!, { contacts: updatedContacts });
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
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <Link to="/groups" className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            {editingGroupName ? (
              <div className="flex items-center gap-2 mb-1">
                <input 
                  type="text" 
                  value={editGroupNameValue} 
                  onChange={e => setEditGroupNameValue(e.target.value)} 
                  onKeyDown={e => e.key === 'Enter' ? handleSaveGroupName() : null}
                  className="text-xl font-bold text-slate-800 bg-white border border-slate-300 rounded px-2 py-1 focus:ring-indigo-500 focus:border-indigo-500"
                  autoFocus
                />
                <button onClick={() => setEditingGroupName(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded bg-slate-50 border border-slate-200">
                  <X className="w-4 h-4" />
                </button>
                <button onClick={handleSaveGroupName} className="p-1 text-white hover:bg-green-600 rounded bg-green-500 shadow-sm border border-transparent">
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-bold text-slate-800 tracking-tight">{group.name}</h1>
                <button onClick={() => { setEditingGroupName(true); setEditGroupNameValue(group.name); }} className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{group.contacts.length} contatos</p>
          </div>
        </div>
        {selectedIds.size > 0 && (
          <button 
            onClick={() => setShowBulkDeleteConfirm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-sm font-bold border border-red-200 transition-colors shadow-sm"
          >
            <Trash2 className="w-4 h-4" />
            Excluir Selecionados ({selectedIds.size})
          </button>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-4 shrink-0">
        <div className="flex-1 flex items-center gap-4 bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
          <Search className="w-5 h-5 text-slate-400 ml-2" />
          <input 
            type="text" 
            placeholder="Buscar por nome ou telefone..." 
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-2"
          />
        </div>
        <button 
          onClick={() => { setManualName(''); setManualPhone(''); setShowAddModal(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white font-bold rounded-lg hover:bg-black transition-colors min-w-max shadow-sm"
        >
          <UserPlus className="w-4 h-4" />
          Add Contato
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr>
                <th className="px-6 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider w-12">
                  <input type="checkbox" checked={selectedIds.size > 0 && selectedIds.size === paginatedContacts.length} onChange={toggleSelectAll} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                </th>
                <th className="px-6 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider w-1/3">Nome</th>
                <th className="px-6 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider w-1/3">Telefone</th>
                <th className="px-6 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {paginatedContacts.map((c: any, index: number) => (
                <tr key={c._id || index} className={`hover:bg-slate-50/50 transition-colors ${selectedIds.has(c._id) ? 'bg-indigo-50/30' : ''}`}>
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
                    <span className={`text-sm font-mono px-2 py-0.5 rounded ${c.blacklisted ? 'bg-red-50 text-red-600 line-through' : 'bg-slate-50/50 text-slate-600'}`}>{formatPhone(c.phone || c.telefone)}</span>
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setEditingId(c._id); setEditName(c.name || ''); setEditPhone(c.phone || c.telefone || ''); }} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors border border-transparent hover:border-indigo-200">
                        <Edit2 className="w-4 h-4"/>
                      </button>
                      <button onClick={() => setContactToDelete(c._id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors border border-transparent hover:border-red-200">
                        <Trash2 className="w-4 h-4"/>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {paginatedContacts.length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-slate-400 font-medium">Nenhum contato encontrado.</td></tr>
              )}
            </tbody>
          </table>
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

      <Modal isOpen={!!alertMsg} onClose={() => setAlertMsg(null)} title="Aviso">
        <div className="mb-6 text-sm text-slate-600">{alertMsg}</div>
        <div className="flex justify-end">
          <button onClick={() => setAlertMsg(null)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-colors">
            Entendido
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!contactToDelete} onClose={() => setContactToDelete(null)} title="Excluir Contato">
        <div className="mb-6 text-sm text-slate-600">Tem certeza que deseja excluir este contato?</div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setContactToDelete(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={confirmDeleteContact} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors">
            Excluir
          </button>
        </div>
      </Modal>

      <Modal isOpen={showBulkDeleteConfirm} onClose={() => setShowBulkDeleteConfirm(false)} title="Exclusão em Massa">
        <div className="mb-6 text-sm text-slate-600">Tem certeza que deseja excluir os {selectedIds.size} contatos selecionados?</div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setShowBulkDeleteConfirm(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={confirmBulkDelete} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors">
            Excluir
          </button>
        </div>
      </Modal>

      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Adicionar Contato Manual">
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
              placeholder="Ex: 551199999999"
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

      <Modal isOpen={!!editingId} onClose={() => setEditingId(null)} title="Editar Contato no Grupo">
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
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Telefone</label>
            <input 
              type="text" 
              inputMode="numeric"
              value={editPhone} 
              onChange={e => setEditPhone(e.target.value.replace(/\D/g, ''))} 
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
    </div>
  );
}
