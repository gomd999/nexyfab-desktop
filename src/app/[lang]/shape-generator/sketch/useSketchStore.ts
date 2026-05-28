/**
 * useSketchStore — Wave 2 Phase 3 Week 2 Track Z2.
 *
 * React hook that composes `SketchStore` for a given sketchId, picking
 * Local-mode or Yjs-mode based on the `?crdt=v2` URL flag.
 *
 *   - **Flag OFF (default)** — `SketchStore.local(...)`. Identical to
 *     the pre-Z2 behaviour from the host's perspective; the underlying
 *     state lives in a singleton store instance per sketchId rather
 *     than per-hook useState, but the surface is the same.
 *
 *   - **Flag ON (`?crdt=v2`)** — `SketchStore.fromYDoc(doc, sketchId)`.
 *     The doc comes from Z1's `useCollabDoc()` hook if available; if Z1
 *     isn't wired yet on this branch (parallel implementation), we fall
 *     back to a process-local Y.Doc + BroadcastChannel so tabs on the
 *     same origin still converge. The BC fallback gives us a usable
 *     convergence test surface for the Z2 SketchPanel.crdt.test cases
 *     while Z1 lands.
 *
 * The hook re-renders the host on every `store.subscribe()` tick via the
 * standard React store-integration pattern (useReducer increment).
 */

'use client';

import { useEffect, useMemo, useReducer, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import * as Y from 'yjs';
import {
  SketchStore,
  emptySketch,
  type Sketch,
} from './SketchStore';

// ─── Z1 stub (CollabProvider — not yet on this base) ───────────────────────
//
// TODO Z1: replace this fallback with the real `useCollabDoc()` hook from
// `../collab/CollabProvider`. The Z1 work is running in parallel and may
// not have landed on this stack. The hook below is the contract the Z2
// integration depends on:
//
//   useCollabDoc(): { doc: Y.Doc | null; ready: boolean }
//
// When Z1 lands, this stub gets deleted and the import below switches to:
//
//   import { useCollabDoc } from '../collab/CollabProvider';
//
// The fallback returns `{ doc: null, ready: false }` so the hook falls back
// to its BroadcastChannel-based local convergence path (see below).

function useCollabDocStub(): { doc: Y.Doc | null; ready: boolean } {
  return { doc: null, ready: false };
}

// ─── Cross-tab fallback bus ────────────────────────────────────────────────
//
// When Z1 isn't wired (or we're in `?crdt=v2` outside a collab session),
// we still want two tabs on the same origin to converge. A
// per-sketchId BroadcastChannel + a per-sketchId in-process Y.Doc gives
// us that: each tab opens the same channel name, pushes
// `Y.encodeStateAsUpdate(...)` on local writes, and applies incoming
// updates from peers. This is a development convenience; production
// path goes through Z1's CollabProvider.

interface DocBundle {
  doc: Y.Doc;
  refcount: number;
  channel?: BroadcastChannel;
  channelCleanup?: () => void;
}

const docRegistry = new Map<string, DocBundle>();

function acquireFallbackDoc(sketchId: string): Y.Doc {
  let bundle = docRegistry.get(sketchId);
  if (!bundle) {
    const doc = new Y.Doc();
    bundle = { doc, refcount: 0 };

    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(`nexyfab-sketch-crdt-${sketchId}`);
      const onMessage = (e: MessageEvent) => {
        const data = e.data;
        if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
          const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
          Y.applyUpdate(doc, u8, 'broadcast-channel');
        }
      };
      const onLocalUpdate = (update: Uint8Array, origin: unknown) => {
        if (origin === 'broadcast-channel') return; // don't echo back
        try {
          channel.postMessage(update);
        } catch {
          /* ignore — BC throws if the channel is closed mid-tick */
        }
      };
      channel.addEventListener('message', onMessage);
      doc.on('update', onLocalUpdate);

      bundle.channel = channel;
      bundle.channelCleanup = () => {
        channel.removeEventListener('message', onMessage);
        doc.off('update', onLocalUpdate);
        channel.close();
      };
    }

    docRegistry.set(sketchId, bundle);
  }
  bundle.refcount += 1;
  return bundle.doc;
}

function releaseFallbackDoc(sketchId: string): void {
  const bundle = docRegistry.get(sketchId);
  if (!bundle) return;
  bundle.refcount -= 1;
  if (bundle.refcount <= 0) {
    if (bundle.channelCleanup) bundle.channelCleanup();
    bundle.doc.destroy();
    docRegistry.delete(sketchId);
  }
}

/** Test-only: clear the fallback doc registry. Used by Z2 hook tests to
 *  isolate test cases that share a sketchId. */
export function _resetSketchStoreFallback(): void {
  for (const [, bundle] of docRegistry) {
    if (bundle.channelCleanup) bundle.channelCleanup();
    bundle.doc.destroy();
  }
  docRegistry.clear();
}

