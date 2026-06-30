'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore, type AuthUser } from '@/hooks/useAuth';

function sessionUrl(): string {
  if (typeof window !== 'undefined' && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    return 'https://nexyfab.com/api/auth/session';
  }
  return '/api/auth/session';
}

const STAGE_RESYNC_MS = 90_000;

/**
 * Reconcile the client store with the server session (the cookie is the single
 * source of truth for IDENTITY). Fixes the case where a shared browser's
 * persisted store shows one user while the cookie session is a different account.
 */
async function reconcileSession() {
  try {
    const r = await fetch(sessionUrl(), { credentials: 'include' });
    // On a transient 401 (access cookie mid-refresh) we keep current state to
    // avoid kicking out valid users; identity correction happens on the 200 path.
    if (!r.ok) return;
    const data = (await r.json()) as { user?: AuthUser } | null;
    if (!data?.user) return;
    const { token } = useAuthStore.getState();
    const prev = useAuthStore.getState().user;
    if (!prev || prev.id !== data.user.id) {
      // Empty or a DIFFERENT account in the store → server identity wins.
      useAuthStore.getState().setUser(data.user, token);
      return;
    }
    // Same account → merge server-side fields (plan/stage) onto the client user.
    useAuthStore.getState().setUser(
      { ...prev, ...data.user, nexyfabStage: data.user.nexyfabStage ?? prev.nexyfabStage ?? 'A' },
      token,
    );
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
