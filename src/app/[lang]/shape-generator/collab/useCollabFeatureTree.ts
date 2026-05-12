'use client';

/**
 * Hook bridging useFeatureStack-style state with a CollabDoc.
 *
 * Opt-in: callers that want CRDT semantics for the feature tree wrap their
 * existing setHistory calls with `pushLocalSnapshot`, and subscribe to
 * `onRemoteSnapshot` to merge incoming changes from peers.
 *
 * This is intentionally NOT a full replacement for useFeatureStack — it lives
 * alongside so we can roll out per-room or per-feature without rewriting the
 * tree state machine. Once stable we can flip useFeatureStack to drive
 * directly through the doc.
 */

import { useEffect, useMemo } from 'react';
import { CollabDoc } from './yjsDoc';
import { SHAPE_MAP, normalizeShapeParams } from '../shapes';
import type { FeatureHistory, HistoryNode } from '../useFeatureStack';

export interface CollabFeatureTreeBridge {
  /** Underlying doc — exposed for advanced consumers (e.g., custom transports). */
  doc: CollabDoc;
  /** Push a local FeatureHistory snapshot into the shared doc. */
  pushLocalSnapshot: (history: FeatureHistory, params: Record<string, number>, selectedId: string | null) => void;
  /** Subscribe to remote snapshots; returns unsubscribe. */
  onRemoteSnapshot: (cb: (snapshot: { tree: Record<string, HistoryNode>; order: string[]; params: Record<string, number>; selectedId: string | null }) => void) => () => void;
  /** Encode the doc's full state for sending over a transport channel. */
  encodeUpdate: () => string;
  /** Apply an encoded update from a peer. */
  applyRemoteUpdate: (b64: string) => boolean;
}

export function useCollabFeatureTree(): CollabFeatureTreeBridge {
  const doc = useMemo(() => new CollabDoc(), []);
  useEffect(() => () => { doc.destroy(); }, [doc]);

  return useMemo<CollabFeatureTreeBridge>(() => ({
    doc,
    pushLocalSnapshot: (history, params, selectedId) => {
      const treeMap: Record<string, unknown> = {};
      for (const node of history.nodes) {
        treeMap[node.id] = node;
      }
      doc.setFeatureTree(treeMap);
      doc.setFeatureOrder(history.nodes.map(n => n.id));
      const sd = selectedId ? SHAPE_MAP[selectedId] : undefined;
      const paramsToShare = sd ? normalizeShapeParams(sd, params).params : params;
      doc.setParams(paramsToShare);
      doc.setSelectedId(selectedId);
    },
    onRemoteSnapshot: (cb) => {
      // Re-emit a full snapshot whenever any of the four shared structures change.
      // Coalesce multiple change observers into one synchronous burst per Yjs transaction.
      let dirty = false;
      const flush = () => {
        if (!dirty) return;
        dirty = false;
        cb({
          tree: doc.getFeatureTree() as Record<string, HistoryNode>,
          order: doc.getFeatureOrder(),
          params: doc.getParams(),
          selectedId: doc.getSelectedId(),
        });
      };
      const mark = () => { dirty = true; queueMicrotask(flush); };
      const u1 = doc.onFeatureTreeChanged(mark);
      const u2 = doc.onFeatureOrderChanged(mark);
      const u3 = doc.onParamsChanged(mark);
      const u4 = doc.onSelectedChanged(mark);
      return () => { u1(); u2(); u3(); u4(); };
    },
    encodeUpdate: () => doc.encodeUpdate(),
    applyRemoteUpdate: (b64) => doc.applyRemoteUpdate(b64),
  }), [doc]);
}
