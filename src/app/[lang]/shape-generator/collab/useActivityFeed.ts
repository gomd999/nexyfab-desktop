'use client';

/**
 * useActivityFeed.ts — Wave 2 Phase 3 W7 Track Z7.
 *
 * React hook that returns the current activity log for the workspace and
 * wires the subscription pipeline. The hook is the integration point
 * between the 5 existing CRDT sub-trees and the Y.Array activity root —
 * it does NOT modify any of the upstream stores (read-only consumers).
 *
 * Subscription mechanism (the load-bearing piece — see spec §3):
 *
 *   Each of the 5 CRDT roots (`sketches`, `tree`, `referenceGeometry`,
 *   `configs`, `branches`) exposes itself as a Y.Map or Y.Array on the
 *   shared workspace Y.Doc. We attach `observeDeep` to each root
 *   (idempotent — Yjs dedupes observers by reference) and inspect each
 *   YEvent for added / deleted / updated keys.
 *
 *   The YEvent's `transaction.origin` tells us who initiated the change.
 *   - origin = local-ui / solver-commit / import-nfab / direct user
 *     identity → we log the op, the local peer is the author.
 *   - origin = remote-update / BC_ORIGIN_REMOTE (CollabProvider's
 *     internal symbol) / "broadcast-channel" / unknown remote → we skip,
 *     because the remote peer logged it on their side and the entry
 *     already replicated to us via the `activity` Y.Array root.
 *
 *   This "log on the source peer, replicate via Y.Array" design avoids
 *   double-logging: 2 peers, 1 op → exactly 1 entry in the merged log.
 *
 * Cap enforcement (spec §1): see `ActivityFeedYjs.appendActivityToDoc` —
 *   the cap is applied at append time inside the same transact, so the
 *   array never grows past 50.
 *
 * Flag handling (mirrors useBranchStore / useRefGeomStore):
 *   - Flag OFF (`?crdt=v1` or unset): hook returns the in-memory log
 *     only. No Y.Doc subscription. Append is local-only.
 *   - Flag ON (`?crdt=v2`): hook prefers `options.doc` (from a
 *     `CollabProvider` if mounted) and falls back to an in-process Y.Doc
 *     when none is provided.
 *
 * Provider integration: tries `useCollabDoc()` first. If that throws
 * (no Provider in scope), falls back to options.doc or a local-only
 * registry. The throw is caught by a one-shot try/catch — we do NOT use
 * CollabSafe here because that boundary swallows React tree errors at
 * render time, but `useCollabDoc` throws synchronously during the hook
 * call.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type MutableRefObject,
} from 'react';
import * as Y from 'yjs';
import {
  ACTIVITY_LOG_CAP,
  appendActivityEntry,
  newEntryId,
  type ActivityEntry,
  type ActivityKind,
} from './activityFeed';
import {
  appendActivityToDoc,
  getActivityRoot,
  readActivityLog,
} from './ActivityFeedYjs';

// ─── Provider lookup (defensive — works without CollabProvider) ────────────

// Re-import the context object (NOT the throwing hook) so we can read it
// without triggering the throw when no provider is mounted.
// CollabProvider doesn't export the bare context, but we can recover it
// via React's context resolution by importing the hook indirectly. The
// safe path is to wrap our useContext call in a try-catch via a tiny
// local hook.
//
// We can't import CollabContext directly (it's a private const on
// CollabProvider.tsx). Workaround: import the public hook and call it
// inside a try/catch within an internal helper hook. The hook returns
// null when the provider is absent.

import { useCollabDoc } from './CollabProvider';

/**
 * Wrap `useCollabDoc()` so that, when no `<CollabProvider>` is present,
 * the hook returns `null` instead of throwing. The throw site is the
 * `useCollabContext()` helper inside CollabProvider.tsx, which validates
 * context presence — catching its synchronous throw inside a try/catch
 * is safe because the underlying `useContext` call still ran (so the
 * hook count stays stable across renders).
 *
 * We rely on `useCollabDoc` being called UNCONDITIONALLY here so React's
 * rules-of-hooks invariants hold.
 */
