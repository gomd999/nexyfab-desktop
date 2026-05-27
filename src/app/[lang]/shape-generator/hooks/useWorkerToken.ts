/**
 * useWorkerToken — W17 (ADR-007).
 *
 * Fetches a short-lived JWT from /api/nexyfab/worker-token (the main
 * app proxies the httpOnly cookie into a bearer-token-shaped JWT for
 * cross-origin worker calls). Caches in component state; auto-refreshes
 * 60 s before expiry so a long-running session doesn't drop into the
 * client-OCCT fallback path mid-edit.
 *
 * Returns a getter that lazily fetches on first call. Component code
 * destructures: `const { getToken } = useWorkerToken();`
 *
 * On 401 (logged out), getToken() returns null and the boolean op's
 * server hook falls back through to worker / sync. No throw — keeps
 * the UI responsive even if the session expired between operations.
 */

import { useCallback, useEffect, useRef } from 'react';

/** Refresh this many seconds BEFORE the server-reported expiry. */
const REFRESH_LEAD_SECONDS = 60;

interface TokenState {
  token: string;
  /** Absolute expiry time (ms since epoch). */
  expiresAtMs: number;
}

export interface UseWorkerTokenResult {
  /** Returns a fresh token, fetching/refreshing as needed. Null if
   *  the user is signed out (401 from the endpoint). */
  getToken: () => Promise<string | null>;
  /** Clear the cache (e.g. on sign-out). */
  invalidate: () => void;
}

export function useWorkerToken(): UseWorkerTokenResult {
  // Refs not state — token reads should not trigger re-renders.
  const tokenRef = useRef<TokenState | null>(null);
  const inFlightRef = useRef<Promise<TokenState | null> | null>(null);

  const fetchToken = useCallback(async (): Promise<TokenState | null> => {
    const resp = await fetch('/api/nexyfab/worker-token', {
      method: 'GET',
      credentials: 'include', // sends the httpOnly nf_access_token cookie
    });
    if (resp.status === 401) {
      tokenRef.current = null;
      return null;
    }
    if (!resp.ok) {
      throw new Error(`worker-token endpoint returned ${resp.status}`);
    }
    const body = (await resp.json()) as { token: string; expiresInSeconds: number };
    const state: TokenState = {
      token: body.token,
      expiresAtMs: Date.now() + body.expiresInSeconds * 1000,
    };
    tokenRef.current = state;
    return state;
  }, []);

  const getToken = useCallback(async (): Promise<string | null> => {
    const now = Date.now();
    const cached = tokenRef.current;
    if (cached && cached.expiresAtMs - now > REFRESH_LEAD_SECONDS * 1000) {
      return cached.token;
    }
    // Dedupe concurrent fetches — every component re-render that
    // races getToken should join a single in-flight promise.
    if (!inFlightRef.current) {
      inFlightRef.current = fetchToken().finally(() => {
        inFlightRef.current = null;
      });
    }
    const result = await inFlightRef.current;
    return result?.token ?? null;
  }, [fetchToken]);

  const invalidate = useCallback(() => {
    tokenRef.current = null;
  }, []);

  // Cleanup on unmount — nothing to clear since refs garbage-collect
  // with the component, but explicit invalidate keeps intent clear.
  useEffect(() => () => { tokenRef.current = null; }, []);

  return { getToken, invalidate };
}
