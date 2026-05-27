/**
 * gateOptimization.ts — Injection-mold gate location optimization.
 *
 * Stage 1 (`fillSimulation`) simulates flow given a gate. Stage 2
 * (here) answers: *where should the gate go?* The right gate location:
 *
 *   - minimizes max fill time (balanced flow)
 *   - keeps every region within the maximum flow length the polymer
 *     can travel before freezing off
 *   - puts weld lines + air traps in non-critical areas
 *   - avoids gating onto cosmetic surfaces (vestige scar)
 *
 * Algorithm:
 *   1. Sample candidate gate positions across the part surface
 *      (centroids of mesh faces or user-marked points).
 *   2. For each candidate, run a fast geodesic flow estimate
 *      (Dijkstra from gate across the mesh adjacency).
 *   3. Score on: max flow length, flow-length variance, weld-line
 *      penalty (regions where two flow fronts meet), cosmetic
 *      penalty (gate on a user-flagged "show face").
 *   4. Return ranked list — per the project's "단일 점수 ❌" rule
 *      (`feedback_metric_design`), include per-dimension breakdown.
 */

export interface MeshVertex {
  id: number;
  position: [number, number, number];
}

export interface MeshEdge {
  v1: number;
  v2: number;
}

export interface GateMesh {
  vertices: MeshVertex[];
  edges: MeshEdge[];
}

export interface GateCandidate {
  vertexId: number;
  /** True when the user marked this region as "cosmetic" (gate scar
   *  would be visible). */
  isCosmetic?: boolean;
}

export interface GateScore {
  candidateVertexId: number;
  /** Maximum geodesic distance from this gate to any vertex (mm). */
  maxFlowLengthMm: number;
  /** Flow-length variance — lower = more balanced. */
  flowLengthVariance: number;
  /** Estimated number of weld lines (regions where two flow fronts converge). */
  weldLineCount: number;
  /** True if gating here would scar a cosmetic surface. */
  cosmeticConflict: boolean;
  /** Per-dimension scores (0..100). */
  dimensions: {
    flowLength: number;
    balance: number;
    weldLines: number;
    cosmetic: number;
  };
}

/** Dijkstra geodesic from a source vertex across the mesh. Returns
 *  distance to every reachable vertex. */
function geodesicDistances(mesh: GateMesh, source: number): Map<number, number> {
  const adj = new Map<number, Array<{ to: number; weight: number }>>();
  const posById = new Map<number, [number, number, number]>();
  for (const v of mesh.vertices) posById.set(v.id, v.position);
  for (const e of mesh.edges) {
    if (!adj.has(e.v1)) adj.set(e.v1, []);
    if (!adj.has(e.v2)) adj.set(e.v2, []);
    const p1 = posById.get(e.v1);
    const p2 = posById.get(e.v2);
    if (!p1 || !p2) continue;
    const w = Math.hypot(p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]);
    adj.get(e.v1)!.push({ to: e.v2, weight: w });
    adj.get(e.v2)!.push({ to: e.v1, weight: w });
  }

  const dist = new Map<number, number>();
  dist.set(source, 0);
  // Simple priority queue via array + sort. Adequate for sub-10k vert previews.
  const queue: Array<{ v: number; d: number }> = [{ v: source, d: 0 }];
  while (queue.length > 0) {
    queue.sort((a, b) => a.d - b.d);
    const cur = queue.shift()!;
    if (cur.d > (dist.get(cur.v) ?? Infinity)) continue;
    for (const { to, weight } of adj.get(cur.v) ?? []) {
      const nd = cur.d + weight;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        queue.push({ v: to, d: nd });
      }
    }
  }
  return dist;
}

/** Detect weld-line vertices — those where two roughly-equal flow paths
 *  arrive from different directions. We approximate this as vertices
 *  whose nearest neighbours show large directional disagreement. */
