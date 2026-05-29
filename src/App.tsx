import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import { Home, Users, Settings as SettingsIcon, MessageSquare, PlayCircle, Menu, X, Clock, Search } from 'lucide-react';
import { cn } from './lib/utils';
import { useState } from 'react';
import Settings from './pages/Settings';
import Sessions from './pages/Sessions';
import Groups from './pages/Groups';
import Campaigns from './pages/Campaigns';
import CampaignLogs from './pages/CampaignLogs';
import GroupContacts from './pages/GroupContacts';
import GlobalContacts from './pages/GlobalContacts';

import Dashboard from './pages/Dashboard';
import Queue from './pages/Queue';

function Layout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-20 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={cn(
          "fixed inset-y-0 left-0 bg-white border-r border-slate-200 flex flex-col shadow-sm z-30 transition-transform duration-300 md:static md:translate-x-0 w-64 flex-shrink-0",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-bold text-xl italic">W</div>
            <h1 className="text-lg font-bold tracking-tight text-slate-800">Waha<span className="text-indigo-600">Sender</span></h1>
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
                  "flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-slate-100 text-indigo-700" 
                    : "text-slate-600 hover:bg-slate-50"
                )
              }
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-100 text-[10px] text-center text-slate-400 font-bold uppercase tracking-widest">
          v1.0.0
        </div>
      </aside>
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center shrink-0 md:hidden">
          <button className="p-2 text-slate-600 hover:bg-slate-50 rounded-md" onClick={() => setMobileMenuOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="ml-auto w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-bold text-xl italic">W</div>
        </header>
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/contacts" element={<GlobalContacts />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/groups/:id" element={<GroupContacts />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/:id/logs" element={<CampaignLogs />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </Router>
  );
}
