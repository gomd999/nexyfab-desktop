/**
 * useFeatureStackBridge — Wave 2 Phase 3 Week 3 Track Z3.
 *
 * Opt-in adapter that lets a call site choose between:
 *   - the legacy reducer-backed `useFeatureStack()` (default), OR
 *   - a CRDT-backed `useFeatureTreeStore(docId)` that exposes the same
 *     reads + the CRDT-safe subset of mutations.
 *
 * **Why a bridge instead of editing `useFeatureStack` in place?**
 *
 * `useFeatureStack` is a reducer-heavy hook with 16+ mutation callbacks
 * closing over a `Map<id, HistoryNode>`. Retrofitting it to route through
 * a Y.Doc on a flag would mean rewriting every `setNodeMap(prev => ...)`
 * call — high blast radius across all 19 consumers, all of which would
 * need re-validation. The bridge approach keeps `useFeatureStack` 100%
 * untouched (matching the "byte-identical when not opted in" property
 * Z2 set) and gives callers that DO want CRDT semantics one new hook:
 * `useFeatureStackBridge(crdtDocId)`.
 *
 * Call-site contract:
 *
 *   // OPT-OUT (default — pre-Z3 behaviour, useFeatureStack unchanged):
 *   const stack = useFeatureStack();
 *
 *   // OPT-IN (Z3 — Yjs-backed when ?crdt=v2):
 *   const stack = useFeatureStackBridge(projectId);
 *
 * In opt-in mode, the bridge ALSO returns the local `useFeatureStack`
 * result alongside the CRDT store, so a call site that hasn't migrated
 * all of its mutations yet can drive the legacy one for unmapped methods
 * (e.g. `setNodeEnabledExpr`). The intended W4 work is to walk every
 * call site once and confirm none of the still-legacy-only methods are
 * critical to the Yjs path; until then this dual-mode keeps the integration
 * safe.
 *
 * The bridge is intentionally THIN — it doesn't duplicate the
 * `useFeatureStack` surface. Callers read the CRDT store directly for
 * the mutations Z3 cares about (addNode / removeNode / reorder /
 * updateParams / updateLabel / setEnabled / setActive / updateSketch).
 */

'use client';

import { useMemo } from 'react';
import { useFeatureStack } from '../useFeatureStack';
import { useFeatureTreeStore, type UseFeatureTreeStoreOptions } from './useFeatureTreeStore';
import type { FeatureTreeStore } from './FeatureTreeStore';

export interface UseFeatureStackBridgeResult {
  /** Whether the bridge is in CRDT mode (`?crdt=v2` AND a docId supplied). */
  isCollab: boolean;

  /** The Z3 CRDT store. Always present (local-mode when not opted in). */
  treeStore: FeatureTreeStore;

  /** The legacy `useFeatureStack()` return. Always present.
   *
   *  - When `isCollab` is `false`, this is the source of truth.
   *  - When `isCollab` is `true`, the host writes through `treeStore.*`
   *    for the CRDT-safe mutations. The legacy `featureStack` is kept
   *    around for back-compat reads of derived state (`featureErrors`,
   *    `featuresCompat`, etc.) and for methods Z3 hasn't lifted into
   *    the CRDT store (`setNodeEnabledExpr`, expansion toggling, label
   *    counter generation). */
  featureStack: ReturnType<typeof useFeatureStack>;
}

/** Opt-in bridge — pass `null` or omit the docId to disable CRDT.
 *  When `crdtDocId` is a non-empty string AND `?crdt=v2` is set, the
 *  `treeStore` is Yjs-backed; otherwise it falls back to a local store
 *  (still a valid `FeatureTreeStore` — just not synced to a Y.Doc). */
export function useFeatureStackBridge(
  crdtDocId?: string | null,
  options: UseFeatureTreeStoreOptions = {},
): UseFeatureStackBridgeResult {
  const featureStack = useFeatureStack();
  // Always call the hook to keep call-order stable; pass a sentinel when
  // the caller opted out so the store is a cheap local instance.
  const resolvedDocId = crdtDocId && crdtDocId.length > 0 ? crdtDocId : '__z3-disabled__';
  const optedOut = !crdtDocId || crdtDocId.length === 0;
  const result = useFeatureTreeStore(resolvedDocId, {
    ...options,
    forceMode: optedOut ? 'local' : options.forceMode,
  });

  return useMemo<UseFeatureStackBridgeResult>(() => ({
    isCollab: !optedOut && result.isCollab,
    treeStore: result.store,
    featureStack,
  }), [optedOut, result.store, result.isCollab, featureStack]);
}
