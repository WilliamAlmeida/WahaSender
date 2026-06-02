import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, MessageSquare, Zap, ShieldCheck, BarChart3 } from 'lucide-react';
import { getPublicPlans } from '../lib/api';

interface Plan {
  id: string;
  slug: string;
  name: string;
  priceCents: number;
  features: string[];
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function Landing() {
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    getPublicPlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-indigo-600 text-xl font-bold italic text-white">W</div>
          <span className="text-lg font-bold">Waha<span className="text-indigo-600">Sender</span></span>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link to="/login" className="px-3 py-2 text-slate-600 hover:text-slate-900">Entrar</Link>
          <Link to="/cadastro" className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700">Começar grátis</Link>
        </nav>
      </header>

      <section className="px-6 py-20 text-center max-w-3xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
          Disparos de WhatsApp em massa, <span className="text-indigo-600">de verdade humanizados</span>
        </h1>
        <p className="mt-6 text-lg text-slate-600">
          Campanhas com spintax, intervalos humanizados, janelas de envio e múltiplas instâncias.
          Comece grátis e pague conforme cresce.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/cadastro" className="rounded-md bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700">Criar conta grátis</Link>
          <a href="#planos" className="rounded-md border border-slate-300 px-6 py-3 font-medium text-slate-700 hover:bg-slate-50">Ver planos</a>
        </div>
      </section>

      <section className="px-6 py-12 max-w-5xl mx-auto grid gap-6 md:grid-cols-4 text-center">
        {[
          { icon: MessageSquare, t: 'Multi-instância', d: 'Balanceamento entre várias sessões WAHA.' },
          { icon: Zap, t: 'Humanizado', d: 'Spintax, placeholders e delays naturais.' },
          { icon: ShieldCheck, t: 'Seguro', d: 'Isolamento por conta, tokens de API e webhooks.' },
          { icon: BarChart3, t: 'Observável', d: 'Logs, status de entrega e métricas.' },
        ].map((f) => (
          <div key={f.t} className="rounded-lg border border-slate-200 p-5">
            <f.icon className="mx-auto h-7 w-7 text-indigo-600" />
            <h3 className="mt-3 font-semibold">{f.t}</h3>
            <p className="mt-1 text-sm text-slate-500">{f.d}</p>
          </div>
        ))}
      </section>

      <section id="planos" className="px-6 py-16 max-w-6xl mx-auto">
        <h2 className="text-center text-3xl font-bold">Planos simples e transparentes</h2>
        <p className="mt-2 text-center text-slate-600">Sem fidelidade. Faça upgrade ou cancele quando quiser.</p>
        <div className="mt-10 grid gap-6 md:grid-cols-4">
          {plans.map((p) => (
            <div key={p.id} className={`rounded-xl border p-6 ${p.slug === 'pro' ? 'border-indigo-500 shadow-lg' : 'border-slate-200'}`}>
              {p.slug === 'pro' && <div className="mb-2 inline-block rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">Mais popular</div>}
              <h3 className="text-lg font-bold">{p.name}</h3>
              <div className="mt-2 text-3xl font-extrabold">
                {p.priceCents === 0 ? 'Grátis' : brl(p.priceCents)}
                {p.priceCents > 0 && <span className="text-base font-medium text-slate-500">/mês</span>}
              </div>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                {p.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {f}
                  </li>
                ))}
              </ul>
              <Link to="/cadastro" className="mt-6 block rounded-md bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-indigo-700">
                Assinar
              </Link>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-slate-100 px-6 py-8 text-center text-sm text-slate-400">
        © {new Date().getFullYear()} WahaSender — feito no Brasil 🇧🇷
      </footer>
    </div>
  );
}
