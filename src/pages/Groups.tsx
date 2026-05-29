import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getGroups, createGroup, deleteGroup } from '../lib/api';
import { Group } from '../types';
import { Upload, Users, Trash2, Eye } from 'lucide-react';
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

  const fetchGroups = async () => {
    try {
      const data = await getGroups();
      setGroups(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchGroups();
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

  const handleAddManualContact = () => {
    if (!manualPhone.trim()) {
      setAlertMsg('Insira pelo menos o telefone.');
      return;
    }
    setContacts(prev => [...prev, { name: manualName.trim(), phone: manualPhone.trim() }]);
    setManualName('');
    setManualPhone('');
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
              <p className="mt-1.5 text-[10px] text-slate-500 italic mb-4">* A planilha precisa ter cabeçalho na primeira linha. Reconhece automático as colunas "nome", "telefone" ou "phone".</p>
              
              <label className="block text-[11px] uppercase font-black text-slate-400 mb-1.5">Ou Adicionar Avulso Manualmente</label>
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
    </div>
  );
}
