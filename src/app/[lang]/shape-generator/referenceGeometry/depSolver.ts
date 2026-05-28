/**
 * referenceGeometry/depSolver.ts — dependency graph + cycle detection.
 *
 * Wave 2 Phase 2 Track D Week 1. Pure functions over `ReferenceNode[]`.
 * Spec: `docs/wave-2-phase-2-reference-geometry-spec.md` §7.
 *
 * Algorithm choice: **iterative DFS with three-color marking** (white /
 * gray / black, a.k.a. Cormen "DFS-VISIT").
 *
 *   - **Why DFS, not Kahn's BFS:** the UI needs the cycle *path* (a list
 *     of node ids forming the loop), not just a boolean. With DFS coloring
 *     we can reconstruct the exact back-edge cycle by walking the parent
 *     chain from the gray edge's tail back to its head.
 *   - **Why iterative, not recursive:** the worktree's tsconfig has
 *     `strict: true`. With ~100+ refs per part (spec §17 perf target)
 *     recursive DFS bumps against V8's ~10k-frame call stack limit on
 *     pathological dep chains. Iterative stack keeps us bounded.
 *   - **Why not Tarjan's SCC:** Tarjan finds *all* SCCs in one pass which
 *     is overkill — for cycle reporting we only need to surface the first
 *     cycle and let the UI prompt the user to break it. (If two cycles
 *     existed, breaking one and re-running the solver finds the second.)
 *
 * Time: O(V + E). Space: O(V) coloring + O(V) parent map.
 *
 * Spec §7.2 cycle-prevention helper `wouldCreateCycle` is implemented
 * here too (a one-shot reachability check before insertion).
 */

import type { ReferenceNode } from './types';

/** Adjacency map: node id → ids it `dependsOn` (i.e. edges go upstream). */
export type DepGraph = ReadonlyMap<string, readonly string[]>;

/** Build a `DepGraph` from a flat list of `ReferenceNode`. */
export function buildGraph(nodes: readonly ReferenceNode[]): DepGraph {
  const g = new Map<string, readonly string[]>();
  for (const n of nodes) {
    g.set(n.id, n.dependsOn);
  }
  return g;
}

// ─── Topological sort ───────────────────────────────────────────

/** Evaluation-order result. `order` is the topological sort of the
 *  reachable subgraph; when `cycle` is non-null, `order` is partial (the
 *  set of nodes the solver *was* able to order before hitting the cycle)
 *  and the consumer should treat the cycle as fatal. */
export interface ToposortResult {
  /** Topological order, parents before children. Stable: nodes with no
   *  inter-dependencies appear in input order. */
  readonly order: readonly string[];
  /** The first cycle the DFS found, expressed as the closed path
   *  `[a, b, c, ..., a]`. Null when no cycle exists. */
  readonly cycle: readonly string[] | null;
  /** Nodes referenced by a `dependsOn[]` that aren't in the input graph.
   *  Spec §7.4 — these surface as `error: 'parent_missing'` downstream. */
  readonly missing: readonly string[];
}

const enum Color {
  White = 0, // unvisited
  Gray = 1, // on stack
  Black = 2, // fully processed
}

/** Topologically sort the graph. If a cycle exists, returns the closed
 *  cycle path in `cycle` and a *partial* order in `order`. Missing
 *  upstream nodes are reported in `missing`. */
export function toposort(graph: DepGraph): ToposortResult {
  const color = new Map<string, Color>();
  const parent = new Map<string, string | null>();
  const order: string[] = [];
  const missing = new Set<string>();

  // Initialize all nodes as white.
  for (const id of graph.keys()) {
    color.set(id, Color.White);
    parent.set(id, null);
  }

  // Visit nodes in input order for stability.
  for (const start of graph.keys()) {
    if (color.get(start) !== Color.White) continue;
    // Iterative DFS with explicit stack of (node, dep-iterator-index).
    const stack: Array<{ id: string; depIdx: number }> = [];
    stack.push({ id: start, depIdx: 0 });
    color.set(start, Color.Gray);

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const deps = graph.get(top.id) ?? [];

      if (top.depIdx >= deps.length) {
        // All deps processed → mark black and emit.
        color.set(top.id, Color.Black);
        order.push(top.id);
        stack.pop();
        continue;
      }

      const dep = deps[top.depIdx];
      top.depIdx += 1;

      const c = color.get(dep);
      if (c === undefined) {
        // Dep id not in graph → spec §7.4 missing parent. Record and skip.
        missing.add(dep);
        continue;
      }
      if (c === Color.Black) continue; // already emitted; safe to skip
      if (c === Color.Gray) {
        // Back-edge → cycle. Reconstruct path: walk parent chain from
        // top.id back to dep, then close with dep again.
        const cyclePath: string[] = [dep];
        let cursor: string | null = top.id;
        const guard = new Set<string>();
        while (cursor !== null && cursor !== dep && !guard.has(cursor)) {
          cyclePath.push(cursor);
          guard.add(cursor);
          cursor = parent.get(cursor) ?? null;
        }
        if (cursor === dep) cyclePath.push(dep);
        cyclePath.reverse();
        return {
          order,
          cycle: cyclePath,
          missing: [...missing],
        };
      }
      // White → recurse iteratively.
      color.set(dep, Color.Gray);
      parent.set(dep, top.id);
      stack.push({ id: dep, depIdx: 0 });
    }
  }

  return { order, cycle: null, missing: [...missing] };
}

