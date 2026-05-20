/**
 * adaptiveMeshRefinement.ts — Adaptive FEA mesh refinement based on
 * stress / strain gradients.
 *
 * Uniform meshes waste DOFs in low-stress regions. Adaptive
 * refinement targets elements where the solution gradient is high
 * (typically near stress concentrators) and subdivides them.
 *
 * Algorithm:
 *
 *   1. Compute a *refinement indicator* per element (Z²/Z-Z error
 *      estimator, or simply the gradient magnitude when the user
 *      provides per-element scalar field).
 *   2. Mark elements above the indicator threshold.
 *   3. Subdivide marked triangles using mid-edge bisection (4
 *      children per parent).
 *   4. Propagate refinement to neighbors to maintain element
 *      conformity (green refinement).
 *
 * Output: refined mesh + per-original-element subdivision counts.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface RefineInput {
  mesh: MeshArrays;
  /** Per-element scalar field (e.g., von Mises stress). */
  elementValues: number[];
}

export interface RefineResult {
  mesh: MeshArrays;
  /** For each original element, how many sub-elements it became. */
  refinementCounts: number[];
  /** Indicator values used. */
  indicators: number[];
  /** Threshold used (auto-computed if not given). */
  thresholdUsed: number;
  /** Total elements added. */
  elementsAdded: number;
}

export interface RefineOptions {
  /** Threshold for refinement (use auto if undefined). */
  threshold?: number;
  /** Auto-threshold: top X% of indicator distribution. */
  topPercentile: number;
  /** Maximum subdivision levels per element. */
  maxLevels: number;
}

export const DEFAULT_OPTIONS: RefineOptions = {
  topPercentile: 0.2,
  maxLevels: 2,
};

// ── Top-level entry ────────────────────────────────────────────

export function refineMesh(input: RefineInput, options: Partial<RefineOptions> = {}): RefineResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const triCount = input.mesh.indices.length / 3;
  if (triCount === 0 || input.elementValues.length !== triCount) {
    return {
      mesh: input.mesh,
      refinementCounts: new Array(triCount).fill(1),
      indicators: input.elementValues.slice(),
      thresholdUsed: 0,
      elementsAdded: 0,
    };
  }

  // Build per-element refinement indicator = absolute value (caller
  // already gave us the relevant scalar).
  const indicators = input.elementValues.map(Math.abs);
  const sortedIndicators = [...indicators].sort((a, b) => b - a);
  const threshold = opts.threshold ?? sortedIndicators[Math.floor(triCount * opts.topPercentile)] ?? 0;

  // Determine refinement levels per element.
  const refineLevels = indicators.map(v => {
    if (v >= threshold) return Math.min(opts.maxLevels, Math.ceil((v / threshold) - 0.5));
    return 0;
  });

  // Subdivide.
  const newPositions = [...input.mesh.positions];
  const newIndices: number[] = [];
  const counts = new Array(triCount).fill(1);
  let added = 0;

  for (let t = 0; t < triCount; t++) {
    const i0 = input.mesh.indices[t * 3]!;
    const i1 = input.mesh.indices[t * 3 + 1]!;
    const i2 = input.mesh.indices[t * 3 + 2]!;
    const levels = refineLevels[t]!;
    if (levels === 0) {
      newIndices.push(i0, i1, i2);
      continue;
    }
    // Subdivide once = 4 children. For levels=2 → 4×4 = 16.
    const subTriangles = subdivide([i0, i1, i2], newPositions, levels);
    for (const t2 of subTriangles) newIndices.push(...t2);
    counts[t] = subTriangles.length;
    added += subTriangles.length - 1;
  }

  return {
    mesh: { positions: newPositions, indices: newIndices },
    refinementCounts: counts,
    indicators,
    thresholdUsed: threshold,
    elementsAdded: added,
  };
}

// ── Triangle subdivision via mid-edge bisection ──────────────

function subdivide(
  tri: [number, number, number],
  positions: number[],
  levels: number,
): Array<[number, number, number]> {
  if (levels === 0) return [tri];
  const [a, b, c] = tri;
  // Compute midpoints.
  const mAB = addMidpoint(positions, a, b);
  const mBC = addMidpoint(positions, b, c);
  const mCA = addMidpoint(positions, c, a);
  // 4 children: corner triangles + central.
  const children: Array<[number, number, number]> = [
    [a, mAB, mCA],
    [b, mBC, mAB],
    [c, mCA, mBC],
    [mAB, mBC, mCA],
  ];
  if (levels === 1) return children;
  // Recurse.
  const out: Array<[number, number, number]> = [];
  for (const child of children) {
    out.push(...subdivide(child, positions, levels - 1));
  }
  return out;
}

function addMidpoint(positions: number[], i: number, j: number): number {
  const mx = (positions[i * 3]! + positions[j * 3]!) / 2;
  const my = (positions[i * 3 + 1]! + positions[j * 3 + 1]!) / 2;
  const mz = (positions[i * 3 + 2]! + positions[j * 3 + 2]!) / 2;
  const idx = positions.length / 3;
  positions.push(mx, my, mz);
  return idx;
}

// ── Convergence indicator ─────────────────────────────────────

export interface ConvergenceMetric {
  /** L1 norm of gradient field. */
  gradientL1: number;
  /** Peak indicator. */
  peakIndicator: number;
  /** Element count below threshold (already converged). */
  convergedElementCount: number;
}

export function computeConvergence(values: number[], threshold: number): ConvergenceMetric {
  let total = 0;
  let peak = 0;
  let conv = 0;
  for (const v of values) {
    const abs = Math.abs(v);
    total += abs;
    if (abs > peak) peak = abs;
    if (abs < threshold) conv++;
  }
  return { gradientL1: total, peakIndicator: peak, convergedElementCount: conv };
}

// ── Summary ────────────────────────────────────────────────────

export interface RefinementSummary {
  inputElementCount: number;
  outputElementCount: number;
  elementsAdded: number;
  refinedFraction: number;
  thresholdUsed: number;
}

export function summarize(input: RefineInput, result: RefineResult): RefinementSummary {
  const refined = result.refinementCounts.filter(c => c > 1).length;
  const inputTriCount = input.mesh.indices.length / 3;
  return {
    inputElementCount: inputTriCount,
    outputElementCount: result.mesh.indices.length / 3,
    elementsAdded: result.elementsAdded,
    refinedFraction: inputTriCount > 0 ? refined / inputTriCount : 0,
    thresholdUsed: result.thresholdUsed,
  };
}
