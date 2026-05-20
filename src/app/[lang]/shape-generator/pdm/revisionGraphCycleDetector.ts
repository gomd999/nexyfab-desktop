/**
 * revisionGraphCycleDetector.ts — Detect cycles in a PDM revision
 * graph.
 *
 * PDM revision relationships should form a DAG (directed acyclic
 * graph): each revision derives from one or more parent revisions.
 * Cycles indicate data corruption (rev A "supersedes" rev B which
 * "supersedes" A) and break promote / publish workflows.
 *
 * Module:
 *   - DFS-based cycle detection in O(V+E).
 *   - Reports every cycle as a list of node IDs.
 *   - Suggests minimum edge removal to break cycles (greedy).
 *
 * Used by PDM admin tools, audit reports, and pre-promotion checks.
 */

export interface RevEdge {
  /** Parent revision ID (predecessor). */
  parent: string;
  /** Child revision ID (successor). */
  child: string;
  /** Edge weight: higher = more important to keep. */
  weight?: number;
}

export interface RevGraph {
  nodes: string[];
  edges: RevEdge[];
}

export interface Cycle {
  /** Node IDs in cycle order (loops back to first). */
  nodes: string[];
  /** Edges that compose the cycle. */
  edges: RevEdge[];
}

export interface CycleDetectionResult {
  hasCycles: boolean;
  cycles: Cycle[];
  /** Edges suggested for removal to make graph acyclic. */
  recommendedRemovals: RevEdge[];
}

// ── Top-level entry ────────────────────────────────────────────

export function detectCycles(graph: RevGraph): CycleDetectionResult {
  const adjacency = buildAdjacency(graph);
  const cycles: Cycle[] = [];
  const colour = new Map<string, 'white' | 'grey' | 'black'>();
  const parent = new Map<string, string | null>();
  for (const n of graph.nodes) {
    colour.set(n, 'white');
    parent.set(n, null);
  }

  for (const n of graph.nodes) {
    if (colour.get(n) === 'white') {
      dfsCycles(n, adjacency, colour, parent, cycles, graph.edges);
    }
  }

  const recommendedRemovals = pickEdgesToRemove(cycles);
  return {
    hasCycles: cycles.length > 0,
    cycles,
    recommendedRemovals,
  };
}

function buildAdjacency(graph: RevGraph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n, []);
  for (const e of graph.edges) {
    if (!adj.has(e.parent)) adj.set(e.parent, []);
    adj.get(e.parent)!.push(e.child);
  }
  return adj;
}

function dfsCycles(
  start: string,
  adj: Map<string, string[]>,
  colour: Map<string, 'white' | 'grey' | 'black'>,
  parent: Map<string, string | null>,
  cycles: Cycle[],
  allEdges: RevEdge[],
): void {
  const stack: { node: string; iter: number }[] = [{ node: start, iter: 0 }];
  colour.set(start, 'grey');

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const neighbours = adj.get(frame.node) ?? [];
    if (frame.iter < neighbours.length) {
      const next = neighbours[frame.iter]!;
      frame.iter++;
      const c = colour.get(next);
      if (c === 'white') {
        colour.set(next, 'grey');
        parent.set(next, frame.node);
        stack.push({ node: next, iter: 0 });
      } else if (c === 'grey') {
        // Found a back-edge → cycle from `next` back to `frame.node`.
        cycles.push(reconstructCycle(next, frame.node, parent, allEdges));
      }
    } else {
      colour.set(frame.node, 'black');
      stack.pop();
    }
  }
}

function reconstructCycle(start: string, end: string, parent: Map<string, string | null>, allEdges: RevEdge[]): Cycle {
  const nodes: string[] = [start];
  let cur: string | null = end;
  while (cur !== null && cur !== start) {
    nodes.push(cur);
    cur = parent.get(cur) ?? null;
  }
  nodes.reverse();
  const edges: RevEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const e = allEdges.find(x => x.parent === nodes[i] && x.child === nodes[i + 1]);
    if (e) edges.push(e);
  }
  // Closing edge.
  const closing = allEdges.find(x => x.parent === nodes[nodes.length - 1] && x.child === nodes[0]);
  if (closing) edges.push(closing);
  return { nodes, edges };
}

// ── Edge removal heuristic ────────────────────────────────────

function pickEdgesToRemove(cycles: Cycle[]): RevEdge[] {
  // Greedy: count edge frequency across cycles, pick highest first.
  if (cycles.length === 0) return [];
  const edgeCount = new Map<string, { edge: RevEdge; count: number }>();
  for (const c of cycles) {
    for (const e of c.edges) {
      const key = `${e.parent}->${e.child}`;
      const existing = edgeCount.get(key);
      if (existing) existing.count++;
      else edgeCount.set(key, { edge: e, count: 1 });
    }
  }
  // Sort by count desc, but lowest weight broken first.
  const sorted = Array.from(edgeCount.values()).sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return (a.edge.weight ?? 0) - (b.edge.weight ?? 0);
  });
  const removed: RevEdge[] = [];
  const remainingCycles = cycles.slice();
  for (const { edge } of sorted) {
    if (remainingCycles.length === 0) break;
    removed.push(edge);
    for (let i = remainingCycles.length - 1; i >= 0; i--) {
      if (remainingCycles[i]!.edges.some(e => e.parent === edge.parent && e.child === edge.child)) {
        remainingCycles.splice(i, 1);
      }
    }
  }
  return removed;
}

// ── Topological sort (only if acyclic) ────────────────────────

export function topologicalSort(graph: RevGraph): string[] | null {
  const adj = buildAdjacency(graph);
  const inDegree = new Map<string, number>();
  for (const n of graph.nodes) inDegree.set(n, 0);
  for (const e of graph.edges) {
    inDegree.set(e.child, (inDegree.get(e.child) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [n, d] of inDegree) if (d === 0) queue.push(n);
  const out: string[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    out.push(n);
    for (const m of adj.get(n) ?? []) {
      const d = (inDegree.get(m) ?? 0) - 1;
      inDegree.set(m, d);
      if (d === 0) queue.push(m);
    }
  }
  return out.length === graph.nodes.length ? out : null;
}

// ── Summary ────────────────────────────────────────────────────

export interface CycleSummary {
  nodeCount: number;
  edgeCount: number;
  cycleCount: number;
  largestCycleSize: number;
  recommendedRemovalCount: number;
}

export function summarize(graph: RevGraph, result: CycleDetectionResult): CycleSummary {
  let largest = 0;
  for (const c of result.cycles) if (c.nodes.length > largest) largest = c.nodes.length;
  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    cycleCount: result.cycles.length,
    largestCycleSize: largest,
    recommendedRemovalCount: result.recommendedRemovals.length,
  };
}
