import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { verifyEmail } from '../lib/api';

export default function VerificarEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    if (!token) {
      setState('error');
      return;
    }
    verifyEmail(token)
      .then(() => setState('ok'))
      .catch(() => setState('error'));
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        {state === 'loading' && <p className="text-sm text-slate-600">Confirmando seu e-mail...</p>}
        {state === 'ok' && (
          <>
            <h2 className="text-lg font-semibold text-emerald-600">E-mail confirmado! ✅</h2>
            <p className="mt-2 text-sm text-slate-600">Sua conta está ativa.</p>
          </>
        )}
        {state === 'error' && (
          <>
            <h2 className="text-lg font-semibold text-red-600">Link inválido ou expirado</h2>
            <p className="mt-2 text-sm text-slate-600">Entre na sua conta e reenvie a verificação.</p>
          </>
        )}
        <Link to="/" className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Ir para o app
        </Link>
      </div>
    </div>
  );
}
