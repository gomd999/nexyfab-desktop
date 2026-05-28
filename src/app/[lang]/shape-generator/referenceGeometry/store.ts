/**
 * referenceGeometry/store.ts — in-memory Zustand store for `ReferenceNode[]`.
 *
 * Wave 2 Phase 2 Track D Week 2. Stores the live list of reference-geometry
 * nodes (plane / axis / point / csys) authored by the user. The store is
 * scene-state-adjacent: it lives next to (not inside) `sceneStore` so the
 * ref-geom subsystem can be reasoned about without pulling all of scene
 * state into every consumer.
 *
 * Scope (W2):
 *   - In-memory only. No `persist()` middleware — `.nfab` v3 is the
 *     persistence layer (see `io/nfabFormat.ts` and `useNfabFileIO`'s W3
 *     hook-up).
 *   - No scene-state mutations. The store stands alone for now; the W3
 *     sketch-integration pass wires `PlaneRef` consumers into it.
 *   - No CRDT yet. Phase 1 CRDT scaffolding is the target for W3+;
 *     ref-geom currently lives in plain Zustand state.
 *
 * Spec: `docs/wave-2-phase-2-reference-geometry-spec.md` §6.1, §7.2, §13.3.
 *
 * Invariants enforced by the store (rejecting adds returns the previous
 * state untouched and surfaces via the action's boolean return):
 *
 *   1. Node ids are unique. `add()` rejects a duplicate id.
 *   2. `add()` rejects when the node's `dependsOn[]` would close a cycle
 *      against the existing graph. The dep solver's `wouldCreateCycle`
 *      runs as the gate.
 *   3. `update()` recomputes `dependsOn[]` from the patched params (so
 *      the solver stays in sync) and rejects when the new deps would
 *      cycle.
 *   4. `remove()` is non-cascading: downstream nodes keep their stale
 *      `dependsOn[]` pointers and surface as `error: 'parent_missing'`
 *      via the adapter. (Cascade-delete UX is a W3 product call.)
 */

import { create } from 'zustand';
import {
  computeDependsOn,
  type ReferenceNode,
} from './types';
import { buildGraph, wouldCreateCycle } from './depSolver';

export interface ReferenceGeometryState {
  /** Insertion-ordered list. Render order; the dep solver re-orders for
   *  evaluation. The adapter (`useReferenceNodesAdapter`) handles the
   *  toposort so consumers don't have to. */
  nodes: ReferenceNode[];
}

export interface ReferenceGeometryActions {
  /** Insert a new node. Returns `true` on success, `false` when rejected
   *  (duplicate id or cycle). The store is unchanged on rejection. */
  add: (node: ReferenceNode) => boolean;
  /** Patch a node's mutable fields. `params` patches recompute
   *  `dependsOn[]` so the solver stays consistent. Returns false when
   *  the patched node would create a cycle or its id doesn't exist. */
  update: (id: string, patch: Partial<ReferenceNode>) => boolean;
  /** Remove a node by id. No-op when id is unknown. Downstream nodes
   *  are not cascaded — they surface as `parent_missing` later. */
  remove: (id: string) => void;
  /** Drop all nodes. Used on `.nfab` open and on "new project". */
  clear: () => void;
  /** Bulk replace — used by `.nfab` load. Skips the per-node cycle gate
   *  because we assume the file was previously validated, and the loader
   *  runs `findAllCycles` separately on the merged graph. */
  replaceAll: (nodes: readonly ReferenceNode[]) => void;
}

export type ReferenceGeometryStore = ReferenceGeometryState & ReferenceGeometryActions;

/** True when a node with `node.id` already exists in `nodes`. */
function hasId(nodes: readonly ReferenceNode[], id: string): boolean {
  for (const n of nodes) if (n.id === id) return true;
  return false;
}

/** Apply a partial patch to a `ReferenceNode`, narrowing the discriminated
 *  union safely. When `params` is patched, recompute `dependsOn[]` so the
 *  solver stays in sync — see invariant §3 in the file header. */
function applyPatch(node: ReferenceNode, patch: Partial<ReferenceNode>): ReferenceNode {
  // Build a shallow-merged candidate. We cast through `unknown` because
  // the discriminated union requires `kind`/`method`/`params` to agree;
  // callers responsible for keeping them consistent (see test 'kind change rejected').
  const merged = { ...node, ...patch } as ReferenceNode;
  // If params changed, recompute dependsOn from scratch.
  const paramsChanged = 'params' in patch && patch.params !== undefined;
  if (paramsChanged) {
    const deps = computeDependsOn(merged);
    return { ...merged, dependsOn: deps } as ReferenceNode;
  }
  return merged;
}

export const useReferenceGeometryStore = create<ReferenceGeometryStore>((set, get) => ({
  nodes: [],

  add: (node) => {
    const { nodes } = get();
    if (hasId(nodes, node.id)) return false;
    // Cycle gate: would `node.id -> node.dependsOn[]` close a loop against
    // the existing graph? Note: `node` isn't in the graph yet so this is
    // a pure "can I reach myself via the new deps" check.
    const graph = buildGraph(nodes);
    if (wouldCreateCycle(graph, node.id, node.dependsOn)) return false;
    set({ nodes: [...nodes, node] });
    return true;
  },

  update: (id, patch) => {
    const { nodes } = get();
    const idx = nodes.findIndex((n) => n.id === id);
    if (idx < 0) return false;
    const existing = nodes[idx];
    // Disallow `kind` change — that's a fundamentally different node and
    // would break downstream PlaneRef/AxisRef consumers silently.
    if (patch.kind !== undefined && patch.kind !== existing.kind) return false;
    // Disallow `id` change — id is identity; rename the label instead.
    if (patch.id !== undefined && patch.id !== id) return false;
    const next = applyPatch(existing, patch);
    // Cycle gate on the new dependsOn against the rest of the graph.
    const rest = nodes.filter((_, i) => i !== idx);
    const graph = buildGraph(rest);
    if (wouldCreateCycle(graph, id, next.dependsOn)) return false;
    const out = nodes.slice();
    out[idx] = next;
    set({ nodes: out });
    return true;
  },

  remove: (id) => {
    const { nodes } = get();
    const next = nodes.filter((n) => n.id !== id);
    if (next.length === nodes.length) return; // not found, no-op
    set({ nodes: next });
  },

  clear: () => {
    set({ nodes: [] });
  },

  replaceAll: (nodes) => {
    set({ nodes: [...nodes] });
  },
}));

/** Test-only: reset the singleton store between tests. */
export function _resetReferenceGeometryStore(): void {
  useReferenceGeometryStore.setState({ nodes: [] });
}
