import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import api from './api';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role?: string;
  status?: string;
  emailVerified?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  needsBootstrap: boolean;
  impersonating: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (email: string, password: string, name?: string) => Promise<void>;
  stopImpersonate: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [impersonating, setImpersonating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data: bs } = await api.get('/auth/needs-bootstrap');
      setNeedsBootstrap(!!bs.needsBootstrap);
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      setImpersonating(!!data.impersonating);
    } catch {
      setUser(null);
      setImpersonating(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    setUser(data.user);
    setNeedsBootstrap(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* noop */
    }
    setUser(null);
    await refresh();
  }, [refresh]);

  const signup = useCallback(async (email: string, password: string, name?: string) => {
    const { data } = await api.post('/auth/signup', { email, password, name });
    setUser(data.user);
    setNeedsBootstrap(false);
  }, []);

  const stopImpersonate = useCallback(async () => {
    await api.post('/auth/stop-impersonate');
    await refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, needsBootstrap, impersonating, login, logout, signup, stopImpersonate, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
