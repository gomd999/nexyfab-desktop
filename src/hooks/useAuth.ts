// ─── useAuth ─────────────────────────────────────────────────────────────────
// Central auth hook. Connects to NexyFlow auth-server via /api/auth/* proxy.
// In Tauri desktop mode, all API calls go to https://nexyfab.com/api/...

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { fetchWithRetry } from '@/lib/fetch-retry';
import { parseUserStageColumn, type Stage } from '@/lib/userStage';

/** Tauri 데스크톱 여부에 따라 API base URL 반환 */
function apiBase(): string {
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
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
  role?: string; // e.g. 'admin' | 'super_admin' | 'user'
  /** NexyFab BM Stage (nf_users.stage). 클라이언트 게이트용. */
  nexyfabStage?: Stage;
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
  logout: () => Promise<void>;
  setUser: (user: AuthUser | null, token: string | null) => void;
  clearError: () => void;
  refreshPlan: () => Promise<void>;
}

type AuthStore = AuthState & AuthActions;

/**
 * 탭 간 로그아웃 전파 (260802).
 *
 * ⚠ zustand `persist` 는 **읽기 시점에만** localStorage 를 본다. 다른 탭이 이미 떠 있으면
 *   메모리 상태를 그대로 유지하므로, 한 탭에서 로그아웃해도 **다른 탭은 로그인으로 보인다.**
 *   실제로 보고된 증상이 이것이다.
 *
 * BroadcastChannel 이 없는 환경(구형 Safari 등)을 위해 `storage` 이벤트로 폴백한다 —
 * 같은 키에 값을 썼다 지우면 다른 탭에서 이벤트가 뜬다.
 */
const LOGOUT_CHANNEL = 'nexyfab-auth-logout';

function broadcastLogout(): void {
  if (typeof window === 'undefined') return;
  try {
    if ('BroadcastChannel' in window) {
      const ch = new BroadcastChannel(LOGOUT_CHANNEL);
      ch.postMessage({ type: 'logout', at: Date.now() });
      ch.close();
      return;
    }
  } catch { /* 폴백으로 내려간다 */ }
  try {
    // storage 이벤트는 **다른 탭에서만** 발생한다 — 자기 탭은 이미 정리했다.
    localStorage.setItem(LOGOUT_CHANNEL, String(Date.now()));
    localStorage.removeItem(LOGOUT_CHANNEL);
  } catch { /* 저장소가 막힌 환경 — 전파는 포기하되 이 탭은 정상 로그아웃 */ }
}

