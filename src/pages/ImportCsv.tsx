import { useState } from 'react';
import toast from 'react-hot-toast';
import { Upload } from 'lucide-react';
import { previewCsv, commitCsv } from '../lib/api';

interface PreviewRow {
  name?: string;
  phone: string;
  [k: string]: any;
}

export default function ImportCsv() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; total: number; invalid: number } | null>(
    null,
  );
  const [committing, setCommitting] = useState(false);

  async function onPreview() {
    if (!file) return;
    try {
      const data = await previewCsv(file);
      setPreview(data);
    } catch {
      /* */
    }
  }

  async function onCommit() {
    if (!file) return;
    setCommitting(true);
    try {
      const data = await commitCsv(file);
      toast.success(`Importado: ${data.inserted} novos, ${data.updated} atualizados`);
      setFile(null);
      setPreview(null);
    } catch {
      /* */
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Importar contatos CSV</h1>
      <p className="text-sm text-slate-600">
        Cabeçalhos aceitos: <code>name</code>/<code>nome</code> e <code>phone</code>/<code>telefone</code>/
        <code>celular</code>. Linhas com telefone inválido são descartadas.
      </p>

      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setPreview(null);
          }}
        />
        <div className="flex gap-2">
          <button
            onClick={onPreview}
            disabled={!file}
            className="inline-flex items-center gap-2 bg-slate-700 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            Pré-visualizar
          </button>
          <button
            onClick={onCommit}
            disabled={!preview || committing}
            className="inline-flex items-center gap-2 bg-indigo-600 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            <Upload className="w-4 h-4" /> {committing ? 'Importando...' : 'Importar'}
          </button>
        </div>
      </div>

      {preview && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-sm text-slate-600 mb-3">
            Total válido: <strong>{preview.total}</strong> · Inválidos: <strong>{preview.invalid}</strong>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Nome</th>
                  <th className="px-3 py-2 text-left">Telefone</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2">{r.name || '—'}</td>
                    <td className="px-3 py-2 font-mono">{r.phone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
