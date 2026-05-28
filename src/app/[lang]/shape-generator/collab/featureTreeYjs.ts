/**
 * featureTreeYjs.ts — Yjs CRDT binding for the feature tree + sketches.
 *
 * Phase 1 Week 2 prototype implementing the structure described in
 * `docs/wave-2-crdt-architecture.md` §2.4 + §2.2:
 *
 *   Y.Doc
 *   ├── tree:     Y.Array<Y.Map>            // feature tree nodes (flat, ordered)
 *   └── sketches: Y.Map<sketchId, Y.Map>   // one Y.Map per sketch
 *
 * Key decisions (see §2.4 for full rationale):
 *
 * 1. **`sketchData` is lifted out of the HistoryNode into a top-level
 *    `sketches` Y.Map**, and the tree node only carries `sketchRef: string`.
 *    Two users editing the same sketch's segments + reordering features in
 *    the tree no longer collide on the same Y.Map.
 *
 * 2. **Feature tree is `Y.Array<Y.Map>`**. Concurrent inserts at the same
 *    logical index produce a deterministic linearisation where both nodes
 *    survive. Order is intrinsically semantic (parent-of-feature ordering
 *    drives the OCCT pipeline), so positional array is correct.
 *
 * 3. **Per-node `params` and `children` are Y.Map/Y.Array** (not JSON
 *    blobs). Two users editing different params of the same node merge
 *    cleanly — this is the whole point of CRDT.
 *
 * 4. **Selection arrays (edgeSelections / faceSelections) are
 *    JSON-stringified** as a single field. They're snapshots from a click
 *    moment, not collaboratively edited; whole-array LWW is the right
 *    semantic match.
 *
 * 5. **Runtime fields (`error`, `editingActive`) are NOT stored in the
 *    Y.Doc**, matching `stripRuntimeFields` in nfabFormat.ts. They live in
 *    per-peer React state.
 */

import * as Y from 'yjs';
import type {
  FeatureHistory,
  HistoryNode,
  HistoryNodeType,
  SketchNodeData,
} from '../useFeatureStack';
import type { FeatureType } from '../features/types';
import type {
  EdgeSelectionInfo,
  FaceSelectionInfo,
} from '../editing/selectionInfo';

// ────────────────────────────────────────────────────────────────────────────
// Top-level keys on the Y.Doc
// ────────────────────────────────────────────────────────────────────────────

export const TREE_KEY = 'tree';
export const SKETCHES_KEY = 'sketches';
export const META_KEY = 'treeMeta'; // rootId / activeNodeId / editingNodeId

/** A single feature tree node, encoded as Y.Map. */
export type FeatureNodeMap = Y.Map<unknown>;
/** The top-level feature tree array. */
export type FeatureTreeArray = Y.Array<FeatureNodeMap>;
/** A sketch entry stored at `sketches[sketchId]`. */
export type SketchYMap = Y.Map<unknown>;
/** The top-level sketches map. */
export type SketchesMap = Y.Map<SketchYMap>;
/** treeMeta keys */
export type TreeMeta = Y.Map<unknown>;

// ────────────────────────────────────────────────────────────────────────────
// Public projection types — what callers see when they read back
// ────────────────────────────────────────────────────────────────────────────

export interface FeatureTreeSnapshot {
  /** Full feature-tree history (without sketchData populated — see `sketches`). */
  tree: FeatureHistory;
  /** sketchId → SketchNodeData. The HistoryNode.sketchRef indexes into this. */
  sketches: Record<string, SketchNodeData>;
}

// ────────────────────────────────────────────────────────────────────────────
// Shared accessors
// ────────────────────────────────────────────────────────────────────────────

export function getSharedTree(doc: Y.Doc): FeatureTreeArray {
  return doc.getArray<FeatureNodeMap>(TREE_KEY);
}

export function getSharedSketches(doc: Y.Doc): SketchesMap {
  return doc.getMap<SketchYMap>(SKETCHES_KEY);
}

export function getSharedMeta(doc: Y.Doc): TreeMeta {
  return doc.getMap<unknown>(META_KEY);
}