/** 다른 탭의 로그아웃 신호를 받아 이 탭도 비운다. */
function subscribeLogout(clear: () => void): void {
  if (typeof window === 'undefined') return;
  try {
    if ('BroadcastChannel' in window) {
      const ch = new BroadcastChannel(LOGOUT_CHANNEL);
      ch.onmessage = (e) => { if ((e.data as { type?: string })?.type === 'logout') clear(); };
    }
  } catch { /* 아래 storage 폴백만 남는다 */ }
  window.addEventListener('storage', (e) => {
    // 다른 탭이 신호를 썼거나, 저장된 세션 자체가 지워졌을 때.
    if (e.key === LOGOUT_CHANNEL || (e.key === 'nexyfab-auth' && e.newValue == null)) clear();
  });
}

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
          // Pull first-touch UTM record (if any) so the signup_complete
          // funnel event can be attributed to the originating ad/campaign.
          // Lazy import keeps this out of the critical path when no UTM exists.
          let utm: Record<string, unknown> | undefined;
          try {
            const mod = await import('@/lib/utm-tracker');
            const rec = mod.getUtm();
            if (rec) utm = rec as Record<string, unknown>;
          } catch { /* ignore — UTM is opportunistic */ }
          const res = await fetch(`${apiBase()}/api/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name, utm }),
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

      /**
       * 로그아웃 — **세 층을 다 끊는다** (260802 전면 수정).
       *
       * ## 종전에 무엇이 안 됐나
       * 이 함수는 **zustand 상태와 localStorage 만** 지웠다. 서버(`/api/auth/logout`)를
       * **호출조차 하지 않아** httpOnly 쿠키(`nf_access_token`·`nf_refresh_token`)가
       * 그대로 남았다 — 화면만 로그아웃되고 **새로고침하면 다시 로그인 상태**였고,
       * 30일짜리 리프레시 토큰도 살아 있었다.
       *
       * 그리고 다른 탭은 **자기 메모리 상태를 그대로** 들고 있어 계속 로그인으로 보였다.
       *
       * ## 지금 하는 일
       *  ① 서버 호출 — 쿠키 삭제 + 리프레시 토큰 폐기 (실패해도 ②③은 진행한다)
       *  ② 이 탭의 상태·localStorage 정리
       *  ③ **다른 탭에 알린다** — BroadcastChannel, 없으면 storage 이벤트로 폴백
       *
       * ⚠ 서버 실패를 이유로 로컬 정리를 건너뛰지 않는다. 「끊지 못했다」와
       *   「아무것도 안 한다」는 다르다 — 후자면 사용자는 로그아웃했다고 믿는다.
       */
      logout: async () => {
        try {
          await fetch(`${apiBase()}/api/auth/logout`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            // ⚠ 빈 본문이면 서버가 `req.json()` 에서 던졌다(종전 500 의 원인).
            body: '{}',
          });
        } catch (err) {
          console.error('[useAuth] 서버 로그아웃 실패 — 로컬 정리는 계속한다', err);
        }
        set({ user: null, token: null, error: null });
        try { localStorage.removeItem('nexyfab-auth'); } catch (err) { console.error('[useAuth] caught', err); }
        broadcastLogout();
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
          const data = await res.json() as {
            accessToken?: string;
            plan?: UserPlan;
            nexyfabStage?: Stage;
          };
          if (data.accessToken) {
            const parts = data.accessToken.split('.');
            if (parts.length === 3) {
              const payload = JSON.parse(atob(parts[1])) as { plan?: UserPlan; nexyfabStage?: string };
              set((state) => ({
                token: data.accessToken,
                user: state.user
                  ? {
                      ...state.user,
                      plan: data.plan ?? payload.plan ?? state.user.plan,
                      nexyfabStage: parseUserStageColumn(
                        data.nexyfabStage ?? payload.nexyfabStage ?? state.user.nexyfabStage,
                      ),
                    }
                  : null,
              }));
            }
          } else if (data.plan != null || data.nexyfabStage != null) {
            set((state) => ({
              user: state.user
                ? {
                    ...state.user,
                    ...(data.plan != null ? { plan: data.plan } : {}),
                    ...(data.nexyfabStage != null
                      ? { nexyfabStage: parseUserStageColumn(data.nexyfabStage) }
                      : {}),
                  }
                : null,
            }));
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

/**
 * 다른 탭의 로그아웃을 **이 탭에 반영**한다.
 *
 * ⚠ 260802: `subscribeLogout` 을 정의만 하고 부르지 않으면 전파가 **한 방향**이 된다
 *   (보내기만 하고 받지 않음). 이 세션에서 반복해 잡은 「있는 것이 안 닿음」이라
 *   모듈 로드 시 **한 번** 구독한다.
 * ⚠ 여기서 서버를 다시 부르지 않는다 — 로그아웃한 탭이 이미 폐기했다.
 *   받은 탭까지 호출하면 탭 수만큼 요청이 늘고, 그중 하나가 실패하면 원인을 못 찾는다.
 */
if (typeof window !== 'undefined') {
  subscribeLogout(() => {
    useAuthStore.setState({ user: null, token: null, error: null });
    try { localStorage.removeItem('nexyfab-auth'); } catch { /* 저장소 차단 환경 */ }
  });
}

// Convenience re-export
export const useAuth = () => useAuthStore();
