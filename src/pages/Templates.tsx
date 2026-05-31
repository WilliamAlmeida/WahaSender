import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Edit2 } from 'lucide-react';
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from '../lib/api';

interface Template {
  id: string;
  name: string;
  content: string;
  variables?: string[];
  createdAt?: string;
}

export default function Templates() {
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Template | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');

  async function reload() {
    setLoading(true);
    try {
      setItems(await listTemplates());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;
    try {
      if (editing) {
        await updateTemplate(editing.id, { name, content });
        toast.success('Template atualizado');
      } else {
        await createTemplate({ name, content });
        toast.success('Template criado');
      }
      setName('');
      setContent('');
      setEditing(null);
      await reload();
    } catch {
      /* toast já feito pelo interceptor */
    }
  }

  async function remove(id: string) {
    if (!confirm('Excluir este template?')) return;
    await deleteTemplate(id);
    toast.success('Template removido');
    await reload();
  }

  function startEdit(t: Template) {
    setEditing(t);
    setName(t.name);
    setContent(t.content);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Templates</h1>

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <input
          className="w-full border border-slate-300 rounded px-3 py-2"
          placeholder="Nome do template"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <textarea
          className="w-full border border-slate-300 rounded px-3 py-2 font-mono text-sm"
          rows={4}
          placeholder="Conteúdo. Use {name}, {phone}, {id} ou spintax {olá|oi}."
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="submit"
            className="inline-flex items-center gap-2 bg-indigo-600 text-white rounded px-4 py-2 text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> {editing ? 'Salvar' : 'Adicionar'}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setName('');
                setContent('');
              }}
              className="text-sm text-slate-600"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="bg-white border border-slate-200 rounded-lg divide-y">
        {loading && <div className="p-4 text-sm text-slate-500">Carregando...</div>}
        {!loading && items.length === 0 && (
          <div className="p-4 text-sm text-slate-500">Nenhum template cadastrado.</div>
        )}
        {items.map((t) => (
          <div key={t.id} className="p-4 flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{t.name}</div>
              <div className="text-xs text-slate-500 mt-1 whitespace-pre-wrap font-mono">{t.content}</div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => startEdit(t)}
                className="p-2 text-slate-500 hover:text-indigo-600"
                title="Editar"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => remove(t.id)}
                className="p-2 text-slate-500 hover:text-red-600"
                title="Excluir"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