// ────────────────────────────────────────────────────────────────────────────
// Encoding helpers — HistoryNode <-> Y.Map
// ────────────────────────────────────────────────────────────────────────────

/** Strip the runtime-only fields before persisting (mirrors nfabFormat.ts). */
function stripRuntimeFields(node: HistoryNode): HistoryNode {
  const { error: _e, editingActive: _ea, ...rest } = node;
  return { ...rest, editingActive: false };
}

/** Build a Y.Map carrying a HistoryNode (without `sketchData` — that lives in the
 *  shared `sketches` map; we only store `sketchRef` here). */
export function nodeToYMap(node: HistoryNode, sketchRef?: string): FeatureNodeMap {
  const stripped = stripRuntimeFields(node);
  const map = new Y.Map<unknown>();

  map.set('id', stripped.id);
  map.set('type', stripped.type);
  map.set('label', stripped.label);
  map.set('icon', stripped.icon);
  if (stripped.featureType !== undefined) map.set('featureType', stripped.featureType);

  // params → nested Y.Map for per-key merging
  const params = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(stripped.params)) params.set(k, v);
  map.set('params', params);

  map.set('enabled', stripped.enabled);
  if (stripped.enabledExpr !== undefined) map.set('enabledExpr', stripped.enabledExpr);
  map.set('expanded', stripped.expanded);
  map.set('parentId', stripped.parentId);

  // children → Y.Array<string> for ordered child id list with concurrent push merging
  const children = new Y.Array<string>();
  if (stripped.children.length > 0) children.insert(0, stripped.children);
  map.set('children', children);

  map.set('timestamp', stripped.timestamp);

  if (stripped.dependsOn !== undefined) {
    const dep = new Y.Array<string>();
    if (stripped.dependsOn.length > 0) dep.insert(0, stripped.dependsOn);
    map.set('dependsOn', dep);
  }

  // sketchRef — pointer into the top-level sketches map (replaces sketchData embedding)
  if (sketchRef !== undefined) map.set('sketchRef', sketchRef);

  // Click-time selection snapshots — JSON-stringify (atomic LWW, not concurrently edited)
  if (stripped.edgeSelections !== undefined) {
    map.set('edgeSelections', JSON.stringify(stripped.edgeSelections));
  }
  if (stripped.faceSelections !== undefined) {
    map.set('faceSelections', JSON.stringify(stripped.faceSelections));
  }

  return map;
}

/** Decode a Y.Map back into a HistoryNode shape. `sketchData` is hydrated
 *  from the shared sketches map (when `sketchRef` is present). */
export function yMapToNode(
  map: FeatureNodeMap,
  sketches: SketchesMap,
): HistoryNode {
  const paramsMap = map.get('params') as Y.Map<unknown> | undefined;
  const params: Record<string, number> = {};
  if (paramsMap) {
    paramsMap.forEach((v, k) => {
      params[k] = v as number;
    });
  }

  const childrenArr = map.get('children') as Y.Array<string> | undefined;
  const children: string[] = childrenArr ? childrenArr.toArray() : [];

  const dependsOnArr = map.get('dependsOn') as Y.Array<string> | undefined;
  const dependsOn = dependsOnArr ? dependsOnArr.toArray() : undefined;

  const node: HistoryNode = {
    id: (map.get('id') as string) ?? '',
    type: (map.get('type') as HistoryNodeType) ?? 'feature',
    label: (map.get('label') as string) ?? '',
    icon: (map.get('icon') as string) ?? '',
    params,
    enabled: (map.get('enabled') as boolean) ?? true,
    expanded: (map.get('expanded') as boolean) ?? false,
    parentId: (map.get('parentId') as string | null) ?? null,
    children,
    editingActive: false,
    timestamp: (map.get('timestamp') as number) ?? 0,
  };

  const featureType = map.get('featureType') as FeatureType | undefined;
  if (featureType !== undefined) node.featureType = featureType;

  const enabledExpr = map.get('enabledExpr') as string | undefined;
  if (enabledExpr !== undefined) node.enabledExpr = enabledExpr;

  if (dependsOn !== undefined) node.dependsOn = dependsOn;

  const sketchRef = map.get('sketchRef') as string | undefined;
  if (sketchRef !== undefined) {
    const sketchMap = sketches.get(sketchRef);
    if (sketchMap) {
      node.sketchData = ySketchToData(sketchMap);
    }
  }

  const edgeSelStr = map.get('edgeSelections') as string | undefined;
  if (edgeSelStr !== undefined) {
    try {
      node.edgeSelections = JSON.parse(edgeSelStr) as EdgeSelectionInfo[];
    } catch {
      /* malformed — drop */
    }
  }
  const faceSelStr = map.get('faceSelections') as string | undefined;
  if (faceSelStr !== undefined) {
    try {
      node.faceSelections = JSON.parse(faceSelStr) as FaceSelectionInfo[];
    } catch {
      /* malformed — drop */
    }
  }

  return node;
}