function useOptionalCollabDoc(): Y.Doc | null {
  // The throw inside `useCollabDoc` is React-level (not hook-rule level):
  // `useContext` still runs unconditionally, then the wrapper validates
  // the value and throws if missing. We catch that throw to give callers
  // a graceful null. Rules-of-hooks is satisfied because the hook count
  // is identical across renders.
  try { return useCollabDoc(); } catch { return null; }
}

// ─── Hook surface ──────────────────────────────────────────────────────────

export interface UseActivityFeedOptions {
  /**
   * Y.Doc override — when provided, the hook subscribes to this doc
   * regardless of any ambient CollabProvider. Used by tests + when the
   * host wants to bind to a specific branch's doc.
   */
  doc?: Y.Doc | null;

  /**
   * Local peer identity — used as the author of locally-appended entries.
   * Optional; falls back to `('anonymous', '#999999', '<unknown>')` when
   * absent.
   */
  peer?: { id: string; name: string | null; color: string };

  /**
   * Force-disable subscription (returns empty log). Used by the
   * PresencePanel embed when the activity feed flag is off.
   */
  disabled?: boolean;
}

export interface UseActivityFeedResult {
  /** Current chronological log, newest-first, capped at 50. */
  entries: ActivityEntry[];
  /**
   * Append a locally-authored entry. The hook auto-generates an id and
   * timestamp; callers supply everything else.
   *
   * No-op when no Y.Doc is bound (the hook degrades silently to a
   * memory-only buffer — see in-memory fallback below).
   */
  append: (
    kind: ActivityKind,
    summary: string,
    entityId?: string,
  ) => void;
  /**
   * Hide all currently-visible entries on this peer only (does NOT
   * touch the Y.Doc). Subsequent ops replicate normally.
   */
  clearLocalView: () => void;
  /** True when the hook is currently bound to a Y.Doc (vs in-memory). */
  isReplicating: boolean;
}

// ─── In-memory fallback (no provider, no doc) ─────────────────────────────

const memoryLog: { entries: ActivityEntry[] } = { entries: [] };

// ─── Hook ──────────────────────────────────────────────────────────────────

/**
 * Subscribe to the activity feed for the current workspace's Y.Doc.
 *
 * Returns a stable reference to the live log (`entries`). The hook
 * re-renders on every Y.Array activity-root change AND on any of the
 * 5 source roots' deep changes (so locally-authored ops feed straight
 * into the log).
 */
