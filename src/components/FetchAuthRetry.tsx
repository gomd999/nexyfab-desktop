'use client';

/**
 * Global safety net for session expiry.
 *
 * Hundreds of client `fetch('/api/...')` calls across the Hub, Studio and the
 * 3D CAD modeler are "raw" — they don't refresh the access token on a 401, so
 * when the short-lived access cookie lapses mid-session the call hard-fails
 * (e.g. "프로젝트를 불러오지 못했습니다", modeler AI 401). Rather than touch
 * every call site, wrap `window.fetch` once: on a 401 from a same-origin `/api/`
 * request (never the auth endpoints themselves), refresh the session once and
 * retry the request a single time. Idempotent and body-safe.
 */
import { useEffect } from 'react';
import { useAuthStore } from '@/hooks/useAuth';

let installed = false;
// Single-flight: concurrent 401s share one refresh instead of stampeding.
let refreshing: Promise<boolean> | null = null;

function refreshOnce(orig: typeof fetch): Promise<boolean> {
  if (!refreshing) {
    refreshing = orig('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(r => r.ok)
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export default function FetchAuthRetry() {
  useEffect(() => {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    const orig = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const sameOrigin = url.startsWith('/') || url.startsWith(window.location.origin);
      // Only same-origin /api/ calls, and never the auth endpoints (avoids loops).
      const eligible = sameOrigin && url.includes('/api/') && !url.includes('/api/auth/');

      const res = await orig(input, init);
      if (!eligible || res.status !== 401) return res;

      // A protected endpoint may legitimately return 401 to a signed-out user.
      // Refresh only for a session that the cookie-backed hydrator has already
      // confirmed; otherwise a notification 401 creates a misleading refresh
      // 400 and doubles the guest-side failure noise.
      if (useAuthStore.getState().sessionStatus !== 'authenticated') return res;

      // The request must be safely re-sendable to retry. undefined / string
      // bodies are fine; streams, Blobs and FormData are not re-read reliably.
      const body = init?.body;
      const canRetry = body == null || typeof body === 'string';
      if (!canRetry) return res;

      const ok = await refreshOnce(orig);
      if (!ok) return res; // refresh failed → genuinely logged out; surface 401
      try {
        return await orig(input, init);
      } catch {
        return res;
      }
    };

    return () => { window.fetch = orig; installed = false; };
  }, []);

  return null;
}