// ────────────────────────────────────────────────────────────────────────────
// Encoding helpers — SketchNodeData <-> Y.Map
// ────────────────────────────────────────────────────────────────────────────

/** Encode a SketchNodeData into a Y.Map for storage in `sketches[sketchId]`.
 *
 *  Phase 1 prototype keeps profile/config/constraints/dimensions as
 *  JSON-stringified atomic blobs. Phase 3 will lift segments/constraints/
 *  dimensions into per-id keyed Y.Maps (see architecture doc §2.2-2.3).
 *  This v1 still gives us the structural decoupling between
 *  feature-tree-edits and sketch-edits, which is the main win at this step.
 */
export function sketchDataToYMap(data: SketchNodeData): SketchYMap {
  const map = new Y.Map<unknown>();
  map.set('plane', data.plane);
  map.set('planeOffset', data.planeOffset);
  map.set('operation', data.operation);
  map.set('profile', JSON.stringify(data.profile));
  map.set('config', JSON.stringify(data.config));
  if (data.constraints !== undefined) {
    map.set('constraints', JSON.stringify(data.constraints));
  }
  if (data.dimensions !== undefined) {
    map.set('dimensions', JSON.stringify(data.dimensions));
  }
  if (data.faceFrame !== undefined) {
    map.set('faceFrame', JSON.stringify(data.faceFrame));
  }
  return map;
}

/** Decode a sketch Y.Map back into a SketchNodeData. */
export function ySketchToData(map: SketchYMap): SketchNodeData {
  const profileStr = map.get('profile') as string | undefined;
  const configStr = map.get('config') as string | undefined;
  const constraintsStr = map.get('constraints') as string | undefined;
  const dimensionsStr = map.get('dimensions') as string | undefined;
  const faceFrameStr = map.get('faceFrame') as string | undefined;

  const data: SketchNodeData = {
    profile: profileStr
      ? JSON.parse(profileStr)
      : { segments: [], closed: false },
    config: configStr
      ? JSON.parse(configStr)
      : {
          mode: 'extrude',
          depth: 50,
          revolveAngle: 360,
          revolveAxis: 'y',
          segments: 32,
        },
    plane: (map.get('plane') as 'xy' | 'xz' | 'yz') ?? 'xy',
    planeOffset: (map.get('planeOffset') as number) ?? 0,
    operation: (map.get('operation') as 'add' | 'subtract') ?? 'add',
  };

  if (constraintsStr) {
    try {
      data.constraints = JSON.parse(constraintsStr);
    } catch {
      /* drop */
    }
  }
  if (dimensionsStr) {
    try {
      data.dimensions = JSON.parse(dimensionsStr);
    } catch {
      /* drop */
    }
  }
  if (faceFrameStr) {
    try {
      data.faceFrame = JSON.parse(faceFrameStr);
    } catch {
      /* drop */
    }
  }

  return data;
}

// ────────────────────────────────────────────────────────────────────────────
// Bulk hydrate / dump
// ────────────────────────────────────────────────────────────────────────────