// ─── Cycle prevention (insert / edit dialog gate) ───────────────

/** Spec §7.2. True if adding/replacing `targetId.dependsOn = newDeps`
 *  would introduce a cycle. Run **before** the mutation so the UI can
 *  disable invalid picks.
 *
 *  Implementation: reachability check — can any dep in `newDeps` reach
 *  `targetId` along existing edges? If yes, closing the loop via the new
 *  edge would create a cycle. */
export function wouldCreateCycle(
  graph: DepGraph,
  targetId: string,
  newDeps: readonly string[],
): boolean {
  // Self-loop guard.
  for (const d of newDeps) {
    if (d === targetId) return true;
  }
  // BFS from each new dep, see if we hit targetId.
  const visited = new Set<string>();
  const queue: string[] = [...newDeps];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    if (id === targetId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const deps = graph.get(id) ?? [];
    for (const d of deps) {
      if (!visited.has(d)) queue.push(d);
    }
  }
  return false;
}

// ─── Full graph cycle scan (used on file load + CRDT merge) ─────

/** Return *all* cycles in the graph as a list of closed paths. Used on
 *  `.nfab` load (spec §7.4 — CRDT merge may introduce a cycle that
 *  neither client's `wouldCreateCycle` rejected).
 *
 *  Strategy: run `toposort`; if it finds a cycle, break it by removing
 *  one edge from the cycle, run again, repeat until no cycles remain.
 *  The "broken" edges are reported separately so the caller can apply
 *  the same fix to the persistent graph (spec §7.4 — "break the youngest
 *  edge"). */
export function findAllCycles(graph: DepGraph): {
  cycles: readonly (readonly string[])[];
  /** Edges (from → to) that would need to be removed to break all cycles. */
  brokenEdges: ReadonlyArray<readonly [string, string]>;
} {
  const cycles: Array<readonly string[]> = [];
  const brokenEdges: Array<readonly [string, string]> = [];
  // Work on a mutable copy so we can excise edges.
  const g = new Map<string, string[]>();
  for (const [id, deps] of graph) g.set(id, [...deps]);

  // Hard cap to prevent infinite loops on pathological graphs.
  const maxIter = g.size + 1;
  for (let i = 0; i < maxIter; i += 1) {
    const r = toposort(g);
    if (r.cycle === null) break;
    cycles.push(r.cycle);
    // Break the last edge of the cycle (cycle[n-2] → cycle[n-1] which
    // closes back to cycle[0]). For a cycle [a, b, c, a] we break c → a.
    if (r.cycle.length >= 2) {
      const from = r.cycle[r.cycle.length - 2];
      const to = r.cycle[r.cycle.length - 1];
      const deps = g.get(from);
      if (deps !== undefined) {
        const idx = deps.indexOf(to);
        if (idx >= 0) {
          deps.splice(idx, 1);
          brokenEdges.push([from, to]);
        }
      }
    }
  }

  return { cycles, brokenEdges };
}

// ─── Version stamps (spec §7.3 — lazy re-eval gate) ─────────────

/** Monotonic version produced by `bumpVersion(prev)`. Stored as
 *  `evaluatedAt` on each `ReferenceNode`; the renderer / sketch
 *  consumers compare cached-value version with the solver's current
 *  version to decide whether to re-run the constructor. */
export function bumpVersion(prev: number): number {
  // Guard against the unrealistic 2^53 ceiling: wrap to a non-zero
  // small number which still invalidates any prior cache.
  if (prev >= Number.MAX_SAFE_INTEGER - 1) return 1;
  return prev + 1;
}

// ─── Reverse adjacency (for impact analysis on deletion) ────────

/** Build a downstream map: node id → ids that depend on it. Useful for
 *  spec §7.4 "what breaks if I delete this?" UI and for the CRDT layer
 *  to skip dirty-marking sub-trees that are unaffected. */
export function buildReverseGraph(graph: DepGraph): ReadonlyMap<string, readonly string[]> {
  const rev = new Map<string, string[]>();
  for (const [id, deps] of graph) {
    if (!rev.has(id)) rev.set(id, []);
    for (const d of deps) {
      const existing = rev.get(d);
      if (existing === undefined) rev.set(d, [id]);
      else existing.push(id);
    }
  }
  // Freeze to ReadonlyArrays in the type signature.
  return rev;
}

/** Walk downstream from `rootId`, collecting all ids that transitively
 *  depend on it (BFS over the reverse graph). The root itself is
 *  included. */
export function collectDownstream(
  reverseGraph: ReadonlyMap<string, readonly string[]>,
  rootId: string,
): readonly string[] {
  const out = new Set<string>();
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    if (out.has(id)) continue;
    out.add(id);
    const downstream = reverseGraph.get(id) ?? [];
    for (const d of downstream) {
      if (!out.has(d)) queue.push(d);
    }
  }
  return [...out];
}
