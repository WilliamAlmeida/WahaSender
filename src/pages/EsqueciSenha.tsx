import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../lib/api';

export default function EsqueciSenha() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">Recuperar senha</h2>
        {sent ? (
          <p className="text-sm text-slate-600">
            Se este e-mail estiver cadastrado, enviamos um link para redefinir sua senha. Verifique sua caixa de entrada.
          </p>
        ) : (
          <form onSubmit={onSubmit}>
            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-medium text-slate-600">E-mail</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" autoComplete="email" />
            </label>
            <button type="submit" disabled={submitting} className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {submitting ? 'Enviando...' : 'Enviar link de redefinição'}
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
