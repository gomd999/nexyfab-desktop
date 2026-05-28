/**
 * refGeomYjs.ts — Wave 2 Phase 3 Week 4 Track Z4.
 *
 * Y.Doc-backed CRDT layer for `ReferenceNode[]`. The D3b deferral from
 * Phase 2 lands here: ref-geom finally gets multi-peer awareness via a
 * Yjs sub-tree, while the existing Zustand `store.ts` stays the !v2
 * default. This file mirrors the `collab/sketchYjs.ts` (Phase 1 W2) and
 * `configurations/configStoreYjs.ts` (Phase 2 A5) patterns so consumers
 * have one mental model across all three CRDT sub-trees.
 *
 * Y.Doc structure:
 *
 *   Y.Doc
 *   └── referenceGeometry: Y.Map<nodeId, Y.Map>           ← top-level keyed-by-id
 *         └── (one ref-geom node Y.Map) {
 *               id:       string,
 *               kind:     'plane' | 'axis' | 'point' | 'csys',
 *               method:   string,                          ← method discriminant
 *               label:    string,
 *               hidden:   boolean,
 *               params:   string  (JSON-LWW, atomic per-method params),
 *               // computed deps (dependsOn) is derived; not stored
 *             }
 *
 * **Why keyed-by-id Y.Map over Y.Array**:
 *   - Ref-geom has no inherent order. The dep solver iterates by id-set.
 *   - Y.Array forces a position; two peers adding the same id concurrently
 *     dedupe poorly. With Y.Map<id, _>, "add" is set(id, _) and merges
 *     are by-key (per-id LWW for the same id, both kept for different ids).
 *   - Mirror of the sketchYjs.ts:18-26 reasoning.
 *
 * **Why JSON-LWW for `params`** (not per-property Y.Map):
 *   - Ref-geom method params (PlaneRef's `byCoordinates` origin + normal,
 *     PointParams_Through3Points's 3 PointRefs, ...) are atomic
 *     geometric units. Two users editing different components of the same
 *     plane's origin without coordination produces a plane neither user
 *     intended; LWW is the correct semantic match. (Mirror of the same
 *     reasoning in sketchYjs.ts:27-32 for `points`/`knots`/`weights`.)
 *   - The flat-per-key Y.Map design from configStoreYjs.ts A5 only makes
 *     sense for *independent* keys (separate feature param values, for
 *     example). Ref-geom params are a discriminated union — the `method`
 *     field is the discriminant for the rest of the shape, so a flattened
 *     per-key Y.Map would smear the union types across versions and lose
 *     soundness on merge.
 *   - `dependsOn[]` is derived from params (via `computeDependsOn`); we
 *     re-derive on every read so peer-side cycle detection sees the live
 *     graph (see §6 of the Z4 spec).
 *
 * **Cycle detection on merge** (Z4 §6): peer A adds X depending on Y;
 * peer B concurrently adds Y depending on X. Both ops apply LWW locally
 * (no cycle when each peer evaluates). On sync, the merged graph has a
 * cycle. Solution: every Y update fires `useRefGeomCycleWarning` (see
 * `useRefGeomStore.ts`) which runs `findAllCycles`. The UI banners the
 * cycle; we do NOT auto-break (would lose user intent — user manually
 * edits one of the deps to resolve).
 *
 * All mutating ops route through `applyRefGeomOp`, which wraps each op
 * in exactly one `doc.transact()` block. Origins follow the same
 * convention as sketchYjs.ts.
 */

import * as Y from 'yjs';
import {
  computeDependsOn,
  type ReferenceNode,
  type ReferenceKind,
} from './types';

// ─── Shared keys ───────────────────────────────────────────────────────────

const REF_GEOM_ROOT_KEY = 'referenceGeometry';

const NODE_FIELDS = {
  id: 'id',
  kind: 'kind',
  method: 'method',
  label: 'label',
  hidden: 'hidden',
  /** JSON-encoded `ReferenceNode.params` (discriminated union). LWW. */
  params: 'params',
  /** Spec §7.3 — monotonic version stamp. Stored so peers can compare. */
  evaluatedAt: 'evaluatedAt',
  /** Optional error code from local evaluation (parent_missing / cycle / ...). */
  error: 'error',
} as const;

