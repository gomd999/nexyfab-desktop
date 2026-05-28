/**
 * useFeatureTreeStore — Wave 2 Phase 3 Week 3 Track Z3.
 *
 * React hook that composes `FeatureTreeStore`, picking Local-mode or
 * Yjs-mode based on the `?crdt=v2` URL flag.
 *
 *   - **Flag OFF (default)** — the host stays on `useFeatureStack` directly;
 *     this hook isn't on the path. When called anyway (eg. by an opt-in
 *     adapter at a call site), it returns a local-mode `FeatureTreeStore`.
 *
 *   - **Flag ON (`?crdt=v2`)** — `FeatureTreeStore.fromYDoc(doc)`. The doc
 *     comes from Z1's `useCollabDoc()` hook when a `<CollabProvider>` wraps
 *     the call site (use `<CollabDocBridge>` to forward it down). When no
 *     Provider is wrapping, we fall back to a process-local Y.Doc + a
 *     BroadcastChannel so tabs on the same origin still converge.
 *     (Mirrors `useSketchStore`'s BC fallback.)
 *
 * The hook re-renders the host on every `store.subscribe()` tick via the
 * standard React store-integration pattern (useReducer increment).
 */

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'next/navigation';
import * as Y from 'yjs';
import { FeatureTreeStore, type FeatureTreeStore as TFeatureTreeStore } from './FeatureTreeStore';
import type { FeatureTreeSnapshot } from '../collab/featureTreeYjs';
import { useCollabDoc } from '../collab/CollabProvider';

// ─── Cross-tab fallback bus ────────────────────────────────────────────────
//
// Same shape as `useSketchStore`'s fallback: per-docId Y.Doc + BC + refcount.

interface DocBundle {
  doc: Y.Doc;
  refcount: number;
  channel?: BroadcastChannel;
  channelCleanup?: () => void;
}

const docRegistry = new Map<string, DocBundle>();
const BC_PREFIX = 'nexyfab-feature-tree-crdt-';
const BC_ORIGIN = 'broadcast-channel-feature-tree';

