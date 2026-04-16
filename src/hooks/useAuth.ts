// ─── useAuth ─────────────────────────────────────────────────────────────────
// Central auth hook. Connects to NexyFlow auth-server via /api/auth/* proxy.
// In Tauri desktop mode, all API calls go to https://nexyfab.com/api/...

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { fetchWithRetry } from '@/lib/fetch-retry';

/** Tauri 데스크톱 여부에 따라 API base URL 반환 */
function apiBase(): string {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    return 'https://nexyfab.com';
  }
  return '';
}

export type UserPlan = 'free' | 'pro' | 'team' | 'enterprise';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  plan: UserPlan;
  projectCount: number;
  emailVerified?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
}

interface AuthActions {
  login: (email: string, password: string) => Promise<boolean>;
  signup: (email: string, password: string, name: string) => Promise<boolean>;
  logout: () => void;
  setUser: (user: AuthUser | null, token: string | null) => void;
  clearError: () => void;
  refreshPlan: () => Promise<void>;
}

type AuthStore = AuthState & AuthActions;

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isLoading: false,
      error: null,

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`${apiBase()}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({ error: 'Login failed' }));
            set({ isLoading: false, error: data.error || data.message || 'Login failed' });
            return false;
          }
          const { user, token } = await res.json();
          set({ user, token, isLoading: false, error: null });
          return true;
        } catch {
          set({ isLoading: false, error: 'Network error. Please try again.' });
          return false;
        }
      },

      signup: async (email, password, name) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`${apiBase()}/api/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({ error: 'Signup failed' }));
            set({ isLoading: false, error: data.error || data.message || 'Signup failed' });
            return false;
          }
          const { user, token } = await res.json();
          set({ user, token, isLoading: false, error: null });
          return true;
        } catch {
          set({ isLoading: false, error: 'Network error. Please try again.' });
          return false;
        }
      },

      logout: () => {
        set({ user: null, token: null, error: null });
        try { localStorage.removeItem('nexyfab-auth'); } catch {}
      },

      setUser: (user, token) => set({ user, token }),
      clearError: () => set({ error: null }),

      refreshPlan: async () => {
        try {
          const res = await fetchWithRetry(`${apiBase()}/api/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({}),
          });
          if (!res.ok) return;
          const data = await res.json();
          if (data.accessToken) {
            // Decode JWT payload to get updated plan
            const parts = data.accessToken.split('.');
            if (parts.length === 3) {
              const payload = JSON.parse(atob(parts[1]));
              set((state) => ({
                token: data.accessToken,
                user: state.user ? { ...state.user, plan: payload.plan ?? state.user.plan } : null,
              }));
            }
          }
        } catch { /* silent fail — will retry on next focus */ }
      },
    }),
    {
      name: 'nexyfab-auth',
      partialize: (s) => ({ user: s.user, token: s.token }),
    },
  ),
);

// Convenience re-export
export const useAuth = () => useAuthStore();
