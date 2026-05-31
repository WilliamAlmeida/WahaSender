import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import api from './api';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  needsBootstrap: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data: bs } = await api.get('/auth/needs-bootstrap');
      setNeedsBootstrap(!!bs.needsBootstrap);
      if (bs.needsBootstrap) {
        setUser(null);
        return;
      }
      const { data } = await api.get('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
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

  const register = useCallback(async (email: string, password: string, name?: string) => {
    const { data } = await api.post('/auth/register', { email, password, name });
    setUser(data.user);
    setNeedsBootstrap(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, needsBootstrap, login, logout, register, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
