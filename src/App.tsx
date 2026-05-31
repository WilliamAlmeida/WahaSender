import { BrowserRouter as Router, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { Home, Users, Settings as SettingsIcon, MessageSquare, PlayCircle, Menu, X, Clock, Search, LogOut } from 'lucide-react';
import { cn } from './lib/utils';
import { useState, ReactNode } from 'react';
import Settings from './pages/Settings';
import Sessions from './pages/Sessions';
import Groups from './pages/Groups';
import Campaigns from './pages/Campaigns';
import CampaignLogs from './pages/CampaignLogs';
import GroupContacts from './pages/GroupContacts';
import GlobalContacts from './pages/GlobalContacts';
import Dashboard from './pages/Dashboard';
import Queue from './pages/Queue';
import Login from './pages/Login';
import { AuthProvider, useAuth } from './lib/auth';

function Layout({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, logout } = useAuth();

  const navItems = [
    { to: '/', icon: Home, label: 'Dashboard' },
    { to: '/sessions', icon: MessageSquare, label: 'Instâncias WAHA' },
    { to: '/contacts', icon: Search, label: 'Contatos' },
    { to: '/groups', icon: Users, label: 'Grupos' },
    { to: '/campaigns', icon: PlayCircle, label: 'Campanhas em Massa' },
    { to: '/queue', icon: Clock, label: 'Fila de Disparos' },
    { to: '/settings', icon: SettingsIcon, label: 'Configurações' },
  ];

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans overflow-hidden text-slate-900">
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-20 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 bg-white border-r border-slate-200 flex flex-col shadow-sm z-30 transition-transform duration-300 md:static md:translate-x-0 w-64 flex-shrink-0',
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
          <button className="md:hidden text-slate-500 hover:text-slate-800" onClick={() => setMobileMenuOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileMenuOpen(false)}
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
          ))}
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
            v1.0.0
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
        <div className="flex-1 overflow-y-auto p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, needsBootstrap } = useAuth();
  const location = useLocation();
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-sm text-slate-500">Carregando...</div>;
  }
  if (needsBootstrap || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/sessions"
        element={
          <RequireAuth>
            <Sessions />
          </RequireAuth>
        }
      />
      <Route
        path="/contacts"
        element={
          <RequireAuth>
            <GlobalContacts />
          </RequireAuth>
        }
      />
      <Route
        path="/groups"
        element={
          <RequireAuth>
            <Groups />
          </RequireAuth>
        }
      />
      <Route
        path="/groups/:id"
        element={
          <RequireAuth>
            <GroupContacts />
          </RequireAuth>
        }
      />
      <Route
        path="/campaigns"
        element={
          <RequireAuth>
            <Campaigns />
          </RequireAuth>
        }
      />
      <Route
        path="/campaigns/:id/logs"
        element={
          <RequireAuth>
            <CampaignLogs />
          </RequireAuth>
        }
      />
      <Route
        path="/queue"
        element={
          <RequireAuth>
            <Queue />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <Settings />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}