/** Test-only: get (acquiring if needed) the per-sketchId fallback Y.Doc.
 *  Used by Z2 tests that need to drive the same doc that the hook's
 *  fallback path will use, so the panel's internal hook and the test
 *  probe converge. */
export function _acquireSketchStoreFallbackDoc(sketchId: string): Y.Doc {
  return acquireFallbackDoc(sketchId);
}

// ─── Local-store registry (per-sketchId singleton) ─────────────────────────
//
// When the flag is OFF, the hook still returns the SAME store across
// re-renders of the same component AND across multiple components that
// pass the same sketchId — this matches the Yjs behaviour and keeps the
// migrate path symmetrical. The registry is keyed by sketchId.

interface LocalBundle {
  store: SketchStore;
  refcount: number;
}
const localRegistry = new Map<string, LocalBundle>();

function acquireLocal(sketchId: string, initial?: Sketch): SketchStore {
  let bundle = localRegistry.get(sketchId);
  if (!bundle) {
    bundle = {
      store: SketchStore.local(initial ?? emptySketch(sketchId), sketchId),
      refcount: 0,
    };
    localRegistry.set(sketchId, bundle);
  }
  bundle.refcount += 1;
  return bundle.store;
}

function releaseLocal(sketchId: string): void {
  const bundle = localRegistry.get(sketchId);
  if (!bundle) return;
  bundle.refcount -= 1;
  if (bundle.refcount <= 0) {
    bundle.store.destroy();
    localRegistry.delete(sketchId);
  }
}

/** Test-only: clear the local store registry. */
export function _resetSketchStoreLocal(): void {
  for (const [, bundle] of localRegistry) bundle.store.destroy();
  localRegistry.clear();
}

// ─── Hook surface ──────────────────────────────────────────────────────────

export interface UseSketchStoreOptions {
  /** Optional initial sketch — applied only when the local-mode store is
   *  first created for this sketchId. Subsequent hook calls with the same
   *  id reuse the same store (initial is ignored after first creation). */
  initial?: Sketch;

  /** Override for the flag detection — used by tests so we don't have to
   *  mock useSearchParams. */
  forceMode?: 'local' | 'yjs';

  /** Override for the doc — used by tests + by Z1's CollabProvider once
   *  wired. When provided, the doc-lookup chain is skipped. */
  doc?: Y.Doc | null;
}

export interface UseSketchStoreResult {
  store: SketchStore;
  /** Force a re-snapshot. Useful in rare cases where the host wants to
   *  refresh after an out-of-band mutation (eg. server-pushed update). */
  invalidate: () => void;
  /** True when the store is Yjs-backed. */
  isCollab: boolean;
}

/** React hook returning the bound SketchStore for the given sketchId.
 *  Re-renders the host on any store mutation (subscribe + reducer pattern). */
export function useSketchStore(
  sketchId: string,
  options: UseSketchStoreOptions = {},
): UseSketchStoreResult {
  const searchParams = useSearchParams();
  const collab = useCollabDocStub();

  // Resolve mode. Explicit forceMode wins (tests); else URL flag; else local.
  const mode: 'local' | 'yjs' = options.forceMode
    ?? (searchParams?.get('crdt') === 'v2' ? 'yjs' : 'local');

  // Resolve the doc when in Yjs mode. Order: explicit option → Z1 provider
  // → fallback per-tab doc keyed by sketchId.
  const doc: Y.Doc | null = useMemo(() => {
    if (mode !== 'yjs') return null;
    if (options.doc !== undefined) return options.doc;
    if (collab.doc) return collab.doc;
    return acquireFallbackDoc(sketchId);
  }, [mode, options.doc, collab.doc, sketchId]);

  // Track whether we acquired the fallback so we know to release it.
  const acquiredFallbackRef = useRef(false);
  useEffect(() => {
    if (mode === 'yjs' && options.doc === undefined && !collab.doc) {
      acquiredFallbackRef.current = true;
      return () => {
        releaseFallbackDoc(sketchId);
        acquiredFallbackRef.current = false;
      };
    }
    return undefined;
  }, [mode, options.doc, collab.doc, sketchId]);

  // Memoise the store; recreated only when mode / doc / sketchId change.
  const store: SketchStore = useMemo(() => {
    if (mode === 'yjs' && doc) {
      return SketchStore.fromYDoc(doc, sketchId);
    }
    return acquireLocal(sketchId, options.initial);
    // We intentionally exclude options.initial from deps; it's only used
    // on first creation per sketchId. Changing it later won't recreate
    // the store — that's the contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, doc, sketchId]);

  // Release on unmount (matched by acquire on creation).
  useEffect(() => {
    return () => {
      if (mode === 'local') {
        releaseLocal(sketchId);
      } else if (store.mode === 'yjs') {
        // Yjs-mode store wraps the doc but doesn't own it; we only detach
        // the doc 'update' observer.
        store.destroy();
      }
    };
  }, [mode, sketchId, store]);

  // Re-render on store mutations.
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