/** Build a fresh Y.Doc populated from a FeatureHistory + sketches dict.
 *
 *  Each HistoryNode whose `sketchData` is populated is migrated:
 *    - the sketchData entry is moved into the shared `sketches` map keyed
 *      by `nodeId` (or by an explicit override from the `sketches` argument)
 *    - the node's `sketchRef` is set to that key (sketchData is not stored
 *      directly on the node Y.Map).
 *
 *  Passing an explicit `sketches` arg lets callers supply already-extracted
 *  sketch dictionaries (e.g. when loading an .nfab v3+ file that already
 *  has them split out). When `sketches` is omitted we extract from each
 *  node's embedded `sketchData`.
 */
export function featureTreeToYDoc(
  tree: FeatureHistory,
  sketches?: Record<string, SketchNodeData>,
): Y.Doc {
  const doc = new Y.Doc();
  const treeArr = getSharedTree(doc);
  const sketchesMap = getSharedSketches(doc);
  const meta = getSharedMeta(doc);

  doc.transact(() => {
    // 1. Populate sketches map. Explicit arg takes precedence; otherwise harvest
    //    from each node's embedded sketchData.
    const sketchDict: Record<string, SketchNodeData> = { ...(sketches ?? {}) };
    if (!sketches) {
      for (const node of tree.nodes) {
        if (node.sketchData) sketchDict[node.id] = node.sketchData;
      }
    }
    for (const [sid, data] of Object.entries(sketchDict)) {
      sketchesMap.set(sid, sketchDataToYMap(data));
    }

    // 2. Populate tree array in iteration order.
    for (const node of tree.nodes) {
      const ref = sketchDict[node.id] !== undefined ? node.id : undefined;
      treeArr.push([nodeToYMap(node, ref)]);
    }

    // 3. Persist meta pointers.
    meta.set('rootId', tree.rootId);
    meta.set('activeNodeId', tree.activeNodeId);
    meta.set('editingNodeId', tree.editingNodeId);
  });

  return doc;
}

