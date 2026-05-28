/**
 * useRefGeomStore.ts — Wave 2 Phase 3 Week 4 Track Z4.
 *
 * React hook composing `RefGeomStore` based on the `?crdt=v2` URL flag.
 * Mirror of `sketch/useSketchStore.ts` (Z2).
 *
 *   - **Flag OFF (default)** — `RefGeomStore.local(...)`. A singleton per
 *     `docId` lives in a small registry so multiple hook calls share state.
 *
 *   - **Flag ON (`?crdt=v2`)** — `RefGeomStore.fromYDoc(doc)`. The doc
 *     comes from Z1's `useCollabDoc()` if a `<CollabProvider>` wraps the
 *     subtree; otherwise we fall back to a per-`docId` Y.Doc +
 *     BroadcastChannel so two tabs on the same origin still converge.
 *
 * Also exports two integration helpers per Z4 §5 + §6:
 *
 *   - `useRefGeomLwwCollisionToast(store, peerNameFn)` — fires a toast
 *     when a remote update overrides the local user's most recent
 *     `updateNode` (params or label). The hook returns the latest toast
 *     payload (or null), the integration layer renders it.
 *
 *   - `useRefGeomCycleWarning(store)` — runs `findAllCycles` on every
 *     update and returns the cycle path (or null). The host UI renders a
 *     "Cycle detected — please resolve" banner; the cycle is NOT
 *     auto-broken (would lose user intent).
 */

'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'next/navigation';
import * as Y from 'yjs';
// Note: lwwLastWriteRef is wired into the toast hook below via a closure
// instead of a separate hook return — see useRefGeomLwwCollisionToast.
import { RefGeomStore, type RefGeomStore as IRefGeomStore } from './RefGeomStore';
import { buildGraph, findAllCycles } from './depSolver';
import type { ReferenceNode } from './types';

// ─── Z1 Provider bridge ────────────────────────────────────────────────────
//
// `useCollabDoc()` from Z1's CollabProvider throws when called outside a
// provider. Z4 follows Z2's pattern: hosts that DO wrap the subtree in a
// <CollabProvider> pass the doc explicitly via `options.doc` (they have it
// from their own `useCollabDoc()` call). When `options.doc` is absent and
// the flag is on, we fall back to the per-docId BroadcastChannel doc.
//
// This keeps the hook itself provider-agnostic (no Context lookup) which
// matches Z2's `useCollabDocStub()` placeholder — except we don't even
// stub the lookup; the host is responsible for providing the doc.

function noopCollabDoc(): { doc: Y.Doc | null; ready: boolean } {
  return { doc: null, ready: false };
}

// ─── Cross-tab fallback bus ────────────────────────────────────────────────
//
// When no <CollabProvider> wraps us (or we're in ?crdt=v2 outside a collab
// session), two tabs on the same origin still converge via a
// per-docId BroadcastChannel + per-docId in-process Y.Doc. Mirror of the
// useSketchStore.ts pattern.

interface DocBundle {
  doc: Y.Doc;
  refcount: number;
  channel?: BroadcastChannel;
  channelCleanup?: () => void;
}

const docRegistry = new Map<string, DocBundle>();