function acquireFallbackDoc(docId: string): Y.Doc {
  let bundle = docRegistry.get(docId);
  if (!bundle) {
    const doc = new Y.Doc();
    bundle = { doc, refcount: 0 };

    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(BC_PREFIX + docId);
      const onMessage = (e: MessageEvent) => {
        const data = e.data;
        if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
          const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
          Y.applyUpdate(doc, u8, BC_ORIGIN);
        }
      };
      const onLocalUpdate = (update: Uint8Array, origin: unknown) => {
        if (origin === BC_ORIGIN) return; // don't echo back
        try {
          channel.postMessage(update);
        } catch {
          /* BC closed mid-tick */
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

    docRegistry.set(docId, bundle);
  }
  bundle.refcount += 1;
  return bundle.doc;
}

function releaseFallbackDoc(docId: string): void {
  const bundle = docRegistry.get(docId);
  if (!bundle) return;
  bundle.refcount -= 1;
  if (bundle.refcount <= 0) {
    if (bundle.channelCleanup) bundle.channelCleanup();
    bundle.doc.destroy();
    docRegistry.delete(docId);
  }
}

/** Test-only: clear the fallback registry. */
export function _resetFeatureTreeStoreFallback(): void {
  for (const [, bundle] of docRegistry) {
    if (bundle.channelCleanup) bundle.channelCleanup();
    bundle.doc.destroy();
  }
  docRegistry.clear();
}

/** Test-only: acquire / get the per-docId fallback Y.Doc. */
export function _acquireFeatureTreeFallbackDoc(docId: string): Y.Doc {
  return acquireFallbackDoc(docId);
}

// ─── Local-store registry (per-docId singleton, for local mode) ────────────

interface LocalBundle {
  store: TFeatureTreeStore;
  refcount: number;
}
const localRegistry = new Map<string, LocalBundle>();

function acquireLocal(docId: string, initial?: FeatureTreeSnapshot): TFeatureTreeStore {
  let bundle = localRegistry.get(docId);
  if (!bundle) {
    bundle = {
      store: FeatureTreeStore.local(initial),
      refcount: 0,
    };
    localRegistry.set(docId, bundle);
  }
  bundle.refcount += 1;
  return bundle.store;
}

function releaseLocal(docId: string): void {
  const bundle = localRegistry.get(docId);
  if (!bundle) return;
  bundle.refcount -= 1;
  if (bundle.refcount <= 0) {
    bundle.store.destroy();
    localRegistry.delete(docId);
  }
}

/** Test-only: clear the local registry. */
export function _resetFeatureTreeStoreLocal(): void {
  for (const [, bundle] of localRegistry) bundle.store.destroy();
  localRegistry.clear();
}

// ─── Hook surface ──────────────────────────────────────────────────────────

export interface UseFeatureTreeStoreOptions {
  /** Initial snapshot — applied only on first store creation per docId.
   *  Subsequent acquires of the same docId reuse the same store. */
  initial?: FeatureTreeSnapshot;

  /** Override for the flag detection — used by tests so we don't have to
   *  mock useSearchParams. */
  forceMode?: 'local' | 'yjs';

  /** Override for the doc — used by tests + by the host's CollabProvider
   *  bridge. When provided, the BC fallback is skipped. */
  doc?: Y.Doc | null;
}

export interface UseFeatureTreeStoreResult {
  store: TFeatureTreeStore;
  /** Force a re-snapshot. */
  invalidate: () => void;
  /** True when the store is Yjs-backed. */
  isCollab: boolean;
}

export function useFeatureTreeStore(
  docId: string,
  options: UseFeatureTreeStoreOptions = {},
): UseFeatureTreeStoreResult {
  const searchParams = useSearchParams();
  const bridgedDoc = useBridgedCollabDoc();

  const mode: 'local' | 'yjs' = options.forceMode
    ?? (searchParams?.get('crdt') === 'v2' ? 'yjs' : 'local');

  // Resolve the doc when in Yjs mode. Priority:
  //   1. explicit options.doc (tests + direct host call)
  //   2. <CollabDocBridge> bridged doc (production CollabProvider path)
  //   3. BC fallback registry (Provider-less dev / single-tab scenarios)
  const doc: Y.Doc | null = useMemo(() => {
    if (mode !== 'yjs') return null;
    if (options.doc !== undefined && options.doc !== null) return options.doc;
    if (bridgedDoc) return bridgedDoc;
    return acquireFallbackDoc(docId);
  }, [mode, options.doc, bridgedDoc, docId]);

  // Track whether we acquired the fallback so we know to release it.
  const acquiredFallbackRef = useRef(false);
  useEffect(() => {
    const useFallback =
      mode === 'yjs' &&
      (options.doc === undefined || options.doc === null) &&
      !bridgedDoc;
    if (useFallback) {
      acquiredFallbackRef.current = true;
      return () => {
        releaseFallbackDoc(docId);
        acquiredFallbackRef.current = false;
      };
    }
    return undefined;
  }, [mode, options.doc, bridgedDoc, docId]);

  // Memoise the store; recreated only when mode / doc / docId change.
  const store: TFeatureTreeStore = useMemo(() => {
    if (mode === 'yjs' && doc) {
      return FeatureTreeStore.fromYDoc(doc);
    }
    return acquireLocal(docId, options.initial);
    // initial is intentionally NOT in deps — same contract as Z2.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, doc, docId]);

  // Release on unmount.
  useEffect(() => {
    return () => {
      if (mode === 'local') {
        releaseLocal(docId);
      } else if (store.mode === 'yjs') {
        store.destroy();
      }
    };
  }, [mode, docId, store]);

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

// ─── LWW collision toast (host integration helper) ─────────────────────────
//
// When two peers reorder / edit the same node, LWW resolves. The "loser"
// peer sees `"Your X was overridden by @peer"`. Implemented here (NOT in
// FeatureTreeStore) so the store stays pure and per-peer toast state is a
// host concern.

export interface UseFeatureTreeLwwOptions {
  /** Awareness peer-name resolver from Z1; falls back to "another collaborator". */
  resolvePeerName?: (peerId: string) => string | null;
  /** Auto-dismiss ms (default 4000). */
  dismissMs?: number;
}

type NodeLike = {
  id: string;
  label: string;
  params: Record<string, number>;
  enabled: boolean;
  children: string[];
};

/** Fingerprint includes per-node properties that are direct user inputs:
 *  label, params, enabled. We intentionally EXCLUDE `children` — when a
 *  peer adds a new sibling it modifies the parent's `children` array, but
 *  that's "remote add" (not a collision on the parent). A real reorder
 *  collision IS surfaced because the moved node itself changes parent
 *  membership (we'd want to detect that via the tree-array position),
 *  but for the W3 cut we keep the toast conservative: only fire on
 *  same-node user-input overrides. Z5 widens this. */
function nodesFingerprint(nodes: ReadonlyArray<NodeLike>): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of nodes) {
    out.set(
      n.id,
      `${n.label}|${JSON.stringify(n.params)}|${n.enabled ? '1' : '0'}`,
    );
  }
  return out;
}

const LOCAL_ORIGINS = new Set([
  'local-ui',
  'solver-commit',
  'import-nfab',
  'gc',
  'applyFeatureOp', // featureTreeYjs.ts wraps its own writes with this source
]);

/** Listen for remote-origin Y.Doc updates that override a node we knew about.
 *
 *  Returns the latest collision message (or null). Auto-dismisses after
 *  `dismissMs` ms. The hook is a no-op when `doc` is null (local mode).
 *
 *  Detection algorithm (mirrors Z2's `useLwwCollisionToast`):
 *   - On mount + after every detected change, snapshot a fingerprint of
 *     every node's `(label, params, enabled, children-order)` keyed by id.
 *   - On a Y.Doc 'update' event whose origin is NOT a local UI origin,
 *     diff the fingerprint. If any previously-known id changed → toast.
 *   - Pure-add events (new ids) don't fire the toast; new-from-peer is
 *     not a "collision".
 */
export function useFeatureTreeLwwCollisionToast(
  doc: Y.Doc | null,
  getNodes: () => ReadonlyArray<NodeLike>,
  options: UseFeatureTreeLwwOptions = {},
): string | null {
  const { resolvePeerName, dismissMs = 4000 } = options;
  const [message, setMessage] = useState<string | null>(null);
  const prevRef = useRef<Map<string, string>>(new Map());
  const initRef = useRef(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getNodesRef = useRef(getNodes);
  useEffect(() => { getNodesRef.current = getNodes; }, [getNodes]);

  // Memoised dismiss for future close-button wiring; not currently used.
  const dismiss = useCallback(() => { setMessage(null); }, []);
  void dismiss;

  useEffect(() => {
    if (!doc) return;

    if (!initRef.current) {
      prevRef.current = nodesFingerprint(getNodesRef.current());
      initRef.current = true;
    }

    const handler = (...args: unknown[]) => {
      const origin = args[1];
      // `applyFeatureOp` wraps its updates with `{ source: 'applyFeatureOp' }`
      // — the origin is the object, not the string. Read `.source` if present.
      let originStr: string | null = null;
      if (typeof origin === 'string') originStr = origin;
      else if (origin && typeof origin === 'object' && 'source' in origin) {
        originStr = String((origin as { source: unknown }).source);
      }

      const isLocal = originStr !== null && LOCAL_ORIGINS.has(originStr);

      const next = nodesFingerprint(getNodesRef.current());

      if (isLocal) {
        prevRef.current = next;
        return;
      }

      let collisionId: string | null = null;
      for (const [id, fp] of next) {
        const before = prevRef.current.get(id);
        if (before !== undefined && before !== fp) {
          collisionId = id;
          break;
        }
      }
      prevRef.current = next;
      if (!collisionId) return;

      const peerName = originStr && resolvePeerName ? resolvePeerName(originStr) : null;
      const who = peerName ?? 'another collaborator';
      setMessage(`Your edit on "${collisionId}" was overridden by ${who}`);

      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => setMessage(null), dismissMs);
    };

    doc.on('update', handler);
    return () => {
      doc.off('update', handler);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [doc, resolvePeerName, dismissMs]);

  return message;
}

// ─── Host bridge: connect Z1 CollabProvider's doc to useFeatureTreeStore ───
//
// The Z1 `useCollabDoc()` hook throws when called outside its Provider. To
// keep `useFeatureTreeStore` usable both inside and outside a <CollabProvider>,
// the host wraps the subtree that needs Yjs-backed feature-tree state with
// `<CollabDocBridge>`, which calls `useCollabDoc()` and surfaces it via
// context to descendants. The hook reads the bridge via `useBridgedCollabDoc()`
// and falls back to the BC registry if absent.

const CollabDocBridgeContext = createContext<Y.Doc | null>(null);

/** Render this INSIDE a <CollabProvider> subtree. It reads the Provider's
 *  Y.Doc and surfaces it to descendants that call `useFeatureTreeStore()`.
 *  Outside a CollabProvider, callers don't need to use this — the
 *  `useFeatureTreeStore` hook will fall back to the BC registry. */
export function CollabDocBridge({ children }: { children: ReactNode }) {
  const doc = useCollabDoc();
  return (
    <CollabDocBridgeContext.Provider value={doc}>
      {children}
    </CollabDocBridgeContext.Provider>
  );
}

/** Read the bridged Y.Doc when wrapped by `<CollabDocBridge>`. Returns
 *  null when no bridge is present (call site is outside a CollabProvider). */
export function useBridgedCollabDoc(): Y.Doc | null {
  return useContext(CollabDocBridgeContext);
}
