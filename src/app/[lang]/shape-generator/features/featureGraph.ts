/**
 * featureGraph.ts — Compiler-level feature tree optimization.
 *
 * Stage-1 pipeline (`pipelineManager`) runs features sequentially +
 * caches results by upstream geometry id. Stage 2 (here) treats the
 * feature tree as a *DAG of operations* and applies compiler-style
 * passes:
 *
 *   - **Dependency analysis** — extract a feature → feature DAG from
 *     references (sketch parent, fillet target edge, mate body, etc).
 *   - **Topological sort** — produce a stable evaluation order;
 *     detect cycles.
 *   - **Parallel scheduler** — partition the DAG into levels;
 *     features at the same level have no inter-dependencies and run
 *     in parallel.
 *   - **Incremental rebuild** — given a change to feature X, mark
 *     all transitive downstream features as dirty + skip clean ones.
 *   - **Feature reordering** — propose a different evaluation order
 *     that preserves dependencies but improves cache locality.
 *   - **Profiler** — per-feature timing → Gantt-style breakdown.
 *   - **Defeature** — auto-detect cosmetic features (fillet/chamfer
 *     under threshold radius) + emit a copy with those suppressed.
 *
 * No Three.js / DOM dependencies — pure DAG math.
 */

export interface FeatureNode {
  id: string;
  /** Type — affects defeature heuristics + ordering preferences. */
  kind: string;
  /** Direct parent feature ids this feature depends on. */
  parentIds: string[];
  /** Numeric parameters (used for "is this cosmetic?" checks). */
  params?: Record<string, number>;
  /** Whether the feature is currently enabled. */
  enabled?: boolean;
}

// ── Dependency analysis ─────────────────────────────────────────

export interface DependencyGraph {
  /** Per-node: ids of features that directly produce its inputs. */
  predecessors: Map<string, Set<string>>;
  /** Per-node: ids of features that consume its output. */
  successors: Map<string, Set<string>>;
}

export function buildGraph(features: FeatureNode[]): DependencyGraph {
  const predecessors = new Map<string, Set<string>>();
  const successors = new Map<string, Set<string>>();
  const valid = new Set(features.map(f => f.id));
  for (const f of features) {
    predecessors.set(f.id, new Set(f.parentIds.filter(p => valid.has(p))));
    if (!successors.has(f.id)) successors.set(f.id, new Set());
  }
  for (const f of features) {
    for (const p of f.parentIds) {
      if (!valid.has(p)) continue;
      if (!successors.has(p)) successors.set(p, new Set());
      successors.get(p)!.add(f.id);
    }
  }
  return { predecessors, successors };
}

// ── Topological sort + cycle detection ──────────────────────────

export interface TopoResult {
  /** Order in which features may be safely evaluated. */
  order: string[];
  /** True when no cycles. */
  acyclic: boolean;
  /** When cyclic, one example cycle (list of ids). */
  cycle?: string[];
}

export function topologicalSort(graph: DependencyGraph): TopoResult {
  const allNodes = new Set([...graph.predecessors.keys(), ...graph.successors.keys()]);
  const inDegree = new Map<string, number>();
  for (const id of allNodes) inDegree.set(id, graph.predecessors.get(id)?.size ?? 0);
  const queue: string[] = [];
  for (const [id, d] of inDegree) if (d === 0) queue.push(id);
  const order: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const next of graph.successors.get(cur) ?? []) {
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== allNodes.size) {
    // Cycle exists — find one example via DFS coloring.
    const cycle = findCycle(graph);
    return { order, acyclic: false, cycle };
  }
  return { order, acyclic: true };
}

function findCycle(graph: DependencyGraph): string[] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of graph.predecessors.keys()) color.set(id, WHITE);
  const stack: string[] = [];

  function dfs(u: string): string[] | null {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of graph.successors.get(u) ?? []) {
      const c = color.get(v) ?? WHITE;
      if (c === WHITE) {
        const r = dfs(v);
        if (r) return r;
      } else if (c === GRAY) {
        // Back edge — extract cycle from stack.
        const startIdx = stack.indexOf(v);
        return stack.slice(startIdx).concat(v);
      }
    }
    color.set(u, BLACK);
    stack.pop();
    return null;
  }

  for (const id of graph.predecessors.keys()) {
    if (color.get(id) === WHITE) {
      const r = dfs(id);
      if (r) return r;
    }
  }
  return [];
}