// ─── Origins (mirror sketchYjs.ts §3.2) ────────────────────────────────────

export const ORIGIN_LOCAL_UI = 'local-ui';
export const ORIGIN_REMOTE_UPDATE = 'remote-update';
export const ORIGIN_IMPORT_NFAB = 'import-nfab';
export const ORIGIN_GC = 'gc';

export type RefGeomOpOrigin =
  | typeof ORIGIN_LOCAL_UI
  | typeof ORIGIN_REMOTE_UPDATE
  | typeof ORIGIN_IMPORT_NFAB
  | typeof ORIGIN_GC;

// ─── Op union — every mutation goes through one of these ──────────────────

export type RefGeomOp =
  | { kind: 'addNode'; node: ReferenceNode }
  | { kind: 'removeNode'; nodeId: string }
  | { kind: 'updateNode'; nodeId: string; patch: Partial<ReferenceNode> }
  | { kind: 'renameNode'; nodeId: string; name: string };

// ─── Encoders / decoders ───────────────────────────────────────────────────

function referenceNodeToYMap(node: ReferenceNode): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set(NODE_FIELDS.id, node.id);
  m.set(NODE_FIELDS.kind, node.kind);
  m.set(NODE_FIELDS.method, node.method);
  m.set(NODE_FIELDS.label, node.label);
  m.set(NODE_FIELDS.hidden, node.hidden);
  m.set(NODE_FIELDS.params, JSON.stringify(node.params));
  m.set(NODE_FIELDS.evaluatedAt, node.evaluatedAt);
  if (node.error !== undefined) m.set(NODE_FIELDS.error, node.error);
  return m;
}

function yMapToReferenceNode(m: Y.Map<unknown>): ReferenceNode {
  const id = (m.get(NODE_FIELDS.id) as string) ?? '';
  const kind = (m.get(NODE_FIELDS.kind) as ReferenceKind) ?? 'plane';
  const method = (m.get(NODE_FIELDS.method) as string) ?? 'standard';
  const label = (m.get(NODE_FIELDS.label) as string) ?? id;
  const hidden = (m.get(NODE_FIELDS.hidden) as boolean) ?? false;
  const paramsJson = (m.get(NODE_FIELDS.params) as string) ?? '{}';
  const params = JSON.parse(paramsJson) as ReferenceNode['params'];
  const evaluatedAt = (m.get(NODE_FIELDS.evaluatedAt) as number) ?? 0;
  const error = m.get(NODE_FIELDS.error) as ReferenceNode['error'];

  // Re-derive dependsOn from params so the live graph is always in sync
  // with what's on the wire. (See file header §"Cycle detection on merge".)
  // We assemble a partial node first, then compute deps from it.
  const partial = { id, kind, method, label, hidden, params, evaluatedAt } as Omit<ReferenceNode, 'dependsOn'>;
  const dependsOn = computeDependsOn(partial as Parameters<typeof computeDependsOn>[0]);

  const out: ReferenceNode = {
    ...(partial as ReferenceNode),
    dependsOn,
  } as ReferenceNode;
  if (error !== undefined) {
    return { ...out, error } as ReferenceNode;
  }
  return out;
}

// ─── Public accessors ──────────────────────────────────────────────────────

/** Get (creating if needed) the shared `referenceGeometry` Y.Map root.
 *  Each entry is one ref-geom node keyed by node id. */
export function getRefGeomRoot(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(REF_GEOM_ROOT_KEY);
}

/** Look up the Y.Map for a single ref-geom node (or null). */
export function getRefGeomNodeYMap(doc: Y.Doc, nodeId: string): Y.Map<unknown> | null {
  const root = getRefGeomRoot(doc);
  return root.get(nodeId) ?? null;
}

/** Snapshot one ref-geom node as a plain `ReferenceNode` (or null when
 *  not present). */