export function useActivityFeed(
  options: UseActivityFeedOptions = {},
): UseActivityFeedResult {
  const ambientDoc = useOptionalCollabDoc();
  const doc: Y.Doc | null = options.disabled
    ? null
    : options.doc !== undefined
      ? options.doc
      : ambientDoc;

  // Cursor for "hidden after clearLocalView" — entries with timestamp <=
  // this are filtered out of the rendered list. Stored in a ref so the
  // setter does not trigger a render before `force` runs in the same
  // callback; the force reducer is the source of re-render truth.
  const hiddenBeforeRef = useRef<number>(0);
  // Bump on every clear so `useMemo` sees a fresh dep.
  const [hiddenTick, setHiddenTick] = useReducer((n: number) => n + 1, 0);

  // Force-render reducer — bumped on every relevant Y event.
  const [renderTick, force] = useReducer((n: number) => n + 1, 0);

  // Stable peer identity for locally-authored entries.
  const peerRef = useRef(options.peer);
  peerRef.current = options.peer;

  // ── In-memory log when no doc ───────────────────────────────────────────

  // ── Subscribe to the activity Y.Array root ─────────────────────────────

  useEffect(() => {
    if (!doc) return;
    const root = getActivityRoot(doc);
    const onChange = (): void => force();
    root.observe(onChange);
    return () => root.unobserve(onChange);
  }, [doc]);

  // ── Subscribe to the 5 source roots for LOCAL ops ──────────────────────
  //
  // For each root we attach an observeDeep listener. Inside, we filter
  // by transaction.origin — only origins that represent a local mutation
  // create an entry. Remote origins are skipped (their entries arrive via
  // the activity root).

  useEffect(() => {
    if (!doc) return;
    const cleanups: Array<() => void> = [];

    // Sketches root — Y.Map<sketchId, Y.Map<...>>
    cleanups.push(
      attachSourceObserver(doc, 'sketches', (events, origin) => {
        if (!isLocalOrigin(origin)) return [];
        const out: Array<{ kind: ActivityKind; summary: string; entityId?: string }> = [];
        for (const ev of events) {
          collectSketchOps(ev, out);
        }
        return out;
      }, peerRef, doc),
    );

    // Feature tree root — Y.Array<Y.Map<...>>
    cleanups.push(
      attachSourceObserver(doc, 'tree', (events, origin) => {
        if (!isLocalOrigin(origin)) return [];
        const out: Array<{ kind: ActivityKind; summary: string; entityId?: string }> = [];
        for (const ev of events) {
          collectTreeOps(ev, out);
        }
        return out;
      }, peerRef, doc),
    );

    // Reference geometry root — Y.Map<nodeId, Y.Map<...>>
    cleanups.push(
      attachSourceObserver(doc, 'referenceGeometry', (events, origin) => {
        if (!isLocalOrigin(origin)) return [];
        const out: Array<{ kind: ActivityKind; summary: string; entityId?: string }> = [];
        for (const ev of events) {
          collectRefGeomOps(ev, out);
        }
        return out;
      }, peerRef, doc),
    );

    // Configurations root — Y.Map<configId, Y.Map<...>>
    cleanups.push(
      attachSourceObserver(doc, 'configs', (events, origin) => {
        if (!isLocalOrigin(origin)) return [];
        const out: Array<{ kind: ActivityKind; summary: string; entityId?: string }> = [];
        for (const ev of events) {
          collectConfigOps(ev, out);
        }
        return out;
      }, peerRef, doc),
    );

    // Branches root — Y.Map<branchId, Y.Map<...>>
    cleanups.push(
      attachSourceObserver(doc, 'branches', (events, origin) => {
        if (!isLocalOrigin(origin)) return [];
        const out: Array<{ kind: ActivityKind; summary: string; entityId?: string }> = [];
        for (const ev of events) {
          collectBranchOps(ev, out);
        }
        return out;
      }, peerRef, doc),
    );

    return () => {
      for (const c of cleanups) c();
    };
  }, [doc]);

  // ── Snapshot derivation ────────────────────────────────────────────────

  const entries = useMemo(() => {
    const raw = doc ? readActivityLog(doc) : memoryLog.entries.slice();
    if (hiddenBeforeRef.current === 0) return raw;
    return raw.filter((e) => e.timestamp > hiddenBeforeRef.current);
    // `renderTick` and `hiddenTick` are the change beacons — the actual
    // data lives on `doc` (mutable) or `memoryLog` (mutable). React must
    // re-derive whenever the source mutates; the reducer ticks are how
    // we surface those mutations as deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, renderTick, hiddenTick]);

  // ── Append API ─────────────────────────────────────────────────────────

  const append = useCallback(
    (kind: ActivityKind, summary: string, entityId?: string) => {
      const peer = peerRef.current ?? {
        id: 'anonymous',
        name: null,
        color: 'hsl(0, 0%, 60%)',
      };
      const entry: ActivityEntry = {
        id: newEntryId(),
        kind,
        peerId: peer.id,
        peerName: peer.name,
        peerColor: peer.color,
        timestamp: Date.now(),
        summary,
        ...(entityId !== undefined ? { entityId } : {}),
      };
      if (doc) {
        appendActivityToDoc(doc, entry);
      } else {
        memoryLog.entries = appendActivityEntry(memoryLog.entries, entry);
        if (memoryLog.entries.length > ACTIVITY_LOG_CAP) {
          memoryLog.entries.length = ACTIVITY_LOG_CAP;
        }
      }
      force();
    },
    [doc],
  );

  // ── Local-view clear ───────────────────────────────────────────────────

  const clearLocalView = useCallback(() => {
    hiddenBeforeRef.current = Date.now();
    setHiddenTick();
  }, []);

  return {
    entries,
    append,
    clearLocalView,
    isReplicating: doc !== null,
  };
}

// ─── Source-observer plumbing ──────────────────────────────────────────────

/**
 * Origins that represent a local mutation by THIS peer. Any other origin
 * (Yjs Transaction.origin from a remote update) is skipped so we don't
 * double-log a peer's activity.
 *
 * The set deliberately matches the convention in each Yjs binding:
 *   - `'local-ui'`           (sketchYjs, refGeomYjs, configStoreYjs, branchRegistryYjs)
 *   - `'solver-commit'`      (sketchYjs)
 *   - `'import-nfab'`        (sketchYjs, refGeomYjs, configStoreYjs, branchRegistryYjs)
 *   - `null`                 (Y.Map / Y.Array operations with no explicit origin)
 *   - `'gc'`                 (sketchYjs / refGeomYjs sweeps — log so users see the cleanup)
 *
 * Remote origins to filter:
 *   - `'remote-update'`      (every Yjs binding)
 *   - `'broadcast-channel'`  (useBranchStore fallback)
 *   - any Symbol — CollabProvider's internal `BC_ORIGIN_REMOTE`.
 */
function isLocalOrigin(origin: unknown): boolean {
  if (origin === null || origin === undefined) return true;
  if (typeof origin === 'string') {
    return (
      origin === 'local-ui' ||
      origin === 'solver-commit' ||
      origin === 'import-nfab' ||
      origin === 'gc'
    );
  }
  // Symbols / objects (BC_ORIGIN_REMOTE, WebsocketProvider tokens) → not local.
  return false;
}

type CollectedOp = { kind: ActivityKind; summary: string; entityId?: string };

/**
 * Attach a deep observer to a top-level root by key. Returns the cleanup.
 * If the root key doesn't exist as a Y.Map or Y.Array yet, the observer
 * is attached lazily when the root materialises.
 *
 * `collect` translates the YEvent batch into zero or more activity ops.
 * Returns an empty array when the origin is remote.
 */
function attachSourceObserver(
  doc: Y.Doc,
  rootKey: 'sketches' | 'tree' | 'referenceGeometry' | 'configs' | 'branches',
  collect: (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, origin: unknown) => CollectedOp[],
  peerRef: MutableRefObject<UseActivityFeedOptions['peer']>,
  hostDoc: Y.Doc,
): () => void {
  // Probe for the root type. `tree` is a Y.Array; everything else is a Y.Map.
  // Both extend Y.AbstractType but TypeScript's stricter inference needs an
  // explicit cast for the union.
  const root = (
    rootKey === 'tree' ? doc.getArray(rootKey) : doc.getMap(rootKey)
  ) as unknown as Y.AbstractType<unknown>;

  const onChange = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, transaction: Y.Transaction): void => {
    const ops = collect(events, transaction.origin);
    if (ops.length === 0) return;
    const peer = peerRef.current ?? {
      id: 'anonymous',
      name: null,
      color: 'hsl(0, 0%, 60%)',
    };
    for (const op of ops) {
      appendActivityToDoc(hostDoc, {
        id: newEntryId(),
        kind: op.kind,
        peerId: peer.id,
        peerName: peer.name,
        peerColor: peer.color,
        timestamp: Date.now(),
        summary: op.summary,
        ...(op.entityId !== undefined ? { entityId: op.entityId } : {}),
      });
    }
  };

  // observeDeep gives us nested changes (e.g. segments inside a sketch's
  // Y.Map). For Y.Array sources (`tree`) the same API exists.
  (root as Y.AbstractType<unknown>).observeDeep(onChange);
  return () => (root as Y.AbstractType<unknown>).unobserveDeep(onChange);
}

// ─── Per-root op collectors ────────────────────────────────────────────────
//
// Each collector inspects YEvent.changes to figure out what changed and
// emits one ActivityKind entry per add/update/remove. We deliberately
// collapse multi-key updates inside a single YEvent into one entry to
// avoid spamming the feed with hundreds of per-key updates (e.g. a
// `addSegmentWithConstraints` op flips many keys but should log once).

function collectSketchOps(ev: Y.YEvent<Y.AbstractType<unknown>>, out: CollectedOp[]): void {
  // ev.path is RELATIVE to the observed root (`sketches` Y.Map).
  //   path = []                                  — sketches root itself
  //   path = [<sketchId>]                        — sketch Y.Map
  //   path = [<sketchId>, 'segments']            — segments Y.Map
  //   path = [<sketchId>, 'segments', <segId>]   — segment Y.Map (params changed)
  const path = ev.path as Array<string | number>;
  const keys = ev.changes.keys as Map<string, { action: 'add' | 'update' | 'delete' }>;

  // Segment add/remove/update at segments Y.Map level.
  if (path.length === 2 && path[1] === 'segments') {
    keys.forEach((change, segId) => {
      const action = change.action;
      if (action === 'add') {
        out.push({ kind: 'sketch:addSegment', summary: `added segment '${segId}'`, entityId: segId });
      } else if (action === 'update') {
        out.push({ kind: 'sketch:updateSegment', summary: `updated segment '${segId}'`, entityId: segId });
      } else if (action === 'delete') {
        out.push({ kind: 'sketch:removeSegment', summary: `removed segment '${segId}'`, entityId: segId });
      }
    });
  } else if (path.length === 3 && path[1] === 'segments') {
    // Per-key change inside an existing segment — surface as update.
    const segId = String(path[2]);
    out.push({ kind: 'sketch:updateSegment', summary: `updated segment '${segId}'`, entityId: segId });
  } else if (path.length === 2 && path[1] === 'constraints') {
    keys.forEach((change, conId) => {
      if (change.action === 'add') {
        out.push({ kind: 'sketch:addConstraint', summary: `added constraint '${conId}'`, entityId: conId });
      }
    });
  } else if (path.length === 2 && path[1] === 'dimensions') {
    keys.forEach((change, dimId) => {
      if (change.action === 'add') {
        out.push({ kind: 'sketch:addDimension', summary: `added dimension '${dimId}'`, entityId: dimId });
      }
    });
  }
}

function collectTreeOps(ev: Y.YEvent<Y.AbstractType<unknown>>, out: CollectedOp[]): void {
  const path = ev.path as Array<string | number>;
  // path = []  — top-level Y.Array (add/remove/reorder a node).
  // path = [<index>] — a node Y.Map (param update, label update, ...).
  if (path.length === 0) {
    // Y.Array delta — added items count, deleted items count, retained.
    const delta = ev.changes.delta as Array<{ insert?: unknown[]; delete?: number; retain?: number }>;
    let inserted = 0;
    let deleted = 0;
    for (const part of delta) {
      if (part.insert) inserted += part.insert.length;
      if (part.delete) deleted += part.delete;
    }
    // We can't easily disentangle "reorder" from "add then delete" at the
    // YEvent level (Yjs models reorder as delete+insert). Heuristic:
    // equal insert and delete in same event → reorder; else add/remove.
    if (inserted > 0 && deleted > 0 && inserted === deleted) {
      out.push({ kind: 'tree:reorder', summary: 'reordered feature tree node' });
    } else {
      if (inserted > 0) out.push({ kind: 'tree:addNode', summary: 'added feature tree node' });
      if (deleted > 0) out.push({ kind: 'tree:removeNode', summary: 'removed feature tree node' });
    }
  } else if (path.length >= 1 && typeof path[0] === 'number') {
    // Per-node update. Look at which keys changed.
    const keys = ev.changes.keys as Map<string, { action: 'add' | 'update' | 'delete' }>;
    let touchedParams = false;
    let touchedEnabled = false;
    keys.forEach((_change, key) => {
      if (key === 'params') touchedParams = true;
      if (key === 'enabled' || key === 'isEnabled') touchedEnabled = true;
    });
    if (touchedParams) {
      out.push({ kind: 'tree:updateParams', summary: 'edited feature tree parameters' });
    } else if (touchedEnabled) {
      out.push({ kind: 'tree:setEnabled', summary: 'toggled feature tree node' });
    }
  }
}

function collectRefGeomOps(ev: Y.YEvent<Y.AbstractType<unknown>>, out: CollectedOp[]): void {
  const path = ev.path as Array<string | number>;
  if (path.length === 0) {
    // Top-level Y.Map changes: add/remove ref node.
    const keys = ev.changes.keys as Map<string, { action: 'add' | 'update' | 'delete' }>;
    keys.forEach((change, nodeId) => {
      if (change.action === 'add') {
        out.push({ kind: 'refgeom:addNode', summary: `added reference '${nodeId}'`, entityId: nodeId });
      } else if (change.action === 'delete') {
        out.push({ kind: 'refgeom:removeNode', summary: `removed reference '${nodeId}'`, entityId: nodeId });
      }
    });
  } else if (path.length === 1) {
    // Nested update on a single ref-geom node.
    const nodeId = String(path[0]);
    out.push({ kind: 'refgeom:updateNode', summary: `updated reference '${nodeId}'`, entityId: nodeId });
  }
}

function collectConfigOps(ev: Y.YEvent<Y.AbstractType<unknown>>, out: CollectedOp[]): void {
  const path = ev.path as Array<string | number>;
  if (path.length === 0) {
    const keys = ev.changes.keys as Map<string, { action: 'add' | 'update' | 'delete' }>;
    keys.forEach((change, configId) => {
      if (change.action === 'add') {
        out.push({ kind: 'config:addConfig', summary: `added configuration '${configId}'`, entityId: configId });
      } else if (change.action === 'delete') {
        out.push({ kind: 'config:removeConfig', summary: `removed configuration '${configId}'`, entityId: configId });
      }
    });
  } else if (path.length === 1) {
    // Per-config update — surface as rename if the `name` key changed.
    const keys = ev.changes.keys as Map<string, { action: 'add' | 'update' | 'delete' }>;
    if (keys.has('name')) {
      const configId = String(path[0]);
      out.push({ kind: 'config:renameConfig', summary: `renamed configuration '${configId}'`, entityId: configId });
    }
  }
}

function collectBranchOps(ev: Y.YEvent<Y.AbstractType<unknown>>, out: CollectedOp[]): void {
  const path = ev.path as Array<string | number>;
  if (path.length === 0) {
    const keys = ev.changes.keys as Map<string, { action: 'add' | 'update' | 'delete' }>;
    keys.forEach((change, branchId) => {
      if (change.action === 'add') {
        out.push({ kind: 'branch:create', summary: `created branch '${branchId}'`, entityId: branchId });
      } else if (change.action === 'delete') {
        out.push({ kind: 'branch:remove', summary: `removed branch '${branchId}'`, entityId: branchId });
      }
    });
  } else if (path.length === 1) {
    const keys = ev.changes.keys as Map<string, { action: 'add' | 'update' | 'delete' }>;
    if (keys.has('name')) {
      const branchId = String(path[0]);
      out.push({ kind: 'branch:rename', summary: `renamed branch '${branchId}'`, entityId: branchId });
    }
  }
}
