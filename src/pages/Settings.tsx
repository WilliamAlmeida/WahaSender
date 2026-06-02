import { useState, useEffect } from 'react';
import {
  getSettings,
  saveSettings,
  testWahaConnection,
  updateProfile,
  changePassword,
  exportAccountData,
  deleteAccount,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Save,
  Link as LinkIcon,
  Server,
  User,
  Lock,
  Shield,
  Download,
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../lib/utils';

type Tab = 'account' | 'waha' | 'privacy';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'account', label: 'Minha Conta', icon: User },
  { id: 'waha', label: 'Configuração WAHA', icon: Server },
  { id: 'privacy', label: 'Privacidade', icon: Shield },
];

// ─── Account Tab ─────────────────────────────────────────────────────────────

function AccountTab() {
  const { user, refresh } = useAuth();

  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      await updateProfile({ name: name.trim() || undefined, email: email.trim() || undefined });
      await refresh();
      toast.success('Perfil atualizado!');
    } catch {
      // error handled by axios interceptor
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error('As senhas não coincidem.');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('A nova senha deve ter ao menos 8 caracteres.');
      return;
    }
    setSavingPwd(true);
    try {
      await changePassword(oldPassword, newPassword);
      toast.success('Senha alterada! Faça login novamente.');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      // error handled by axios interceptor
    } finally {
      setSavingPwd(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Profile */}
      <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-5 flex items-center gap-2">
          <User className="w-4 h-4" />
          Informações pessoais
        </h2>
        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-[11px] uppercase font-black text-slate-400 mb-1.5">Nome</label>
            <input
              type="text"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
              placeholder="Seu nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase font-black text-slate-400 mb-1.5">E-mail</label>
            <input
              type="email"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {email !== user?.email && (
              <p className="mt-1.5 text-[10px] text-amber-600 italic">
                Alterar o e-mail exigirá nova verificação.
              </p>
            )}
          </div>
          <div className="pt-2">
            <button
              onClick={handleSaveProfile}
              disabled={savingProfile}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow-lg shadow-indigo-200 transition-all"
            >
              <Save className="w-4 h-4" />
              {savingProfile ? 'Salvando...' : 'Salvar perfil'}
            </button>
          </div>
        </div>
      </section>

      {/* Change password */}
      <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-5 flex items-center gap-2">
          <Lock className="w-4 h-4" />
          Alterar senha
        </h2>
        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-[11px] uppercase font-black text-slate-400 mb-1.5">Senha atual</label>
            <div className="relative">
              <input
                type={showOld ? 'text' : 'password'}
                className="w-full px-3 py-2 pr-10 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                placeholder="••••••••"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowOld((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showOld ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[11px] uppercase font-black text-slate-400 mb-1.5">Nova senha</label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                className="w-full px-3 py-2 pr-10 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                placeholder="Mínimo 8 caracteres"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[11px] uppercase font-black text-slate-400 mb-1.5">Confirmar nova senha</label>
            <input
              type="password"
              className={cn(
                'w-full px-3 py-2 bg-slate-50 border rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500 transition-colors',
                confirmPassword && confirmPassword !== newPassword
                  ? 'border-red-300 bg-red-50'
                  : 'border-slate-200',
              )}
              placeholder="Repita a nova senha"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <div className="pt-2">
            <button
              onClick={handleChangePassword}
              disabled={savingPwd || !oldPassword || !newPassword || !confirmPassword}
              className="flex items-center gap-2 bg-slate-900 hover:bg-black disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-bold transition-all"
            >
              <Lock className="w-4 h-4" />
              {savingPwd ? 'Alterando...' : 'Alterar senha'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── WAHA Tab ─────────────────────────────────────────────────────────────────

function WahaTab() {
  const [wahaUrl, setWahaUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; message: string } | null>(null);

  useEffect(() => {
    getSettings().then((data) => {
      if (data) {
        setWahaUrl(data.wahaUrl);
        setApiKey(data.apiKey);
      }
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings({ wahaUrl, apiKey });
      toast.success('Configurações salvas!');
    } catch {
      // handled by interceptor
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTestResult(null);
    try {
      const data = await testWahaConnection(wahaUrl, apiKey);
      if (data?.message === 'pong' || data?.status === 'ok') {
        setTestResult({ status: 'success', message: 'Conexão estabelecida com sucesso!' });
      } else {
        setTestResult({ status: 'error', message: 'Conexão retornou um formato inesperado.' });
      }
    } catch (e: any) {
      setTestResult({ status: 'error', message: e.response?.data?.message || e.message });
    }
  };

  if (loading) return <div className="text-slate-500 text-sm">Carregando...</div>;

  return (
    <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-5 flex items-center gap-2">
        <Server className="w-4 h-4" />
        Configuração da API WAHA
      </h2>
      <div className="space-y-5 max-w-md">
        <div>
          <label className="block text-[11px] uppercase font-black text-slate-400 mb-1.5">WAHA API URL</label>
          <input
            type="text"
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            placeholder="http://localhost:3000"
            value={wahaUrl}
            onChange={(e) => setWahaUrl(e.target.value)}
          />
          <p className="mt-1.5 text-[10px] text-slate-500 italic">A URL base onde sua API do WAHA está rodando.</p>
        </div>

        <div>
          <label className="block text-[11px] uppercase font-black text-slate-400 mb-1.5">X-Api-Key (Opcional)</label>
          <input
            type="password"
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            placeholder="••••••••••••••••"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-4 mt-2 border-t border-slate-100">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow-lg shadow-indigo-200 transition-all"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
          <button
            onClick={handleTest}
            className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-black text-white px-5 py-2.5 rounded-lg text-sm font-bold transition-all"
          >
            <LinkIcon className="w-4 h-4" />
            Testar Conexão
          </button>
        </div>

        {testResult && (
          <div
            className={cn(
              'p-3 rounded-lg border text-xs font-semibold',
              testResult.status === 'success'
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-red-50 border-red-200 text-red-700',
            )}
          >
            {testResult.message}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Privacy Tab ──────────────────────────────────────────────────────────────

function PrivacyTab() {
  const [exporting, setExporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await exportAccountData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'wahasender-export.json';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Dados exportados!');
    } catch {
      // handled by interceptor
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (deleteConfirm !== 'EXCLUIR') {
      toast.error('Digite EXCLUIR para confirmar.');
      return;
    }
    setDeleting(true);
    try {
      await deleteAccount();
      toast.success('Conta excluída. Até logo!');
      window.location.href = '/login';
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Export */}
      <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
          <Download className="w-4 h-4" />
          Exportar meus dados (LGPD)
        </h2>
        <p className="text-sm text-slate-500 mb-5">
          Baixe um arquivo JSON com todos os seus dados armazenados na plataforma.
        </p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-2 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-bold transition-all"
        >
          <Download className="w-4 h-4" />
          {exporting ? 'Exportando...' : 'Exportar dados'}
        </button>
      </section>

      {/* Delete account */}
      <section className="bg-white p-6 rounded-xl border border-red-200 shadow-sm">
        <h2 className="text-xs font-bold uppercase tracking-wider text-red-500 mb-2 flex items-center gap-2">
          <Trash2 className="w-4 h-4" />
          Excluir minha conta
        </h2>
        <p className="text-sm text-slate-500 mb-5">
          Esta ação é <strong>irreversível</strong>. Todos os seus dados serão anonimizados e você perderá
          acesso à plataforma imediatamente.
        </p>
        <div className="max-w-xs space-y-3">
          <div>
            <label className="block text-[11px] uppercase font-black text-slate-400 mb-1.5">
              Digite <span className="text-red-500">EXCLUIR</span> para confirmar
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm focus:ring-red-400 focus:border-red-400 transition-colors"
              placeholder="EXCLUIR"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
            />
          </div>
          <button
            onClick={handleDelete}
            disabled={deleting || deleteConfirm !== 'EXCLUIR'}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg text-sm font-bold transition-all"
          >
            <Trash2 className="w-4 h-4" />
            {deleting ? 'Excluindo...' : 'Excluir minha conta'}
          </button>
        </div>
      </section>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Settings() {
  const [tab, setTab] = useState<Tab>('account');

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 tracking-tight mb-6">Configurações</h1>

      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg mb-8 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
              tab === id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'account' && <AccountTab />}
      {tab === 'waha' && <WahaTab />}
      {tab === 'privacy' && <PrivacyTab />}
    </div>
  );
}