// ── Parallel scheduler (level partition) ────────────────────────

export interface Level {
  /** Index (0 = root). */
  index: number;
  /** Feature ids at this level — safe to run in parallel. */
  featureIds: string[];
}

export function partitionLevels(graph: DependencyGraph): Level[] {
  const topo = topologicalSort(graph);
  if (!topo.acyclic) return [];
  const level = new Map<string, number>();
  for (const id of topo.order) {
    let maxParentLevel = -1;
    for (const p of graph.predecessors.get(id) ?? []) {
      const pl = level.get(p) ?? 0;
      if (pl > maxParentLevel) maxParentLevel = pl;
    }
    level.set(id, maxParentLevel + 1);
  }
  const byLevel = new Map<number, string[]>();
  for (const [id, l] of level) {
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l)!.push(id);
  }
  const sorted = Array.from(byLevel.entries()).sort((a, b) => a[0] - b[0]);
  return sorted.map(([index, featureIds]) => ({ index, featureIds }));
}

// ── Incremental rebuild ─────────────────────────────────────────

export interface DirtyMarkResult {
  /** Features that need to be re-evaluated. */
  dirtyIds: Set<string>;
  /** Features known to be cached and skipable. */
  cleanIds: Set<string>;
}

/** Given a set of changed feature ids, mark all transitive downstream
 *  features as dirty. Everything else stays clean. */
export function markDirty(graph: DependencyGraph, changedIds: string[]): DirtyMarkResult {
  const dirty = new Set<string>(changedIds);
  const queue = [...changedIds];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of graph.successors.get(cur) ?? []) {
      if (!dirty.has(next)) {
        dirty.add(next);
        queue.push(next);
      }
    }
  }
  const clean = new Set<string>();
  for (const id of graph.predecessors.keys()) {
    if (!dirty.has(id)) clean.add(id);
  }
  return { dirtyIds: dirty, cleanIds: clean };
}

// ── Reordering ──────────────────────────────────────────────────

export interface ReorderProposal {
  /** Feature id to move. */
  featureId: string;
  /** Current position (0-indexed). */
  fromIndex: number;
  /** Proposed new position. */
  toIndex: number;
  /** True when the move is safe (preserves dependency ordering). */
  safe: boolean;
}

/** Check whether moving `featureId` from `fromIndex` to `toIndex`
 *  in the evaluation order preserves all dependencies. */
export function canReorder(
  features: FeatureNode[],
  graph: DependencyGraph,
  featureId: string,
  toIndex: number,
): ReorderProposal {
  const fromIndex = features.findIndex(f => f.id === featureId);
  if (fromIndex < 0) {
    return { featureId, fromIndex: -1, toIndex, safe: false };
  }
  // Build new order in head.
  const reordered = features.slice();
  const [taken] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, taken!);
  // Check every dependency: a predecessor must appear before its successor.
  for (let i = 0; i < reordered.length; i++) {
    const f = reordered[i]!;
    for (const p of graph.predecessors.get(f.id) ?? []) {
      const pIdx = reordered.findIndex(x => x.id === p);
      if (pIdx < 0 || pIdx >= i) {
        return { featureId, fromIndex, toIndex, safe: false };
      }
    }
  }
  return { featureId, fromIndex, toIndex, safe: true };
}

// ── Profiler ────────────────────────────────────────────────────

export interface FeatureTiming {
  featureId: string;
  /** Start time relative to pipeline start (ms). */
  startMs: number;
  /** Duration (ms). */
  durationMs: number;
}

