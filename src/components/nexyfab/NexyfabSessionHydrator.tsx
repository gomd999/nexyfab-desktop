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

function mergeSessionUser(data: { user?: AuthUser } | null) {
  if (!data?.user) return;
  const { token } = useAuthStore.getState();
  const prev = useAuthStore.getState().user;
  if (!prev) {
    useAuthStore.getState().setUser(data.user, token);
    return;
  }
  if (data.user.id !== prev.id) return;
  useAuthStore.getState().setUser(
    {
      ...prev,
      ...data.user,
      nexyfabStage: data.user.nexyfabStage ?? prev.nexyfabStage ?? 'A',
    },
    token,
  );
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

    const { user, token, setUser } = useAuthStore.getState();
    const needHydrate = !user || !('nexyfabStage' in user);

    if (!needHydrate) return;

    void fetch(sessionUrl(), { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { user?: AuthUser } | null) => {
        if (!data?.user) return;
        const prev = useAuthStore.getState().user;
        if (!prev) {
          setUser(data.user, token);
          return;
        }
        setUser(
          {
            ...prev,
            ...data.user,
            nexyfabStage: data.user.nexyfabStage ?? prev.nexyfabStage ?? 'A',
          },
          token,
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const pull = () => {
      const { user } = useAuthStore.getState();
      if (!user?.id) return;
      const now = Date.now();
      if (now - lastStageSync.current < STAGE_RESYNC_MS) return;
      lastStageSync.current = now;
      void fetch(sessionUrl(), { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { user?: AuthUser } | null) => mergeSessionUser(data))
        .catch(() => {});
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
