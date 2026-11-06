import { can as canRole, type Permission } from '@shared/permissions';
import type { Role } from '@shared/types';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, post, tokenStore } from './api';

export interface Store {
  id: number;
  code: string;
  name: string;
  type: string;
  address?: string;
  city?: string;
  phone?: string;
}

export interface User {
  id: number;
  username: string;
  full_name: string;
  employee_no: string;
  role: Role;
  store_id: number | null;
  store: Store | null;
  permissions: Permission[];
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
  can: (p: Permission) => boolean;
  /** Toko aktif untuk filter backoffice. Null = semua toko (khusus kantor pusat). */
  storeId: number | null;
  setStoreId: (id: number | null) => void;
  stores: Store[];
}

const AuthContext = createContext<AuthState>(null!);
/** Info kasir berikutnya yang ditampilkan di halaman login setelah serah terima shift. */
export const HANDOVER_KEY = 'nusapos.handover';
const STORE_KEY = 'nusapos.store';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.get());
  const [stores, setStores] = useState<Store[]>([]);
  const [hqStoreId, setHqStoreId] = useState<number | null>(() => {
    const v = localStorage.getItem(STORE_KEY);
    return v ? Number(v) : null;
  });

  useEffect(() => {
    if (!tokenStore.get()) return;
    get<User>('/auth/me')
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  useEffect(() => {
    if (user) get<Store[]>('/stores').then(setStores).catch(() => setStores([]));
  }, [user]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await post<{ token: string; user: User }>('/auth/login', { username, password });
    tokenStore.set(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const setStoreId = useCallback((id: number | null) => {
    setHqStoreId(id);
    if (id === null) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, String(id));
  }, []);

  const value: AuthState = {
    user,
    loading,
    login,
    logout,
    can: (p) => canRole(user?.role, p),
    storeId: user?.store_id ?? hqStoreId,
    setStoreId,
    stores,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
