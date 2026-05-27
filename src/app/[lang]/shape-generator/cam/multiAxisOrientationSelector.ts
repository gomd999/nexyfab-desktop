/**
 * multiAxisOrientationSelector.ts — Recommend a CAM axis count for a
 * given part based on undercut + tilt analysis.
 *
 * Choices and their tradeoffs:
 *
 *   - **3-axis**: only X/Y/Z motion, tool always vertical. Fastest
 *     setup, cheapest machine. Cannot reach undercuts; needs
 *     multiple fixtures for non-planar faces.
 *   - **3+2 (indexed) 4-axis or 5-axis**: machine repositions the
 *     part to N orientations, runs 3-axis at each. Handles
 *     undercuts; one fixture; cycle time dominated by setup.
 *   - **Simultaneous 5-axis**: tool tilts during the cut. Required
 *     for impeller blades and other complex curvature.
 *
 * Heuristic:
 *
 *   - Compute % of triangles that are accessible from a single +Z
 *     tool axis. >95% → 3-axis sufficient.
 *   - Otherwise compute % accessible from a small set (6) of fixed
 *     tilt orientations. >95% → 3+2.
 *   - Else require simultaneous 5-axis.
 *
 * Accessibility test: a triangle is accessible from tool axis A if
 * its surface normal has `dot(normal, A) > 0` AND the projection of
 * the triangle does not collide with other parts of the mesh
 * (geometric occlusion).
 *
 * For the simpler "in the rough" version this module ships, we use
 * the dot test only (omit ray-cast occlusion); the result is a
 * conservative estimate.
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export type AxisStrategy = '3-axis' | '3+2' | 'simultaneous-5-axis';

export interface OrientationCandidate {
  /** Axis label, e.g. "+Z", "+X". */
  label: string;
  /** Tool axis (unit). */
  axis: [number, number, number];
}

export interface SelectorResult {
  /** Recommendation. */
  recommendation: AxisStrategy;
  /** Per-candidate axis accessibility (0..1). */
  perAxisCoverage: Array<{ label: string; coverage: number }>;
  /** Coverage achieved using the best single axis. */
  bestSingleAxisCoverage: number;
  /** Coverage achievable from a fixed set of indexed orientations. */
  indexedSetCoverage: number;
  /** Triangle indices not reachable from any candidate axis. */
  unreachableTriangles: number[];
  /** Total triangle count. */
  triangleCount: number;
}

export interface SelectorOptions {
  /** Coverage above which we consider the strategy sufficient. */
  sufficientCoverage: number;
  /** Custom set of tilt candidates for the 3+2 case. */
  indexedCandidates: OrientationCandidate[];
  /** Cosine tolerance for "accessible" (default 0.05 ≈ 87°). */
  accessibilityCosine: number;
}

export const DEFAULT_OPTIONS: SelectorOptions = {
  sufficientCoverage: 0.95,
  indexedCandidates: [
    { label: '+Z', axis: [0, 0, 1] },
    { label: '-Z', axis: [0, 0, -1] },
    { label: '+X', axis: [1, 0, 0] },
    { label: '-X', axis: [-1, 0, 0] },
    { label: '+Y', axis: [0, 1, 0] },
    { label: '-Y', axis: [0, -1, 0] },
  ],
  accessibilityCosine: 0.05,
};

// ── Top-level entry ────────────────────────────────────────────

export function selectStrategy(mesh: MeshArrays, options: Partial<SelectorOptions> = {}): SelectorResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const triCount = mesh.indices.length / 3;
  if (triCount === 0) {
    return {
      recommendation: '3-axis',
      perAxisCoverage: opts.indexedCandidates.map(c => ({ label: c.label, coverage: 0 })),
      bestSingleAxisCoverage: 0,
      indexedSetCoverage: 0,
      unreachableTriangles: [],
      triangleCount: 0,
    };
  }
  const normals: Array<[number, number, number]> = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const p0 = vertex(mesh, i0);
    const p1 = vertex(mesh, i1);
    const p2 = vertex(mesh, i2);
    normals.push(triangleNormal(p0, p1, p2));
  }

  // Per-axis coverage.
  const accessibilitySet: boolean[][] = opts.indexedCandidates.map(c => {
    return normals.map(n => dot(n, c.axis) > opts.accessibilityCosine);
  });
  const perAxisCoverage = opts.indexedCandidates.map((c, idx) => {
    const reached = accessibilitySet[idx]!.filter(Boolean).length;
    return { label: c.label, coverage: reached / triCount };
  });
  const bestSingle = Math.max(...perAxisCoverage.map(p => p.coverage));

  // Indexed set coverage: union of all candidates.
  const reachedByAny: boolean[] = new Array(triCount).fill(false);
  for (const set of accessibilitySet) {
    for (let i = 0; i < triCount; i++) if (set[i]!) reachedByAny[i] = true;
  }
  const indexedCount = reachedByAny.filter(Boolean).length;
  const indexedCoverage = indexedCount / triCount;
  const unreachable: number[] = [];
  for (let i = 0; i < triCount; i++) if (!reachedByAny[i]!) unreachable.push(i);

  let recommendation: AxisStrategy;
  if (bestSingle >= opts.sufficientCoverage) recommendation = '3-axis';
  else if (indexedCoverage >= opts.sufficientCoverage) recommendation = '3+2';
  else recommendation = 'simultaneous-5-axis';

  return {
    recommendation,
    perAxisCoverage,
    bestSingleAxisCoverage: bestSingle,
    indexedSetCoverage: indexedCoverage,
    unreachableTriangles: unreachable,
    triangleCount: triCount,
  };
}

// ── Cost / time tradeoff ─────────────────────────────────────

export interface StrategyCost {
  setupTimeMin: number;
  machineHourlyUsd: number;
  estimatedCostUsd: number;
}

export function estimateMachineCost(strategy: AxisStrategy, runtimeMin: number): StrategyCost {
  switch (strategy) {
    case '3-axis':
      return { setupTimeMin: 15, machineHourlyUsd: 75, estimatedCostUsd: (15 + runtimeMin) / 60 * 75 };
    case '3+2':
      return { setupTimeMin: 30, machineHourlyUsd: 110, estimatedCostUsd: (30 + runtimeMin) / 60 * 110 };
    case 'simultaneous-5-axis':
      return { setupTimeMin: 45, machineHourlyUsd: 175, estimatedCostUsd: (45 + runtimeMin) / 60 * 175 };
  }
}

// ── Helpers ───────────────────────────────────────────────────

function vertex(mesh: MeshArrays, i: number): [number, number, number] {
  return [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function triangleNormal(p0: [number, number, number], p1: [number, number, number], p2: [number, number, number]): [number, number, number] {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  const len = Math.hypot(cx, cy, cz);
  if (len < 1e-9) return [0, 0, 1];
  return [cx / len, cy / len, cz / len];
}

// ── Summary ────────────────────────────────────────────────────

export interface SelectorSummary {
  recommendation: AxisStrategy;
  unreachableFraction: number;
  bestSingleAxisLabel: string;
  bestSingleAxisCoverage: number;
}

export function summarize(result: SelectorResult): SelectorSummary {
  const best = result.perAxisCoverage.reduce((m, p) => (p.coverage > m.coverage ? p : m), { label: '+Z', coverage: 0 });
  return {
    recommendation: result.recommendation,
    unreachableFraction: result.triangleCount > 0 ? result.unreachableTriangles.length / result.triangleCount : 0,
    bestSingleAxisLabel: best.label,
    bestSingleAxisCoverage: best.coverage,
  };
}
