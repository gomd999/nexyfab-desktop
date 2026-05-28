'use client';

/**
 * useOfflineSync.ts — React glue between Y.Doc, IndexedDB persistence, and
 * the online/offline event stream.
 *
 * The hook owns the *lifecycle* of an `IndexeddbPersistence` provider for a
 * given doc + docId pair. It exposes a `ready` flag (true after the local
 * cache replay completes) and an `online` flag (true when `navigator.onLine`
 * is true). Higher-level transports (`useCollabSseTransport`, future
 * WebSocketProvider) gate their connect on `online === true`; reconnect on
 * online happens naturally because of the gate.
 *
 * Why a hook instead of context:
 *   - The persistence provider is tied to a *single* doc instance. React
 *     refs / state already track that; the persistence is just another piece
 *     of per-doc state.
 *   - Cleanup is critical — IndexedDB handles leak on tab close otherwise.
 *     useEffect's cleanup is the natural place for `destroy()`.
 *
 * Note: this hook deliberately does NOT manage the WebSocket itself. The
 * collab transport (SSE / WS) is wired separately so we can land
 * persistence without touching transport code; transports just read the
 * `online` flag we expose to know when to connect.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type * as Y from 'yjs';
import type { IndexeddbPersistence } from 'y-indexeddb';
import { setupOfflinePersistence, clearLocalCache, getCacheSize } from './offlinePersistence';

export interface UseOfflineSyncOptions {
  /** Skip setup when false — used to gate persistence behind a feature flag. */
  enabled?: boolean;
}

export interface UseOfflineSyncResult {
  /** True after IndexedDB replay completes. */
  ready: boolean;
  /** True when the browser reports the network is reachable. */
  online: boolean;
  /** The active persistence provider (null until first effect run / when disabled). */
  persistence: IndexeddbPersistence | null;
  /** Most recent storage-origin usage estimate, in bytes. Refreshed by `refreshCacheSize`. */
  cacheBytes: number;
  /** Re-query `navigator.storage.estimate` and update `cacheBytes`. */
  refreshCacheSize: () => Promise<void>;
  /** Wipe this doc's IndexedDB cache (e.g. sign-out). */
  clearCache: () => Promise<void>;
}

function readInitialOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

export function useOfflineSync(
  doc: Y.Doc | null,
  docId: string | null,
  opts: UseOfflineSyncOptions = {},
): UseOfflineSyncResult {
  const { enabled = true } = opts;
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState<boolean>(() => readInitialOnline());
  const [persistence, setPersistence] = useState<IndexeddbPersistence | null>(null);
  const [cacheBytes, setCacheBytes] = useState(0);
  const persistenceRef = useRef<IndexeddbPersistence | null>(null);

  // ─── Persistence setup ─────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !doc || !docId) {
      setReady(false);
      return;
    }
    if (typeof indexedDB === 'undefined') {
      // SSR / non-browser — still mark ready so callers don't hang. The doc
      // simply has no offline cache; transport remains the only sync path.
      setReady(true);
      return;
    }

    let cancelled = false;
    let p: IndexeddbPersistence | null = null;
    try {
      p = setupOfflinePersistence(doc, docId);
    } catch (e) {
      console.warn('[useOfflineSync] setup failed:', e);
      setReady(true);
      return;
    }
    persistenceRef.current = p;
    setPersistence(p);
    setReady(false);

    p.whenSynced.then(() => {
      if (!cancelled) setReady(true);
    }).catch((e: unknown) => {
      console.warn('[useOfflineSync] whenSynced rejected:', e);
      if (!cancelled) setReady(true); // unblock UI even on failure
    });

    return () => {
      cancelled = true;
      // Important: destroy() closes the IDB handle but keeps the data, so
      // a remount (e.g. doc swap) can replay it. clearLocalCache() is the
      // explicit wipe path.
      void p?.destroy();
      persistenceRef.current = null;
      setPersistence(null);
      setReady(false);
    };
  }, [doc, docId, enabled]);

  // ─── Online / offline tracking ────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    // Sync once on mount in case events fired before listener attached.
    setOnline(readInitialOnline());
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const refreshCacheSize = useCallback(async () => {
    const bytes = await getCacheSize();
    setCacheBytes(bytes);
  }, []);

  const clearCache = useCallback(async () => {
    if (!docId) return;
    // Tear down active provider first so the delete request isn't blocked
    // by an open connection (IndexedDB blocks a delete while a tab holds
    // the DB open).
    const p = persistenceRef.current;
    if (p) {
      try { await p.destroy(); } catch { /* swallow — best effort */ }
      persistenceRef.current = null;
      setPersistence(null);
    }
    await clearLocalCache(docId);
    setCacheBytes(0);
  }, [docId]);

  // Refresh cache size on mount + whenever doc id changes.
  useEffect(() => {
    void refreshCacheSize();
  }, [docId, refreshCacheSize]);

  return {
    ready,
    online,
    persistence,
    cacheBytes,
    refreshCacheSize,
    clearCache,
  };
}
