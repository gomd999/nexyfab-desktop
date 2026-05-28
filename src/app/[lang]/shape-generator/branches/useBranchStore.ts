/**
 * useBranchStore.ts — Wave 2 Phase 3 Week 6 Track Z6.
 *
 * React hook composing `BranchStore` based on the `?crdt=v2` URL flag.
 * Mirror of `referenceGeometry/useRefGeomStore.ts`.
 *
 *   - **Flag OFF (default)** — `BranchStore.local()`. A singleton per
 *     workspaceId lives in a small registry so multiple hook calls share
 *     state.
 *
 *   - **Flag ON (`?crdt=v2`)** — `BranchStore.fromYDoc(workspaceDoc)`.
 *     The doc comes from an explicit option (host wires it from its own
 *     `useCollabDoc()` call) or falls back to a per-workspace
 *     BroadcastChannel doc.
 */

'use client';

import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { useSearchParams } from 'next/navigation';
import * as Y from 'yjs';
import { BranchStore, type BranchStore as IBranchStore } from './BranchStore';
import type { BranchRegistry } from './branchTypes';

// ─── Cross-tab fallback bus ────────────────────────────────────────────────
//
// Same pattern as useRefGeomStore: per-workspaceId BroadcastChannel + per-
// workspaceId in-process Y.Doc keeps two tabs on the same origin in sync
// when no explicit doc is provided. Production hosts wire `options.doc`
// from a `<CollabProvider>` context.

interface DocBundle {
  doc: Y.Doc;
  refcount: number;
  channel?: BroadcastChannel;
  channelCleanup?: () => void;
}

const docRegistry = new Map<string, DocBundle>();

function acquireFallbackDoc(workspaceId: string): Y.Doc {
  let bundle = docRegistry.get(workspaceId);
  if (!bundle) {
    const doc = new Y.Doc();
    bundle = { doc, refcount: 0 };

    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(`nexyfab-branches-crdt-${workspaceId}`);
      const onMessage = (e: MessageEvent): void => {
        const data = e.data;
        if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
          const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
          Y.applyUpdate(doc, u8, 'broadcast-channel');
        }
      };
      const onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
        if (origin === 'broadcast-channel') return; // don't echo
        try {
          channel.postMessage(update);
        } catch {
          /* BC may throw if closed mid-tick */
        }
      };
      channel.addEventListener('message', onMessage);
      doc.on('update', onLocalUpdate);

      bundle.channel = channel;
      bundle.channelCleanup = (): void => {
        channel.removeEventListener('message', onMessage);
        doc.off('update', onLocalUpdate);
        channel.close();
      };
    }

    docRegistry.set(workspaceId, bundle);
  }
  bundle.refcount += 1;
  return bundle.doc;
}

function releaseFallbackDoc(workspaceId: string): void {
  const bundle = docRegistry.get(workspaceId);
  if (!bundle) return;
  bundle.refcount -= 1;
  if (bundle.refcount <= 0) {
    if (bundle.channelCleanup) bundle.channelCleanup();
    bundle.doc.destroy();
    docRegistry.delete(workspaceId);
  }
}

/** Test-only: clear the fallback registry. */
export function _resetBranchStoreFallback(): void {
  for (const [, bundle] of docRegistry) {
    if (bundle.channelCleanup) bundle.channelCleanup();
    bundle.doc.destroy();
  }
  docRegistry.clear();
}

/** Test-only: acquire the per-workspaceId fallback doc. */
export function _acquireBranchFallbackDoc(workspaceId: string): Y.Doc {
  return acquireFallbackDoc(workspaceId);
}

// ─── Local-store registry (per-workspaceId singleton) ──────────────────────

interface LocalBundle {
  store: IBranchStore;
  refcount: number;
}
const localRegistry = new Map<string, LocalBundle>();

function acquireLocal(workspaceId: string, initial?: BranchRegistry): IBranchStore {
  let bundle = localRegistry.get(workspaceId);
  if (!bundle) {
    bundle = {
      store: BranchStore.local(initial),
      refcount: 0,
    };
    localRegistry.set(workspaceId, bundle);
  }
  bundle.refcount += 1;
  return bundle.store;
}

function releaseLocal(workspaceId: string): void {
  const bundle = localRegistry.get(workspaceId);
  if (!bundle) return;
  bundle.refcount -= 1;
  if (bundle.refcount <= 0) {
    bundle.store.destroy();
    localRegistry.delete(workspaceId);
  }
}

/** Test-only: clear the local registry. */
export function _resetBranchStoreLocal(): void {
  for (const [, bundle] of localRegistry) bundle.store.destroy();
  localRegistry.clear();
}

// ─── Hook surface ──────────────────────────────────────────────────────────

export interface UseBranchStoreOptions {
  /** Optional initial registry — only used on first creation of the local
   *  store for this workspaceId. Subsequent calls reuse the same store. */
  initial?: BranchRegistry;

  /** Override for the flag detection — used by tests. */
  forceMode?: 'local' | 'yjs';

  /** Override for the workspace doc — used by tests + host wiring. When
   *  provided, the doc-lookup chain is skipped. */
  doc?: Y.Doc | null;
}

export interface UseBranchStoreResult {
  store: IBranchStore;
  /** Force a re-snapshot. */
  invalidate: () => void;
  /** True when the store is Yjs-backed. */
  isCollab: boolean;
}

/** React hook returning the bound BranchStore for a given workspaceId.
 *  Re-renders on every store mutation via subscribe + reducer pattern. */
export function useBranchStore(
  workspaceId: string,
  options: UseBranchStoreOptions = {},
): UseBranchStoreResult {
  const searchParams = useSearchParams();

  const mode: 'local' | 'yjs' = options.forceMode
    ?? (searchParams?.get('crdt') === 'v2' ? 'yjs' : 'local');

  const doc: Y.Doc | null = useMemo(() => {
    if (mode !== 'yjs') return null;
    if (options.doc !== undefined) return options.doc;
    return acquireFallbackDoc(workspaceId);
  }, [mode, options.doc, workspaceId]);

  const acquiredFallbackRef = useRef(false);
  useEffect(() => {
    if (mode === 'yjs' && options.doc === undefined) {
      acquiredFallbackRef.current = true;
      return () => {
        releaseFallbackDoc(workspaceId);
        acquiredFallbackRef.current = false;
      };
    }
    return undefined;
  }, [mode, options.doc, workspaceId]);

  const store: IBranchStore = useMemo(() => {
    if (mode === 'yjs' && doc) {
      return BranchStore.fromYDoc(doc);
    }
    return acquireLocal(workspaceId, options.initial);
    // initial intentionally excluded — only used on first creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, doc, workspaceId]);

  useEffect(() => {
    return () => {
      if (mode === 'local') {
        releaseLocal(workspaceId);
      } else if (store.mode === 'yjs') {
        store.destroy();
      }
    };
  }, [mode, workspaceId, store]);

  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const unsub = store.subscribe(() => force());
    return unsub;
  }, [store]);

  return {
    store,
    invalidate: force,
    isCollab: store.mode === 'yjs',
  };
}
