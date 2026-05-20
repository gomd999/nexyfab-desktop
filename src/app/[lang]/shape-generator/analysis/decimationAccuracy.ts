/**
 * decimationAccuracy.ts — Decimation accuracy regression suite.
 *
 * Mesh decimation (`features/meshDecimation`) accepts a target
 * triangle count. We want to verify that the simplified mesh stays
 * within an accuracy budget at each level. This module:
 *
 *   - Samples points on the reference mesh.
 *   - For each candidate decimated mesh, computes per-LOD accuracy
 *     using point-to-mesh distance.
 *   - Reports Hausdorff-style metrics: max / mean / 95th percentile.
 *   - Detects regressions: if a new run is worse than a baseline.
 *
 * Used by:
 *   - CI gate: "the LOD-2 mesh must not be worse than 0.5 mm Hausdorff
 *     against the reference".
 *   - Adaptive LOD picker: pick the lowest-triangle LOD that fits the
 *     screen-space pixel budget.
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface DecimationLOD {
  /** LOD level id (e.g. "lod-0", "lod-1", ...). */
  id: string;
  /** Triangle count at this level. */
  triangleCount: number;
  /** The decimated mesh. */
  mesh: MeshArrays;
}

export interface AccuracyMetrics {
  lodId: string;
  triangleCount: number;
  /** Max distance from reference samples to decimated mesh (mm). */
  maxDeviationMm: number;
  /** Mean distance (mm). */
  meanDeviationMm: number;
  /** Root-mean-square distance (mm). */
  rmsDeviationMm: number;
  /** 95th percentile distance (mm). */
  p95DeviationMm: number;
}

export interface AccuracyOptions {
  /** Point samples taken on the reference mesh. */
  sampleCount: number;
  /** Random seed. */
  seed?: number;
}

export const DEFAULT_ACCURACY_OPTIONS: AccuracyOptions = {
  sampleCount: 1000,
};

// ── Top-level entry ─────────────────────────────────────────────

export function measureLodAccuracy(reference: MeshArrays, lods: DecimationLOD[], options: Partial<AccuracyOptions> = {}): AccuracyMetrics[] {
  const opts = { ...DEFAULT_ACCURACY_OPTIONS, ...options };
  const samples = sampleSurface(reference, opts.sampleCount, opts.seed);
  return lods.map(lod => {
    const distances = samples.map(p => pointToMeshDistance(p, lod.mesh));
    return {
      lodId: lod.id,
      triangleCount: lod.triangleCount,
      maxDeviationMm: max(distances),
      meanDeviationMm: mean(distances),
      rmsDeviationMm: rms(distances),
      p95DeviationMm: percentile(distances, 95),
    };
  });
}

// ── Regression detection ──────────────────────────────────────

export interface RegressionResult {
  lodId: string;
  /** Diff in maxDeviation (current - baseline). Positive = regression. */
  maxDeviationDeltaMm: number;
  meanDeviationDeltaMm: number;
  /** True if current is significantly worse. */
  isRegression: boolean;
  /** Optional reason text. */
  reason: string;
}

export interface RegressionOptions {
  /** Absolute tolerance (mm) — fail if maxDeviationDelta > this. */
  maxAbsoluteToleranceMm: number;
  /** Relative tolerance — fail if delta > baseline × this. */
  relativeToleranceFraction: number;
}

export const DEFAULT_REGRESSION_OPTIONS: RegressionOptions = {
  maxAbsoluteToleranceMm: 0.1,
  relativeToleranceFraction: 0.15,
};

export function detectRegressions(
  current: AccuracyMetrics[],
  baseline: AccuracyMetrics[],
  options: Partial<RegressionOptions> = {},
): RegressionResult[] {
  const opts = { ...DEFAULT_REGRESSION_OPTIONS, ...options };
  const baselineMap = new Map(baseline.map(b => [b.lodId, b]));
  return current.map(cur => {
    const base = baselineMap.get(cur.lodId);
    if (!base) {
      return {
        lodId: cur.lodId,
        maxDeviationDeltaMm: 0,
        meanDeviationDeltaMm: 0,
        isRegression: false,
        reason: 'No baseline for this LOD',
      };
    }
    const maxDelta = cur.maxDeviationMm - base.maxDeviationMm;
    const meanDelta = cur.meanDeviationMm - base.meanDeviationMm;
    const isRegression =
      maxDelta > opts.maxAbsoluteToleranceMm ||
      maxDelta > base.maxDeviationMm * opts.relativeToleranceFraction;
    return {
      lodId: cur.lodId,
      maxDeviationDeltaMm: maxDelta,
      meanDeviationDeltaMm: meanDelta,
      isRegression,
      reason: isRegression
        ? `Max deviation up ${maxDelta.toFixed(3)}mm (${(maxDelta / base.maxDeviationMm * 100).toFixed(1)}%)`
        : 'Within tolerance',
    };
  });
}