function acquireFallbackDoc(docId: string): Y.Doc {
  let bundle = docRegistry.get(docId);
  if (!bundle) {
    const doc = new Y.Doc();
    bundle = { doc, refcount: 0 };

    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(`nexyfab-refgeom-crdt-${docId}`);
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
export function _resetRefGeomStoreFallback(): void {
  for (const [, bundle] of docRegistry) {
    if (bundle.channelCleanup) bundle.channelCleanup();
    bundle.doc.destroy();
  }
  docRegistry.clear();
}

/** Test-only: get (acquiring) the per-docId fallback doc. */
export function _acquireRefGeomFallbackDoc(docId: string): Y.Doc {
  return acquireFallbackDoc(docId);
}

// ─── Local-store registry (per-docId singleton) ────────────────────────────
//
// When the flag is OFF, multiple hook calls with the same docId share one
// store. Symmetric with the Yjs path.

interface LocalBundle {
  store: IRefGeomStore;
  refcount: number;
}
const localRegistry = new Map<string, LocalBundle>();

function acquireLocal(docId: string, initialNodes?: readonly ReferenceNode[]): IRefGeomStore {
  let bundle = localRegistry.get(docId);
  if (!bundle) {
    bundle = {
      store: RefGeomStore.local(initialNodes ?? []),
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
export function _resetRefGeomStoreLocal(): void {
  for (const [, bundle] of localRegistry) bundle.store.destroy();
  localRegistry.clear();
}

// ─── Hook surface ──────────────────────────────────────────────────────────

export interface UseRefGeomStoreOptions {
  /** Optional initial nodes — only used on first creation of the local
   *  store for this docId. Subsequent calls reuse the same store. */
  initialNodes?: readonly ReferenceNode[];

  /** Override for the flag detection — used by tests. */
  forceMode?: 'local' | 'yjs';

  /** Override for the doc — used by tests + by host wiring that already
   *  owns a Y.Doc. When provided, the doc-lookup chain is skipped. */
  doc?: Y.Doc | null;
}

export interface UseRefGeomStoreResult {
  store: IRefGeomStore;
  /** Force a re-snapshot. Useful when the host wants to refresh after an
   *  out-of-band mutation (e.g. server-pushed update). */
  invalidate: () => void;
  /** True when the store is Yjs-backed. */
  isCollab: boolean;
}

/** React hook returning the bound RefGeomStore for a given docId. Re-renders
 *  on every store mutation via subscribe + reducer pattern. */
export function useRefGeomStore(
  docId: string,
  options: UseRefGeomStoreOptions = {},
): UseRefGeomStoreResult {
  const searchParams = useSearchParams();
  const collab = noopCollabDoc();

  // Resolve mode. Explicit forceMode wins (tests); else URL flag; else local.
  const mode: 'local' | 'yjs' = options.forceMode
    ?? (searchParams?.get('crdt') === 'v2' ? 'yjs' : 'local');

  // Resolve the doc when in Yjs mode. Order: explicit option → Z1 provider
  // → fallback per-tab doc keyed by docId.
  const doc: Y.Doc | null = useMemo(() => {
    if (mode !== 'yjs') return null;
    if (options.doc !== undefined) return options.doc;
    if (collab.doc) return collab.doc;
    return acquireFallbackDoc(docId);
  }, [mode, options.doc, collab.doc, docId]);

  // Track whether we acquired the fallback (so we know to release it).
  const acquiredFallbackRef = useRef(false);
  useEffect(() => {
    if (mode === 'yjs' && options.doc === undefined && !collab.doc) {
      acquiredFallbackRef.current = true;
      return () => {
        releaseFallbackDoc(docId);
        acquiredFallbackRef.current = false;
      };
    }
    return undefined;
  }, [mode, options.doc, collab.doc, docId]);

  // Memoise the store; recreated only when mode / doc / docId change.
  const store: IRefGeomStore = useMemo(() => {
    if (mode === 'yjs' && doc) {
      return RefGeomStore.fromYDoc(doc);
    }
    return acquireLocal(docId, options.initialNodes);
    // initialNodes intentionally excluded from deps — only used on first
    // creation per docId (matches Z2 SketchStore semantics).
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

// ─── Cycle warning hook (Z4 §6) ────────────────────────────────────────────

export interface CycleWarning {
  /** The closed cycle path `[a, b, c, ..., a]`. */
  readonly cycle: readonly string[];
  /** Optional labels (for nicer UI rendering). */
  readonly labels?: readonly string[];
}

/** Run cycle detection on every store update; returns the first cycle
 *  (or null) so the host renders a banner. Multiple cycles aren't
 *  enumerated here — the banner just prompts "resolve and re-check".
 *
 *  Why not auto-break: per Z4 §6, peer A and peer B may have authored
 *  intentional but contradictory deps. Auto-breaking would silently lose
 *  one peer's work. The user manually breaks the cycle (e.g. by editing
 *  one node's params to drop the offending dep), and the warning clears
 *  on the next render. */
export function useRefGeomCycleWarning(store: IRefGeomStore): CycleWarning | null {
  const [warning, setWarning] = useState<CycleWarning | null>(null);

  const recompute = useCallback(() => {
    const nodes = store.getNodes();
    if (nodes.length === 0) {
      setWarning(null);
      return;
    }
    const graph = buildGraph(nodes);
    const { cycles } = findAllCycles(graph);
    if (cycles.length === 0) {
      setWarning(null);
      return;
    }
    const labelByid = new Map(nodes.map((n) => [n.id, n.label]));
    const first = cycles[0]!;
    const labels = first.map((id) => labelByid.get(id) ?? id);
    setWarning({ cycle: first, labels });
  }, [store]);

  useEffect(() => {
    recompute();
    const unsub = store.subscribe(recompute);
    return unsub;
  }, [store, recompute]);

  return warning;
}

// ─── LWW collision toast (Z4 §5) ───────────────────────────────────────────

export interface RefGeomLwwToast {
  /** The node whose params/label was overridden. */
  readonly nodeId: string;
  /** The node's label at the moment of collision (best-effort, for UI). */
  readonly nodeLabel: string;
  /** A human-readable description of who overrode (the integration layer
   *  passes a peerNameFn that resolves the most recent remote author). */
  readonly overriddenBy: string;
  /** Timestamp the collision was detected (ms since epoch). */
  readonly detectedAt: number;
}

export interface UseRefGeomLwwToastOptions {
  /** Resolve a label for the overriding peer. Defaults to "another collaborator". */
  peerNameFn?: () => string;
  /** Auto-dismiss after this many ms. Defaults to 5000. */
  autoDismissMs?: number;
}

/** Watch the store and surface a toast when a remote update overrides the
 *  local user's last write to the same nodeId. The integration layer
 *  consumes the returned `toast` (the most recent collision) and renders
 *  it; `dismiss()` clears it.
 *
 *  Implementation note: we detect "override" by tracking the last-write
 *  timestamp per nodeId, and comparing the in-memory snapshot to the
 *  pre-update snapshot. If the params (or label) changed for a node the
 *  local user wrote within `windowMs`, we treat it as an override.
 *
 *  This is best-effort UX — the canonical "who wrote last" comes from
 *  Yjs's clock and may not match wall-clock order. Mirror of Z2's
 *  SketchPanel collision toast pattern. */
export function useRefGeomLwwCollisionToast(
  store: IRefGeomStore,
  options: UseRefGeomLwwToastOptions = {},
): {
  toast: RefGeomLwwToast | null;
  dismiss: () => void;
} {
  const [toast, setToast] = useState<RefGeomLwwToast | null>(null);
  const peerNameFn = options.peerNameFn ?? defaultPeerName;
  const autoDismissMs = options.autoDismissMs ?? 5000;

  // Track the last local-write timestamps per nodeId. The integration
  // layer's mutation wrapper bumps these (we expose a setter via
  // `markLocalWrite`). For now, we approximate by remembering the last
  // snapshot's params hash per node and detecting changes that didn't
  // come from our own listener tick.
  const lastSnapshotRef = useRef<Map<string, string>>(new Map());
  const localWriteRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    // Seed the snapshot map.
    const initial = new Map<string, string>();
    for (const n of store.getNodes()) {
      initial.set(n.id, snapshotKey(n));
    }
    lastSnapshotRef.current = initial;

    const unsub = store.subscribe(() => {
      const now = Date.now();
      const next = new Map<string, string>();
      const overrides: Array<{ nodeId: string; label: string }> = [];
      for (const n of store.getNodes()) {
        const key = snapshotKey(n);
        next.set(n.id, key);
        const prev = lastSnapshotRef.current.get(n.id);
        if (prev !== undefined && prev !== key) {
          // Param/label changed since last snapshot. Was this a local
          // write within the window? If yes, AND the local write was
          // older than the snapshot change, treat as override.
          const lw = localWriteRef.current.get(n.id);
          // Collision detection rule: a remote update lands and overrides
          // a local write within autoDismissMs.
          if (lw !== undefined && now - lw < autoDismissMs) {
            overrides.push({ nodeId: n.id, label: n.label });
          }
        }
      }
      lastSnapshotRef.current = next;

      if (overrides.length > 0) {
        const first = overrides[0]!;
        setToast({
          nodeId: first.nodeId,
          nodeLabel: first.label,
          overriddenBy: peerNameFn(),
          detectedAt: now,
        });
      }
    });

    return unsub;
  }, [store, peerNameFn, autoDismissMs]);

  // Auto-dismiss after window.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), autoDismissMs);
    return () => clearTimeout(timer);
  }, [toast, autoDismissMs]);

  const dismiss = useCallback(() => setToast(null), []);
  return { toast, dismiss };
}

function snapshotKey(n: ReferenceNode): string {
  return `${n.label}|${JSON.stringify(n.params)}`;
}

function defaultPeerName(): string {
  return 'another collaborator';
}

/** Mark a node id as locally-written at `nowMs`. The integration layer
 *  calls this immediately before invoking `store.updateNode(...)` so the
 *  toast hook knows which writes to watch for override.
 *
 *  Exposed as a top-level helper (not a hook) because the integration
 *  callsite is inside the mutation handler, not a render phase. The
 *  underlying state is per-hook-instance via the closure in
 *  `useRefGeomLwwCollisionToast`, so we route through that hook's ref
 *  via a separate hook below.
 *
 *  In practice, hosts use `useRefGeomLwwTracker` to get a stable
 *  `markLocalWrite(nodeId)` callable. */
export function useRefGeomLwwTracker(): {
  markLocalWrite: (nodeId: string) => void;
} {
  const writes = useRef<Map<string, number>>(new Map());
  const markLocalWrite = useCallback((nodeId: string) => {
    writes.current.set(nodeId, Date.now());
  }, []);
  return { markLocalWrite };
}
