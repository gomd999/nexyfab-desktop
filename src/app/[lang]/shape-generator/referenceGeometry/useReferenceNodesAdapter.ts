/**
 * referenceGeometry/useReferenceNodesAdapter.ts — read-side hook that
 * combines the live store with the dep solver and surfaces a tidy
 * `(orderedNodes, errors)` shape to downstream consumers.
 *
 * Wave 2 Phase 2 Track D Week 2.
 *
 * Why this lives separately from the store:
 *
 *   - The store (`store.ts`) is a write-side concern — it enforces the
 *     "no duplicate ids" and "no cycles" invariants on insert. It does
 *     NOT need to maintain a sorted view, because the source of truth is
 *     insertion order plus the `dependsOn[]` field on each node.
 *   - The dep solver (`depSolver.ts`) is the read-side concern — given a
 *     flat node list, produce a topo-sorted order and surface any cycles
 *     or missing parents.
 *   - This adapter is the glue: components that render the tree, the
 *     viewport, or sketch consumers all want the *evaluated* view, not
 *     the raw store list. Memoising here keeps each consumer cheap.
 *
 * Spec: `docs/wave-2-phase-2-reference-geometry-spec.md` §7.3, §7.4.
 */

import { useMemo } from 'react';
import { buildGraph, findAllCycles, toposort } from './depSolver';
import type { ReferenceErrorCode, ReferenceNode } from './types';
import { useReferenceGeometryStore } from './store';

/** Per-node error tag. `code` matches `ReferenceNode.error`'s union so
 *  the tree row can colour-code consistently. */
export interface ReferenceNodeIssue {
  readonly nodeId: string;
  readonly code: ReferenceErrorCode;
  /** Optional context — for `parent_missing` the upstream id we couldn't
   *  resolve, for `cycle` the closed loop. */
  readonly detail?: string | readonly string[];
}

export interface ReferenceNodesView {
  /** Topologically sorted view — parents before children. The dep solver
   *  guarantees stability: nodes with no inter-dependency stay in input
   *  order. When a cycle exists, this is the partial order the solver
   *  was able to emit before hitting the back-edge. */
  readonly orderedNodes: readonly ReferenceNode[];
  /** All issues found across the graph. One node may surface multiple
   *  issues (e.g. cycle + parent_missing). Empty when the graph is
   *  healthy. Stable identity per render when nothing changed (memoised). */
  readonly issues: readonly ReferenceNodeIssue[];
  /** Convenience: `true` when at least one cycle exists. */
  readonly hasCycle: boolean;
}

/** Internal: compute the view from a raw `nodes` array. Pure — exported
 *  for unit tests that want to skip the React layer. */
export function computeReferenceNodesView(
  nodes: readonly ReferenceNode[],
): ReferenceNodesView {
  // Empty fast-path.
  if (nodes.length === 0) {
    return { orderedNodes: [], issues: [], hasCycle: false };
  }
  const graph = buildGraph(nodes);
  const t = toposort(graph);
  const allCycles = findAllCycles(graph);

  const idIndex = new Map<string, ReferenceNode>();
  for (const n of nodes) idIndex.set(n.id, n);

  // Reorder by toposort. Topo order may omit nodes that are part of an
  // unbroken cycle — append them so the tree still shows every authored
  // node. (We don't want a cycle to make rows silently vanish.)
  const orderedNodes: ReferenceNode[] = [];
  const emitted = new Set<string>();
  for (const id of t.order) {
    const n = idIndex.get(id);
    if (n !== undefined) {
      orderedNodes.push(n);
      emitted.add(id);
    }
  }
  for (const n of nodes) {
    if (!emitted.has(n.id)) orderedNodes.push(n);
  }

  // Collect issues. Map by id so we can attach multiple issues to one
  // node without duplicating the row entry.
  const issues: ReferenceNodeIssue[] = [];

  // 1. missing parents — surface one issue per (node, missing-id) pair.
  if (t.missing.length > 0) {
    const missingSet = new Set(t.missing);
    for (const n of nodes) {
      for (const dep of n.dependsOn) {
        if (missingSet.has(dep)) {
          issues.push({ nodeId: n.id, code: 'parent_missing', detail: dep });
        }
      }
    }
  }

  // 2. cycles — one issue per node that participates in any cycle, with
  // the cycle path as `detail`. We use `findAllCycles` to cover the case
  // where the user has two independent cycles in the graph.
  if (allCycles.cycles.length > 0) {
    for (const cycle of allCycles.cycles) {
      // `cycle` is a closed path `[a, b, ..., a]`; we attach the issue
      // to every node along it except the trailing duplicate.
      const seen = new Set<string>();
      for (let i = 0; i < cycle.length - 1; i += 1) {
        const id = cycle[i];
        if (seen.has(id)) continue;
        seen.add(id);
        if (idIndex.has(id)) {
          issues.push({ nodeId: id, code: 'cycle', detail: cycle });
        }
      }
    }
  }

  return {
    orderedNodes,
    issues,
    hasCycle: allCycles.cycles.length > 0,
  };
}

/** React hook — subscribes to the ref-geom store and returns the
 *  memoised view. Re-runs only when the node list reference changes
 *  (Zustand provides a stable reference until `set()` is called). */
export function useReferenceNodesAdapter(): ReferenceNodesView {
  const nodes = useReferenceGeometryStore((s) => s.nodes);
  return useMemo(() => computeReferenceNodesView(nodes), [nodes]);
}
