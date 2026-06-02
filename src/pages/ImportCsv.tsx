import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { previewCsv, commitCsv } from '../lib/api';
import { Modal } from '../components/Modal';

interface PreviewRow {
  name?: string;
  phone: string;
  [k: string]: any;
}

interface ImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  limitReached?: boolean;
  limit?: number;
  planName?: string;
}

export default function ImportCsv() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ sample: PreviewRow[]; total: number; invalid: number } | null>(null);
  const [committing, setCommitting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

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
      const data: ImportResult = await commitCsv(file);
      setImportResult(data);
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
      <h1 className="text-2xl font-bold">Importar contatos</h1>
      <p className="text-sm text-slate-600">
        Aceita <strong>.xlsx</strong> (Excel) e <strong>.csv</strong>. Colunas reconhecidas:{' '}
        <code>name</code>/<code>nome</code> e <code>phone</code>/<code>telefone</code>/
        <code>celular</code>/<code>fone</code>. Linhas com telefone inválido são descartadas.
      </p>

      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <input
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
                {preview.sample.map((r, i) => (
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

      <Modal isOpen={!!importResult} onClose={() => setImportResult(null)} title="Resultado da Importação">
        {importResult && (
          <>
            <div className="mb-6 space-y-3">
              {(importResult.inserted > 0 || importResult.updated > 0) && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                  <p className="text-sm font-bold text-green-800">
                    {importResult.inserted} novo(s) importado(s){importResult.updated > 0 ? `, ${importResult.updated} atualizado(s)` : ''}.
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

              {importResult.inserted === 0 && importResult.updated === 0 && importResult.skipped === 0 && (
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
    </div>
  );
}
