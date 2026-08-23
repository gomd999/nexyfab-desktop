'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore, type AuthUser } from '@/hooks/useAuth';

function authUrl(path: '/session' | '/refresh'): string {
  if (typeof window !== 'undefined' && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    return `https://nexyfab.com/api/auth${path}/`;
  }
  // next.config uses trailingSlash, so use the canonical API URL directly.
  // Otherwise the browser emits a 308 plus the real request, violating the
  // single session-probe contract on every page load.
  return `/api/auth${path}/`;
}

const STAGE_RESYNC_MS = 90_000;

interface SessionPayload {
  authenticated?: boolean;
  refreshable?: boolean;
  user?: AuthUser | null;
}

async function readSession(): Promise<SessionPayload | null> {
  const response = await fetch(authUrl('/session'), {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return (await response.json()) as SessionPayload;
}

/**
 * Reconcile the client store with the server session (the cookie is the single
 * source of truth for IDENTITY). Fixes the case where a shared browser's
 * persisted store shows one user while the cookie session is a different account.
 */
async function reconcileSession() {
  try {
    let data = await readSession();
    if (!data) return;

    // An expired access cookie can coexist with a valid httpOnly refresh cookie.
    // Only that explicit server hint is allowed to trigger refresh; a genuine
    // guest never probes the protected refresh endpoint.
    if (!data.user && data.refreshable) {
      const refreshed = await fetch(authUrl('/refresh'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (refreshed.ok) data = await readSession();
    }

    if (!data?.user) {
      // A successful anonymous probe is authoritative and clears stale
      // persisted identity. Network/5xx failures returned earlier and preserve it.
      useAuthStore.getState().setUser(null, null);
      try { sessionStorage.removeItem('currentUser'); } catch { /* unavailable */ }
      return;
    }
    const { token } = useAuthStore.getState();
    const prev = useAuthStore.getState().user;
    if (!prev || prev.id !== data.user.id) {
      // Empty or a DIFFERENT account in the store → server identity wins.
      useAuthStore.getState().setUser(data.user, token);
      try { sessionStorage.setItem('currentUser', JSON.stringify(data.user)); } catch { /* unavailable */ }
      return;
    }
    // Same account → merge server-side fields (plan/stage) onto the client user.
    useAuthStore.getState().setUser(
      { ...prev, ...data.user, nexyfabStage: data.user.nexyfabStage ?? prev.nexyfabStage ?? 'A' },
      token,
    );
    try {
      const current = useAuthStore.getState().user;
      if (current) sessionStorage.setItem('currentUser', JSON.stringify(current));
    } catch { /* unavailable */ }
  } catch { /* offline — keep current state */ }
}

/**
 * OAuth 등 쿠키-only 세션에서 zustand `user` 가 비어 있을 때 `GET /api/auth/session` 으로 채움.
 * 구버전 persisted 상태에 `nexyfabStage` 가 없으면 한 번 병합한다.
 *
 * 탭 포커스 복귀 시(스로틀) 세션을 다시 읽어 **Stage 등 서버 갱신**을 클라이언트에 반영(G-U3 세션 경유).
 */
export default function NexyfabSessionHydrator() {
  const ran = useRef(false);
  const lastStageSync = useRef(0);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    lastStageSync.current = Date.now();
    // Always reconcile on load (not only when empty) so a stale/divergent
    // persisted identity gets corrected against the server session.
    void reconcileSession();
  }, []);

  useEffect(() => {
    const pull = () => {
      const now = Date.now();
      if (now - lastStageSync.current < STAGE_RESYNC_MS) return;
      lastStageSync.current = now;
      void reconcileSession();
    };

    const onVis = () => {
      if (document.visibilityState === 'visible') pull();
    };
    window.addEventListener('focus', pull);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', pull);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return null;
}
