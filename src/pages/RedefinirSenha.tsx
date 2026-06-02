import { FormEvent, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { resetPassword } from '../lib/api';

export default function RedefinirSenha() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      toast.success('Senha redefinida! Faça login.');
      navigate('/login');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Não foi possível redefinir a senha');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">Definir nova senha</h2>
        {!token ? (
          <p className="text-sm text-red-600">Link inválido. Solicite um novo em "Esqueci minha senha".</p>
        ) : (
          <form onSubmit={onSubmit}>
            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Nova senha</span>
              <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" autoComplete="new-password" />
            </label>
            {error && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
            <button type="submit" disabled={submitting} className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {submitting ? 'Salvando...' : 'Redefinir senha'}
            </button>
          </form>
        )}
        <p className="mt-4 text-center text-xs text-slate-500">
          <Link to="/login" className="text-indigo-600 hover:underline">Voltar ao login</Link>
        </p>
      </div>
    </div>
  );
}
