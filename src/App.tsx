import { BrowserRouter as Router, Routes, Route, NavLink, Navigate, useLocation, useMatch } from 'react-router-dom';
import {
  Home,
  Users,
  Settings as SettingsIcon,
  MessageSquare,
  PlayCircle,
  Menu,
  X,
  Clock,
  Search,
  LogOut,
  FileText,
  Key,
  Webhook,
  Upload,
  CreditCard,
  ShieldCheck,
  ChevronDown,
  Server,
  Plug,
  UserCircle,
  ListTodo,
} from 'lucide-react';
import { cn } from './lib/utils';
import { useState, ReactNode, lazy, Suspense } from 'react';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './lib/auth';
import { resendVerification } from './lib/api';
import toast from 'react-hot-toast';
import Login from './pages/Login';
import Register from './pages/Register';
import Landing from './pages/Landing';
import EsqueciSenha from './pages/EsqueciSenha';
import RedefinirSenha from './pages/RedefinirSenha';
import VerificarEmail from './pages/VerificarEmail';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Settings = lazy(() => import('./pages/Settings'));
const Sessions = lazy(() => import('./pages/Sessions'));
const Groups = lazy(() => import('./pages/Groups'));
const Campaigns = lazy(() => import('./pages/Campaigns'));
const CampaignLogs = lazy(() => import('./pages/CampaignLogs'));
const GroupContacts = lazy(() => import('./pages/GroupContacts'));
const GlobalContacts = lazy(() => import('./pages/GlobalContacts'));
const Queue = lazy(() => import('./pages/Queue'));
const Templates = lazy(() => import('./pages/Templates'));
const ApiTokens = lazy(() => import('./pages/ApiTokens'));
const OutboundWebhooks = lazy(() => import('./pages/OutboundWebhooks'));
const ImportCsv = lazy(() => import('./pages/ImportCsv'));
const Billing = lazy(() => import('./pages/Billing'));
const Admin = lazy(() => import('./pages/Admin'));

type NavItem = {
  to: string;
  icon: React.ElementType;
  label: string;
  end?: boolean;
};

type NavGroup = {
  key: string;
  icon: React.ElementType;
  label: string;
  paths: string[];
  items: NavItem[];
};

type NavEntry = { type: 'item'; item: NavItem } | { type: 'group'; group: NavGroup };

function useIsGroupActive(paths: string[]): boolean {
  const location = useLocation();
  return paths.some((p) => location.pathname === p || location.pathname.startsWith(p + '/'));
}

function SidebarGroup({
  group,
  onClose,
}: {
  group: NavGroup;
  onClose: () => void;
}) {
  const isActive = useIsGroupActive(group.paths);
  const [open, setOpen] = useState(isActive);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors',
          isActive ? 'text-indigo-700' : 'text-slate-600 hover:bg-slate-50',
        )}
      >
        <group.icon className="w-5 h-5 shrink-0" />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown
          className={cn('w-4 h-4 shrink-0 transition-transform duration-200', open ? 'rotate-180' : '')}
        />
      </button>
      {open && (
        <div className="ml-4 mt-0.5 border-l border-slate-100 pl-3 space-y-0.5">
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive ? 'bg-slate-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
                )
              }
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function VerifyBanner() {
  const { user, refresh } = useAuth();
  if (!user || user.emailVerified !== false) return null;
  const onResend = async () => {
    await resendVerification();
    toast.success('E-mail de verificação reenviado');
    await refresh();
  };
  return (
    <div className="flex items-center gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-800">
      <span>Confirme seu e-mail para garantir acesso completo.</span>
      <button onClick={onResend} className="font-semibold underline">Reenviar</button>
    </div>
  );
}