function approximateWeldLines(mesh: GateMesh, source: number, dist: Map<number, number>): number {
  const sourcePos = mesh.vertices.find(v => v.id === source)?.position;
  if (!sourcePos) return 0;
  let count = 0;
  const seen = new Set<number>();
  // For each vertex, look at its 2 nearest neighbours via edges. If both
  // are roughly the same distance from source but on opposite sides of
  // the source's normal direction, it's a likely weld-line point.
  const adj = new Map<number, number[]>();
  for (const e of mesh.edges) {
    if (!adj.has(e.v1)) adj.set(e.v1, []);
    if (!adj.has(e.v2)) adj.set(e.v2, []);
    adj.get(e.v1)!.push(e.v2);
    adj.get(e.v2)!.push(e.v1);
  }
  for (const v of mesh.vertices) {
    if (v.id === source) continue;
    const neighbours = adj.get(v.id) ?? [];
    if (neighbours.length < 2) continue;
    const dHere = dist.get(v.id) ?? Infinity;
    for (let i = 0; i < neighbours.length; i++) {
      for (let j = i + 1; j < neighbours.length; j++) {
        const a = neighbours[i]!;
        const b = neighbours[j]!;
        const da = dist.get(a) ?? Infinity;
        const db = dist.get(b) ?? Infinity;
        // Both neighbours have greater distance than v, AND they're
        // nearly equal — typical weld-line pattern.
        if (da > dHere && db > dHere && Math.abs(da - db) < 1 && !seen.has(v.id)) {
          count++;
          seen.add(v.id);
        }
      }
    }
  }
  return count;
}

/** Compute a full score for one gate candidate. */
export function scoreGate(
  mesh: GateMesh,
  candidate: GateCandidate,
  maxFlowLengthBudgetMm: number,
): GateScore {
  const dist = geodesicDistances(mesh, candidate.vertexId);
  const distances = Array.from(dist.values());
  const maxLen = distances.length > 0 ? Math.max(...distances) : 0;
  const meanLen = distances.length > 0 ? distances.reduce((s, d) => s + d, 0) / distances.length : 0;
  const variance = distances.length > 0
    ? distances.reduce((s, d) => s + (d - meanLen) ** 2, 0) / distances.length
    : 0;
  const weldCount = approximateWeldLines(mesh, candidate.vertexId, dist);

  // Dimension scores (0..100).
  const flowLengthScore = maxFlowLengthBudgetMm > 0
    ? Math.max(0, 100 * (1 - maxLen / maxFlowLengthBudgetMm))
    : 50;
  // Lower variance = more balanced. Normalize by mean.
  const balanceScore = meanLen > 0
    ? Math.max(0, 100 * (1 - Math.sqrt(variance) / meanLen))
    : 100;
  // Fewer weld lines = better.
  const weldScore = Math.max(0, 100 - weldCount * 10);
  const cosmeticScore = candidate.isCosmetic ? 0 : 100;

  return {
    candidateVertexId: candidate.vertexId,
    maxFlowLengthMm: maxLen,
    flowLengthVariance: variance,
    weldLineCount: weldCount,
    cosmeticConflict: candidate.isCosmetic === true,
    dimensions: {
      flowLength: flowLengthScore,
      balance: balanceScore,
      weldLines: weldScore,
      cosmetic: cosmeticScore,
    },
  };
}

export interface OptimizationOptions {
  maxFlowLengthBudgetMm?: number;
  weights?: { flowLength?: number; balance?: number; weldLines?: number; cosmetic?: number };
}

export interface OptimizationResult {
  rankings: Array<GateScore & { weightedScore: number }>;
  best: (GateScore & { weightedScore: number }) | null;
}

export function optimizeGate(
  mesh: GateMesh,
  candidates: GateCandidate[],
  options: OptimizationOptions = {},
): OptimizationResult {
  const budget = options.maxFlowLengthBudgetMm ?? 200;
  const weights = {
    flowLength: options.weights?.flowLength ?? 1.0,
    balance: options.weights?.balance ?? 1.0,
    weldLines: options.weights?.weldLines ?? 0.7,
    cosmetic: options.weights?.cosmetic ?? 0.5,
  };
  const wSum = weights.flowLength + weights.balance + weights.weldLines + weights.cosmetic;

  const rankings = candidates.map(c => {
    const s = scoreGate(mesh, c, budget);
    const weighted = (
      s.dimensions.flowLength * weights.flowLength
      + s.dimensions.balance * weights.balance
      + s.dimensions.weldLines * weights.weldLines
      + s.dimensions.cosmetic * weights.cosmetic
    ) / wSum;
    return { ...s, weightedScore: weighted };
  });
  rankings.sort((a, b) => b.weightedScore - a.weightedScore);
  return {
    rankings,
    best: rankings[0] ?? null,
  };
}