export interface ProfileReport {
  totalDurationMs: number;
  /** Per-feature timings, sorted by start time. */
  timings: FeatureTiming[];
  /** Top-N slowest features. */
  hotspots: FeatureTiming[];
  /** Critical path duration (sum of longest dependency chain). */
  criticalPathMs: number;
  /** Critical path feature ids. */
  criticalPath: string[];
}

export function buildProfileReport(
  timings: FeatureTiming[],
  graph: DependencyGraph,
  hotspotCount: number = 5,
): ProfileReport {
  const sorted = timings.slice().sort((a, b) => a.startMs - b.startMs);
  const total = sorted.length > 0
    ? Math.max(...sorted.map(t => t.startMs + t.durationMs))
    : 0;
  const hotspots = sorted.slice().sort((a, b) => b.durationMs - a.durationMs).slice(0, hotspotCount);
  // Critical path: longest chain in DAG.
  const dur = new Map<string, number>();
  for (const t of timings) dur.set(t.featureId, t.durationMs);
  const longestTo = new Map<string, number>();
  const longestParent = new Map<string, string>();
  const topo = topologicalSort(graph);
  for (const id of topo.order) {
    let longest = 0;
    let parent: string | undefined;
    for (const p of graph.predecessors.get(id) ?? []) {
      const lp = longestTo.get(p) ?? 0;
      if (lp > longest) { longest = lp; parent = p; }
    }
    longestTo.set(id, longest + (dur.get(id) ?? 0));
    if (parent) longestParent.set(id, parent);
  }
  // Find endpoint with max longestTo.
  let endpoint: string | null = null;
  let maxLen = -Infinity;
  for (const [id, l] of longestTo) {
    if (l > maxLen) { maxLen = l; endpoint = id; }
  }
  const path: string[] = [];
  if (endpoint) {
    let cur: string | null = endpoint;
    while (cur) {
      path.unshift(cur);
      cur = longestParent.get(cur) ?? null;
    }
  }
  return {
    totalDurationMs: total,
    timings: sorted,
    hotspots,
    criticalPathMs: maxLen > 0 ? maxLen : 0,
    criticalPath: path,
  };
}

// ── Defeature ───────────────────────────────────────────────────

export interface DefeatureOptions {
  /** Fillets below this radius are suppressed. */
  minFilletRadiusMm: number;
  /** Chamfers below this size are suppressed. */
  minChamferSizeMm: number;
  /** Holes below this diameter are suppressed. */
  minHoleDiameterMm: number;
  /** Keep cosmetic features tagged as 'preserve'. */
  preserveKinds?: string[];
}

export interface DefeatureResult {
  /** Feature ids that should be suppressed for the shared copy. */
  suppressedIds: string[];
  /** Reasons keyed by feature id. */
  reasons: Map<string, string>;
}

/** Identify cosmetic features that should be suppressed when
 *  exporting a "defeatured" version for sharing / IP protection. */
export function defeature(features: FeatureNode[], options: DefeatureOptions): DefeatureResult {
  const suppressed: string[] = [];
  const reasons = new Map<string, string>();
  const preserved = new Set(options.preserveKinds ?? []);

  for (const f of features) {
    if (preserved.has(f.kind)) continue;
    if ((f.kind === 'fillet' || f.kind === 'variableFillet') && f.params?.radius != null && f.params.radius < options.minFilletRadiusMm) {
      suppressed.push(f.id);
      reasons.set(f.id, `Fillet r=${f.params.radius} < ${options.minFilletRadiusMm} threshold`);
      continue;
    }
    if (f.kind === 'chamfer' && f.params?.size != null && f.params.size < options.minChamferSizeMm) {
      suppressed.push(f.id);
      reasons.set(f.id, `Chamfer ${f.params.size} < ${options.minChamferSizeMm} threshold`);
      continue;
    }
    if (f.kind === 'hole' && f.params?.diameter != null && f.params.diameter < options.minHoleDiameterMm) {
      suppressed.push(f.id);
      reasons.set(f.id, `Hole Ø${f.params.diameter} < ${options.minHoleDiameterMm} threshold`);
    }
  }
  return { suppressedIds: suppressed, reasons };
}