// ── Adaptive LOD picker ──────────────────────────────────────

export interface ScreenContext {
  /** Pixels per mm at the camera distance for this part. */
  pixelsPerMm: number;
  /** Max acceptable pixel error per sample. */
  maxPixelError: number;
}

/** Pick the lowest-triangle LOD that stays within the pixel budget. */
export function pickLod(metrics: AccuracyMetrics[], context: ScreenContext): AccuracyMetrics | null {
  const budgetMm = context.maxPixelError / context.pixelsPerMm;
  const candidates = metrics
    .filter(m => m.maxDeviationMm <= budgetMm)
    .sort((a, b) => a.triangleCount - b.triangleCount);
  return candidates[0] ?? null;
}

// ── Surface sampling ──────────────────────────────────────────

function sampleSurface(mesh: MeshArrays, count: number, seed?: number): [number, number, number][] {
  if (mesh.indices.length === 0 || count === 0) return [];
  const triCount = mesh.indices.length / 3;
  const areas: number[] = [];
  let totalArea = 0;
  for (let t = 0; t < triCount; t++) {
    const a = triangleArea(mesh, t);
    areas.push(a);
    totalArea += a;
  }
  if (totalArea === 0) return [];
  const rng = makeRng(seed);
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const target = rng() * totalArea;
    let acc = 0;
    let tIdx = 0;
    while (tIdx < triCount && acc + areas[tIdx]! < target) {
      acc += areas[tIdx]!;
      tIdx++;
    }
    if (tIdx >= triCount) tIdx = triCount - 1;
    let u = rng(), v = rng();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    const i0 = mesh.indices[tIdx * 3]!;
    const i1 = mesh.indices[tIdx * 3 + 1]!;
    const i2 = mesh.indices[tIdx * 3 + 2]!;
    out.push([
      u * mesh.positions[i0 * 3]! + v * mesh.positions[i1 * 3]! + w * mesh.positions[i2 * 3]!,
      u * mesh.positions[i0 * 3 + 1]! + v * mesh.positions[i1 * 3 + 1]! + w * mesh.positions[i2 * 3 + 1]!,
      u * mesh.positions[i0 * 3 + 2]! + v * mesh.positions[i1 * 3 + 2]! + w * mesh.positions[i2 * 3 + 2]!,
    ]);
  }
  return out;
}

function triangleArea(mesh: MeshArrays, t: number): number {
  const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
  const ax = mesh.positions[i1 * 3]! - mesh.positions[i0 * 3]!;
  const ay = mesh.positions[i1 * 3 + 1]! - mesh.positions[i0 * 3 + 1]!;
  const az = mesh.positions[i1 * 3 + 2]! - mesh.positions[i0 * 3 + 2]!;
  const bx = mesh.positions[i2 * 3]! - mesh.positions[i0 * 3]!;
  const by = mesh.positions[i2 * 3 + 1]! - mesh.positions[i0 * 3 + 1]!;
  const bz = mesh.positions[i2 * 3 + 2]! - mesh.positions[i0 * 3 + 2]!;
  return 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
}

// ── Point-to-mesh distance (linear scan) ──────────────────────

function pointToMeshDistance(p: [number, number, number], mesh: MeshArrays): number {
  const triCount = mesh.indices.length / 3;
  let best = Infinity;
  for (let t = 0; t < triCount; t++) {
    const d = pointToTriangleDistance(p, mesh, t);
    if (d < best) best = d;
  }
  return best;
}

function pointToTriangleDistance(p: [number, number, number], mesh: MeshArrays, t: number): number {
  const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
  const a: [number, number, number] = [mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 1]!, mesh.positions[i0 * 3 + 2]!];
  const b: [number, number, number] = [mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i1 * 3 + 2]!];
  const c: [number, number, number] = [mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 1]!, mesh.positions[i2 * 3 + 2]!];
  // Crude: distance to the nearest vertex; production should use full closest-point-on-triangle.
  const d0 = Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
  const d1 = Math.hypot(p[0] - b[0], p[1] - b[1], p[2] - b[2]);
  const d2 = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
  return Math.min(d0, d1, d2);
}

// ── Stats helpers ─────────────────────────────────────────────

function max(values: number[]): number {
  if (values.length === 0) return 0;
  let m = -Infinity;
  for (const v of values) if (v > m) m = v;
  return m;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function rms(values: number[]): number {
  if (values.length === 0) return 0;
  let sqSum = 0;
  for (const v of values) sqSum += v * v;
  return Math.sqrt(sqSum / values.length);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function makeRng(seed?: number): () => number {
  let s = seed ?? Math.floor(Math.random() * 2 ** 31);
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