export function readReferenceNode(doc: Y.Doc, nodeId: string): ReferenceNode | null {
  const m = getRefGeomNodeYMap(doc, nodeId);
  return m ? yMapToReferenceNode(m) : null;
}

/** Snapshot every ref-geom node as a `Map<nodeId, ReferenceNode>`.
 *
 *  Iteration is over the underlying Y.Map; insertion order is preserved
 *  by Yjs's struct-store. Use `readAllReferenceNodesArray` when callers
 *  want the array order (typically rendering). */
export function readAllReferenceNodes(doc: Y.Doc): Map<string, ReferenceNode> {
  const out = new Map<string, ReferenceNode>();
  getRefGeomRoot(doc).forEach((m, id) => {
    out.set(id, yMapToReferenceNode(m));
  });
  return out;
}

/** Same as `readAllReferenceNodes` but returns an insertion-ordered array.
 *  This is what the host UI consumes. */
export function readAllReferenceNodesArray(doc: Y.Doc): ReferenceNode[] {
  const out: ReferenceNode[] = [];
  getRefGeomRoot(doc).forEach((m) => {
    out.push(yMapToReferenceNode(m));
  });
  return out;
}

// ─── Mutation API — applyRefGeomOp ────────────────────────────────────────

export interface ApplyOpResult {
  applied: boolean;
  notes?: string;
}

/** Apply one ref-geom op to the doc inside a single transact() block.
 *
 *  Returns:
 *   - `applied`: true if the op landed; false if it was a no-op
 *     (e.g. updateNode for an id that doesn't exist on this peer yet).
 *   - `notes`: human-readable explanation on slow paths.
 *
 *  Notably this layer does NOT enforce cycle prevention. Per the Z4 spec
 *  §6, peer A adding X→Y and peer B adding Y→X concurrently is a valid
 *  CRDT state — each peer's local `wouldCreateCycle` check passes. The
 *  cycle only emerges on merge. The integration layer (`useRefGeomStore`)
 *  runs `findAllCycles` after every Y update and surfaces a banner.
 */
export function applyRefGeomOp(
  doc: Y.Doc,
  op: RefGeomOp,
  origin: RefGeomOpOrigin = ORIGIN_LOCAL_UI,
): ApplyOpResult {
  let result: ApplyOpResult = { applied: false };
  doc.transact(() => {
    result = applyOpInner(doc, op);
  }, origin);
  return result;
}

function applyOpInner(doc: Y.Doc, op: RefGeomOp): ApplyOpResult {
  const root = getRefGeomRoot(doc);

  switch (op.kind) {
    case 'addNode': {
      if (!op.node.id) {
        throw new Error('[refGeomYjs] addNode requires node.id');
      }
      // Overwrites any prior node under that id — caller is responsible
      // for not colliding ids. For collab, two peers creating the same
      // nodeId would be a UI bug; the second create LWW-wins on whichever
      // peer's transact reaches the merge last (same as sketchYjs.ts §417).
      root.set(op.node.id, referenceNodeToYMap(op.node));
      return { applied: true };
    }

    case 'removeNode': {
      if (!root.has(op.nodeId)) return { applied: false };
      root.delete(op.nodeId);
      // We intentionally do NOT cascade-delete downstream nodes that
      // reference this node. They surface as `error: 'parent_missing'`
      // via the evaluator (spec §7.4). This matches the existing Zustand
      // `store.ts:remove()` behaviour — invariant §4 in the store header.
      return { applied: true };
    }

    case 'updateNode': {
      const nodeMap = root.get(op.nodeId);
      if (!nodeMap) return { applied: false, notes: 'node not found' };
      const patch = op.patch;
      // Disallow `kind` change here too — same reason as the Zustand store
      // (would break downstream PlaneRef/AxisRef consumers silently).
      if (patch.kind !== undefined) {
        const existingKind = nodeMap.get(NODE_FIELDS.kind);
        if (patch.kind !== existingKind) {
          return { applied: false, notes: 'kind change rejected' };
        }
      }
      // Disallow `id` change — id is identity; use renameNode for label.
      if (patch.id !== undefined && patch.id !== op.nodeId) {
        return { applied: false, notes: 'id change rejected' };
      }
      // Apply patch — per-field LWW at the Y.Map level. Two peers updating
      // the same field on the same node converge by Yjs clock. `params`
      // is JSON-LWW (the whole blob replaces atomically), see file header.
      if (patch.method !== undefined) nodeMap.set(NODE_FIELDS.method, patch.method);
      if (patch.label !== undefined) nodeMap.set(NODE_FIELDS.label, patch.label);
      if (patch.hidden !== undefined) nodeMap.set(NODE_FIELDS.hidden, patch.hidden);
      if (patch.params !== undefined) nodeMap.set(NODE_FIELDS.params, JSON.stringify(patch.params));
      if (patch.evaluatedAt !== undefined) nodeMap.set(NODE_FIELDS.evaluatedAt, patch.evaluatedAt);
      if (patch.error !== undefined) nodeMap.set(NODE_FIELDS.error, patch.error);
      return { applied: true };
    }

    case 'renameNode': {
      const nodeMap = root.get(op.nodeId);
      if (!nodeMap) return { applied: false, notes: 'node not found' };
      nodeMap.set(NODE_FIELDS.label, op.name);
      return { applied: true };
    }

    default: {
      // Exhaustiveness check — TS errors if a new variant is added without
      // a corresponding case.
      const _never: never = op;
      void _never;
      return { applied: false };
    }
  }
}