function Layout({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, logout } = useAuth();
  const closeMobile = () => setMobileMenuOpen(false);

  const navEntries: NavEntry[] = [
    {
      type: 'item',
      item: { to: '/', icon: Home, label: 'Dashboard', end: true },
    },
    {
      type: 'item',
      item: { to: '/sessions', icon: Server, label: 'Instâncias WAHA' },
    },
    {
      type: 'group',
      group: {
        key: 'contacts',
        icon: Users,
        label: 'Contatos',
        paths: ['/contacts', '/groups'],
        items: [
          { to: '/contacts', icon: Search, label: 'Contatos Globais' },
          { to: '/contacts/import', icon: Upload, label: 'Importar CSV' },
          { to: '/groups', icon: Users, label: 'Grupos' },
        ],
      },
    },
    {
      type: 'group',
      group: {
        key: 'campaigns',
        icon: PlayCircle,
        label: 'Campanhas',
        paths: ['/templates', '/campaigns', '/queue'],
        items: [
          { to: '/templates', icon: FileText, label: 'Templates' },
          { to: '/campaigns', icon: PlayCircle, label: 'Campanhas em Massa' },
          { to: '/queue', icon: Clock, label: 'Fila de Disparos' },
        ],
      },
    },
    {
      type: 'group',
      group: {
        key: 'integrations',
        icon: Plug,
        label: 'Integrações',
        paths: ['/api-tokens', '/webhooks'],
        items: [
          { to: '/api-tokens', icon: Key, label: 'API Tokens' },
          { to: '/webhooks', icon: Webhook, label: 'Webhooks Outbound' },
        ],
      },
    },
    {
      type: 'group',
      group: {
        key: 'account',
        icon: UserCircle,
        label: 'Conta',
        paths: ['/billing', '/settings'],
        items: [
          { to: '/billing', icon: CreditCard, label: 'Plano e Cobrança' },
          { to: '/settings', icon: SettingsIcon, label: 'Configurações' },
        ],
      },
    },
    ...(user?.role === 'admin'
      ? [
          {
            type: 'item' as const,
            item: { to: '/admin', icon: ShieldCheck, label: 'Administração' },
          },
        ]
      : []),
  ];

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans overflow-hidden text-slate-900">
      {mobileMenuOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-20 md:hidden" onClick={closeMobile} />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 bg-white border-r border-slate-200 flex flex-col shadow-sm z-30 transition-transform duration-300 md:static md:translate-x-0 w-64 shrink-0',
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-bold text-xl italic">W</div>
            <h1 className="text-lg font-bold tracking-tight text-slate-800">
              Waha<span className="text-indigo-600">Sender</span>
            </h1>
          </div>
          <button className="md:hidden text-slate-500 hover:text-slate-800" onClick={closeMobile}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
          {navEntries.map((entry, i) => {
            if (entry.type === 'item') {
              const item = entry.item;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={closeMobile}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors',
                      isActive ? 'bg-slate-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-50',
                    )
                  }
                >
                  <item.icon className="w-5 h-5" />
                  {item.label}
                </NavLink>
              );
            }
            return <SidebarGroup key={entry.group.key} group={entry.group} onClose={closeMobile} />;
          })}
        </nav>

        <div className="border-t border-slate-100 p-3">
          {user && (
            <div className="mb-2 px-2 text-xs text-slate-500">
              <div className="truncate font-medium text-slate-700">{user.name || user.email}</div>
              <div className="truncate">{user.email}</div>
            </div>
          )}
          <button
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
          <div className="pt-2 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
            v3.0.0
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center shrink-0 md:hidden">
          <button className="p-2 text-slate-600 hover:bg-slate-50 rounded-md" onClick={() => setMobileMenuOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="ml-auto w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-bold text-xl italic">W</div>
        </header>
        <VerifyBanner />
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <Suspense fallback={<div className="text-sm text-slate-500">Carregando...</div>}>
            {children}
          </Suspense>
        </div>
      </main>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-sm text-slate-500">Carregando...</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Layout>{children}</Layout>;
}

function RootRoute() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-sm text-slate-500">Carregando...</div>;
  }
  if (!user) return <Landing />;
  return (
    <Layout>
      <Suspense fallback={<div className="text-sm text-slate-500">Carregando...</div>}>
        <Dashboard />
      </Suspense>
    </Layout>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/cadastro" element={<Register />} />
      <Route path="/esqueci-senha" element={<EsqueciSenha />} />
      <Route path="/redefinir-senha" element={<RedefinirSenha />} />
      <Route path="/verificar-email" element={<VerificarEmail />} />
      <Route path="/" element={<RootRoute />} />
      <Route path="/sessions" element={<RequireAuth><Sessions /></RequireAuth>} />
      <Route path="/contacts" element={<RequireAuth><GlobalContacts /></RequireAuth>} />
      <Route path="/contacts/import" element={<RequireAuth><ImportCsv /></RequireAuth>} />
      <Route path="/groups" element={<RequireAuth><Groups /></RequireAuth>} />
      <Route path="/groups/:id" element={<RequireAuth><GroupContacts /></RequireAuth>} />
      <Route path="/templates" element={<RequireAuth><Templates /></RequireAuth>} />
      <Route path="/campaigns" element={<RequireAuth><Campaigns /></RequireAuth>} />
      <Route path="/campaigns/:id/logs" element={<RequireAuth><CampaignLogs /></RequireAuth>} />
      <Route path="/queue" element={<RequireAuth><Queue /></RequireAuth>} />
      <Route path="/api-tokens" element={<RequireAuth><ApiTokens /></RequireAuth>} />
      <Route path="/webhooks" element={<RequireAuth><OutboundWebhooks /></RequireAuth>} />
      <Route path="/billing" element={<RequireAuth><Billing /></RequireAuth>} />
      <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
    </Routes>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}
