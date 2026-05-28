/**
 * offlinePersistence.ts — Yjs <-> IndexedDB offline persistence.
 *
 * Per ADR-010 + docs/wave-2-crdt-architecture.md: collab state must survive
 * tab close, refresh, and network outages. The legacy `.nfab` file model is
 * demoted to a **cache** (export/share-friendly snapshot); IndexedDB becomes
 * the source-of-truth for in-progress edits.
 *
 * Design notes:
 *   - We deliberately wrap `y-indexeddb` rather than re-implementing it. The
 *     library is the official Yjs persistence provider, has been battle-tested
 *     by tldraw / hocuspocus / convex, and gives us trim + monotonic update
 *     log for free.
 *   - Each `docId` maps to one IndexedDB database. Tearing one doc down (e.g.
 *     sign-out) does not touch others — sign-out only wipes the active doc.
 *   - Database names are namespaced under DB_NAMESPACE so we don't collide
 *     with future doc stores (chat history, undo log, etc).
 *   - `setupOfflinePersistence` returns the raw provider so callers can
 *     `await persistence.whenSynced` before connecting their WebSocket /
 *     SSE transport. This ordering matters: connect-first would race the
 *     local-cache replay and double-apply some updates (Yjs is idempotent
 *     but the doubled traffic is wasted bandwidth).
 *   - SSR safety: every entry point checks `typeof indexedDB`. The provider
 *     itself crashes on Node, so we throw a clearer error message before
 *     touching it.
 *
 * Usage:
 *   const doc = new Y.Doc();
 *   const persistence = setupOfflinePersistence(doc, projectId);
 *   await persistence.whenSynced; // local cache replayed
 *   // …then connect transport
 *
 *   // sign-out:
 *   await clearLocalCache(projectId);
 */

import * as Y from 'yjs';
import { IndexeddbPersistence, clearDocument } from 'y-indexeddb';

/** All cache DBs live under this prefix so we can enumerate / clear them. */
export const DB_NAMESPACE = 'nexyfab-collab';

/** Resolve the IndexedDB database name for a given collab doc id. */
export function dbNameFor(docId: string): string {
  return `${DB_NAMESPACE}::${docId}`;
}

function assertIdbAvailable(): void {
  if (typeof indexedDB === 'undefined') {
    throw new Error(
      '[offlinePersistence] IndexedDB is not available in this environment. ' +
      'Use within a browser / Tauri webview, or load fake-indexeddb in tests.',
    );
  }
}

/**
 * Wire a Y.Doc to the local IndexedDB cache.
 *
 * The returned `IndexeddbPersistence` exposes:
 *   - `whenSynced: Promise<self>` — resolves after local replay completes.
 *   - `destroy(): Promise<void>` — closes the DB handle, keeps the data.
 *   - `clearData(): Promise<void>` — destroys + wipes the DB.
 *
 * Caller must call `.destroy()` (or `clearLocalCache`) on teardown, otherwise
 * the IndexedDB connection leaks until tab close.
 */
export function setupOfflinePersistence(doc: Y.Doc, docId: string): IndexeddbPersistence {
  if (typeof docId !== 'string' || docId.length === 0) {
    throw new Error('[offlinePersistence] docId must be a non-empty string');
  }
  assertIdbAvailable();
  const name = dbNameFor(docId);
  return new IndexeddbPersistence(name, doc);
}

/**
 * Delete the entire cache DB for a single doc. Used on sign-out, "discard
 * local changes", and "leave project" flows.
 *
 * Returns a Promise that resolves once the DB is deleted (or rejects if the
 * delete request errors). Idempotent: deleting a non-existent DB resolves.
 */
export async function clearLocalCache(docId: string): Promise<void> {
  if (typeof docId !== 'string' || docId.length === 0) {
    throw new Error('[offlinePersistence] docId must be a non-empty string');
  }
  if (typeof indexedDB === 'undefined') {
    // No-op on SSR / non-browser — nothing to clear.
    return;
  }
  await clearDocument(dbNameFor(docId));
}

/**
 * Total bytes currently used by the browser's storage origin (Cache, IDB,
 * Service Worker). The Storage API does not expose per-DB usage; the best we
 * can do is the origin-level number. UI components present this as "Local
 * cache: 4.2 MB" with the caveat that other origins share the budget.
 *
 * Returns 0 in environments without `navigator.storage.estimate` (e.g. older
 * Safari, Tauri webview without polyfill, jsdom tests).
 */
export async function getCacheSize(): Promise<number> {
  if (
    typeof navigator === 'undefined' ||
    !('storage' in navigator) ||
    typeof navigator.storage.estimate !== 'function'
  ) {
    return 0;
  }
  try {
    const est = await navigator.storage.estimate();
    return typeof est.usage === 'number' ? est.usage : 0;
  } catch {
    return 0;
  }
}

/**
 * Format a byte count for UI display. Returns a localized string like
 * "4.2 MB" or "640 KB". Kept here so the persistence module owns the
 * single source-of-truth for cache-related UX strings.
 */
export function formatCacheSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  // 1 decimal for KB+, integer for B.
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