// ─── Bulk population (migrate / .nfab load) ────────────────────────────────

/** Bulk-write all nodes into the doc in one transact. Used by the local→
 *  collab migrate path and by `.nfab` import. */
export function populateRefGeomDoc(
  doc: Y.Doc,
  nodes: readonly ReferenceNode[],
  origin: RefGeomOpOrigin = ORIGIN_LOCAL_UI,
): void {
  doc.transact(() => {
    const root = getRefGeomRoot(doc);
    for (const n of nodes) {
      root.set(n.id, referenceNodeToYMap(n));
    }
  }, origin);
}

/** Clear all ref-geom nodes from the doc. Used on "new project". */
export function clearRefGeomDoc(doc: Y.Doc, origin: RefGeomOpOrigin = ORIGIN_LOCAL_UI): void {
  doc.transact(() => {
    const root = getRefGeomRoot(doc);
    const ids: string[] = [];
    root.forEach((_, id) => ids.push(id));
    for (const id of ids) root.delete(id);
  }, origin);
}

// ─── Sync helper (mirrors sketchYjs.ts:syncDocs for test convenience) ─────

/** Exchange Yjs state vectors between two docs. Returns byte counts in
 *  each direction. */
export function syncDocs(a: Y.Doc, b: Y.Doc): { aToB: number; bToA: number } {
  const stateA = Y.encodeStateVector(a);
  const stateB = Y.encodeStateVector(b);
  const updateForB = Y.encodeStateAsUpdate(a, stateB);
  const updateForA = Y.encodeStateAsUpdate(b, stateA);
  Y.applyUpdate(b, updateForB, ORIGIN_REMOTE_UPDATE);
  Y.applyUpdate(a, updateForA, ORIGIN_REMOTE_UPDATE);
  return { aToB: updateForB.byteLength, bToA: updateForA.byteLength };
}

// ─── Equality helper for round-trip tests ──────────────────────────────────

/** Order-insensitive deep-ish equality for two `ReferenceNode[]`. Mirror
 *  of `sketchesEqual` (sketchYjs.ts:684). Compares nodes as an id-keyed
 *  set, with each node's fields stringified canonically. */
export function referenceNodesEqual(
  a: readonly ReferenceNode[],
  b: readonly ReferenceNode[],
): boolean {
  if (a.length !== b.length) return false;
  const aMap = new Map(a.map((n) => [n.id, canonicalJson(n)]));
  const bMap = new Map(b.map((n) => [n.id, canonicalJson(n)]));
  if (aMap.size !== bMap.size) return false;
  for (const [k, v] of aMap) {
    if (bMap.get(k) !== v) return false;
  }
  return true;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}