/** Inverse of `featureTreeToYDoc`: read a Y.Doc into a FeatureTreeSnapshot. */
export function yDocToFeatureTree(doc: Y.Doc): FeatureTreeSnapshot {
  const treeArr = getSharedTree(doc);
  const sketchesMap = getSharedSketches(doc);
  const meta = getSharedMeta(doc);

  const sketches: Record<string, SketchNodeData> = {};
  sketchesMap.forEach((value, key) => {
    sketches[key] = ySketchToData(value);
  });

  const nodes: HistoryNode[] = [];
  treeArr.forEach((nodeMap) => {
    nodes.push(yMapToNode(nodeMap, sketchesMap));
  });

  const rootId = (meta.get('rootId') as string) ?? (nodes[0]?.id ?? '');
  const activeNodeId =
    (meta.get('activeNodeId') as string) ?? (nodes[nodes.length - 1]?.id ?? rootId);
  const editingNodeId = (meta.get('editingNodeId') as string | null) ?? null;

  return {
    tree: {
      nodes,
      rootId,
      activeNodeId,
      editingNodeId,
    },
    sketches,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Mutation ops (all wrapped in doc.transact for atomic broadcast)
// ────────────────────────────────────────────────────────────────────────────

export type FeatureOp =
  | { kind: 'addNode'; node: HistoryNode; sketchData?: SketchNodeData; afterId?: string | null }
  | { kind: 'removeNode'; id: string }
  | { kind: 'reorder'; id: string; toIndex: number }
  | { kind: 'updateParams'; id: string; params: Record<string, number> }
  | { kind: 'updateLabel'; id: string; label: string }
  | { kind: 'setEnabled'; id: string; enabled: boolean }
  | { kind: 'setActive'; activeNodeId: string }
  | { kind: 'updateSketch'; sketchId: string; patch: Partial<SketchNodeData> };

/** Linear scan helper — find node Y.Map index by id. Returns -1 when absent. */
function findNodeIndex(arr: FeatureTreeArray, id: string): number {
  for (let i = 0; i < arr.length; i++) {
    if (arr.get(i).get('id') === id) return i;
  }
  return -1;
}

/** Same as findNodeIndex but returns the Y.Map (or null). */
export function findNodeById(arr: FeatureTreeArray, id: string): FeatureNodeMap | null {
  const i = findNodeIndex(arr, id);
  return i === -1 ? null : arr.get(i);
}

/** Apply a single FeatureOp atomically. Returns true on success, false when the
 *  target id wasn't found (no-op semantics — caller can ignore). */
export function applyFeatureOp(doc: Y.Doc, op: FeatureOp): boolean {
  const tree = getSharedTree(doc);
  const sketches = getSharedSketches(doc);
  const meta = getSharedMeta(doc);

  let ok = true;
  doc.transact(() => {
    switch (op.kind) {
      case 'addNode': {
        const ref = op.sketchData ? op.node.id : undefined;
        if (op.sketchData) sketches.set(op.node.id, sketchDataToYMap(op.sketchData));
        const yMap = nodeToYMap(op.node, ref);

        let insertAt = tree.length;
        if (op.afterId) {
          const refIdx = findNodeIndex(tree, op.afterId);
          if (refIdx !== -1) insertAt = refIdx + 1;
        }
        tree.insert(insertAt, [yMap]);

        // Append to parent.children if applicable.
        if (op.node.parentId) {
          const parentMap = findNodeById(tree, op.node.parentId);
          if (parentMap) {
            const childrenArr = parentMap.get('children') as Y.Array<string> | undefined;
            if (childrenArr && !childrenArr.toArray().includes(op.node.id)) {
              childrenArr.push([op.node.id]);
            }
          }
        }
        break;
      }

      case 'removeNode': {
        const idx = findNodeIndex(tree, op.id);
        if (idx === -1) { ok = false; break; }

        // Collect descendants via DFS over the in-doc children arrays so we
        // can clean up referenced sketches too.
        const toRemove = collectSubtree(tree, op.id);

        // Detach from parent.children first (avoid stale references).
        const removedNode = tree.get(idx);
        const parentId = removedNode.get('parentId') as string | null;
        if (parentId) {
          const parentMap = findNodeById(tree, parentId);
          if (parentMap) {
            const childrenArr = parentMap.get('children') as Y.Array<string> | undefined;
            if (childrenArr) {
              const list = childrenArr.toArray();
              const pos = list.indexOf(op.id);
              if (pos !== -1) childrenArr.delete(pos, 1);
            }
          }
        }

        // Delete all collected nodes from the top-level array — work from the
        // end so indices don't shift under us.
        const allIndices: number[] = [];
        for (let i = 0; i < tree.length; i++) {
          const id = tree.get(i).get('id') as string;
          if (toRemove.has(id)) allIndices.push(i);
        }
        allIndices.sort((a, b) => b - a);
        for (const i of allIndices) tree.delete(i, 1);

        // Cascade sketch cleanup — any node with sketchRef into removed set is gone.
        for (const id of toRemove) {
          if (sketches.has(id)) sketches.delete(id);
        }
        break;
      }

      case 'reorder': {
        const fromIdx = findNodeIndex(tree, op.id);
        if (fromIdx === -1) { ok = false; break; }
        // Yjs has no atomic move; delete + insert. The architecture doc §3.4
        // notes this is acceptable for v1 — concurrent reorders of the same
        // node may produce "both survive at slightly different positions",
        // and that's exactly the test we want to characterize.
        const nodeMap = tree.get(fromIdx);
        const cloned = cloneFeatureNodeMap(nodeMap);
        tree.delete(fromIdx, 1);
        const clamped = Math.max(0, Math.min(op.toIndex, tree.length));
        tree.insert(clamped, [cloned]);
        break;
      }

      case 'updateParams': {
        const nodeMap = findNodeById(tree, op.id);
        if (!nodeMap) { ok = false; break; }
        const paramsMap = nodeMap.get('params') as Y.Map<unknown> | undefined;
        if (!paramsMap) { ok = false; break; }
        for (const [k, v] of Object.entries(op.params)) paramsMap.set(k, v);
        break;
      }

      case 'updateLabel': {
        const nodeMap = findNodeById(tree, op.id);
        if (!nodeMap) { ok = false; break; }
        nodeMap.set('label', op.label);
        break;
      }

      case 'setEnabled': {
        const nodeMap = findNodeById(tree, op.id);
        if (!nodeMap) { ok = false; break; }
        nodeMap.set('enabled', op.enabled);
        break;
      }

      case 'setActive': {
        meta.set('activeNodeId', op.activeNodeId);
        break;
      }

      case 'updateSketch': {
        const sketchMap = sketches.get(op.sketchId);
        if (!sketchMap) { ok = false; break; }
        if (op.patch.plane !== undefined) sketchMap.set('plane', op.patch.plane);
        if (op.patch.planeOffset !== undefined) sketchMap.set('planeOffset', op.patch.planeOffset);
        if (op.patch.operation !== undefined) sketchMap.set('operation', op.patch.operation);
        if (op.patch.profile !== undefined) sketchMap.set('profile', JSON.stringify(op.patch.profile));
        if (op.patch.config !== undefined) sketchMap.set('config', JSON.stringify(op.patch.config));
        if (op.patch.constraints !== undefined) sketchMap.set('constraints', JSON.stringify(op.patch.constraints));
        if (op.patch.dimensions !== undefined) sketchMap.set('dimensions', JSON.stringify(op.patch.dimensions));
        if (op.patch.faceFrame !== undefined) sketchMap.set('faceFrame', JSON.stringify(op.patch.faceFrame));
        break;
      }
    }
  }, { source: 'applyFeatureOp' });

  return ok;
}

/** Walk `parentId → children` DFS over the tree array and collect all
 *  descendants (including `rootId` itself). Used by `removeNode` to cascade. */
function collectSubtree(tree: FeatureTreeArray, rootId: string): Set<string> {
  // Build adjacency from current state.
  const childrenOf = new Map<string, string[]>();
  for (let i = 0; i < tree.length; i++) {
    const m = tree.get(i);
    const id = m.get('id') as string;
    const ch = (m.get('children') as Y.Array<string> | undefined)?.toArray() ?? [];
    childrenOf.set(id, ch);
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    const ch = childrenOf.get(id) ?? [];
    for (const c of ch) stack.push(c);
  }
  return out;
}

/** Deep-clone a feature-node Y.Map so it can be re-inserted at a different
 *  position. (Y.Array.insert rejects items already attached elsewhere.) */
function cloneFeatureNodeMap(original: FeatureNodeMap): FeatureNodeMap {
  const clone = new Y.Map<unknown>();
  original.forEach((value, key) => {
    if (value instanceof Y.Map) {
      const inner = new Y.Map<unknown>();
      (value as Y.Map<unknown>).forEach((v, k) => inner.set(k, v));
      clone.set(key, inner);
    } else if (value instanceof Y.Array) {
      const inner = new Y.Array<unknown>();
      const items = (value as Y.Array<unknown>).toArray();
      if (items.length > 0) inner.insert(0, items);
      clone.set(key, inner);
    } else {
      clone.set(key, value);
    }
  });
  return clone;
}

// ────────────────────────────────────────────────────────────────────────────
// Sync helper (mirror of sketchCrdt.syncDocs for symmetry in tests)
// ────────────────────────────────────────────────────────────────────────────

/** Exchange update vectors between two docs. Returns the bytes transferred each way. */
export function syncDocs(a: Y.Doc, b: Y.Doc): { aToB: number; bToA: number } {
  const stateA = Y.encodeStateVector(a);
  const stateB = Y.encodeStateVector(b);
  const updateForB = Y.encodeStateAsUpdate(a, stateB);
  const updateForA = Y.encodeStateAsUpdate(b, stateA);
  Y.applyUpdate(b, updateForB);
  Y.applyUpdate(a, updateForA);
  return { aToB: updateForB.byteLength, bToA: updateForA.byteLength };
}
