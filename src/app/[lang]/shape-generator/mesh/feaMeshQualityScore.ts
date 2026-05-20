/**
 * feaMeshQualityScore.ts — Score the quality of a triangle/tet mesh
 * for FEA convergence.
 *
 * Bad mesh quality (slivers, distorted elements, big aspect ratios)
 * makes FEA solvers fail or report spurious stresses. Standard
 * metrics per ANSYS / Abaqus:
 *
 *   - **Aspect ratio**: longest edge / shortest edge.
 *     Ideal ~1; warning > 5; reject > 20.
 *   - **Skewness**: deviation from ideal (equilateral) shape.
 *     0 = perfect; 0.9 = near-degenerate.
 *   - **Jacobian ratio** (for higher-order or 3D elements; for tri
 *     we report area ratio).
 *   - **Min/max angle** in degrees: tri elements should be within
 *     30..90°; angles below 15° are problematic.
 *
 * This module computes per-element scores and aggregates them into
 * a histogram + a single overall mesh quality grade.
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export type QualityGrade = 'excellent' | 'good' | 'acceptable' | 'poor' | 'failing';

export interface ElementScore {
  triangleId: number;
  aspectRatio: number;
  skewness: number;
  minAngleDeg: number;
  maxAngleDeg: number;
  /** 0..1 composite score. */
  quality: number;
  grade: QualityGrade;
}

export interface QualityResult {
  perElement: ElementScore[];
  histogram: Record<QualityGrade, number>;
  overallGrade: QualityGrade;
  /** Average quality across all elements. */
  averageQuality: number;
  /** Worst element index. */
  worstElementId: number;
  /** Fraction of elements rated poor or failing. */
  problemFraction: number;
}

export interface ScoreOptions {
  /** Aspect ratio at which element becomes failing. */
  maxAspectRatio: number;
  /** Skewness above which element becomes failing. */
  maxSkewness: number;
}

export const DEFAULT_OPTIONS: ScoreOptions = {
  maxAspectRatio: 20,
  maxSkewness: 0.9,
};

// ── Top-level entry ────────────────────────────────────────────

export function scoreMeshQuality(mesh: MeshArrays, options: Partial<ScoreOptions> = {}): QualityResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const triCount = mesh.indices.length / 3;
  if (triCount === 0) {
    return {
      perElement: [],
      histogram: { excellent: 0, good: 0, acceptable: 0, poor: 0, failing: 0 },
      overallGrade: 'excellent',
      averageQuality: 1,
      worstElementId: -1,
      problemFraction: 0,
    };
  }

  const scores: ElementScore[] = [];
  let totalQuality = 0;
  let worstIdx = 0;
  let worstQuality = Infinity;
  const histogram: Record<QualityGrade, number> = { excellent: 0, good: 0, acceptable: 0, poor: 0, failing: 0 };

  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const p0 = vertex(mesh, i0);
    const p1 = vertex(mesh, i1);
    const p2 = vertex(mesh, i2);
    const score = computeElementScore(t, p0, p1, p2, opts);
    scores.push(score);
    histogram[score.grade]++;
    totalQuality += score.quality;
    if (score.quality < worstQuality) {
      worstQuality = score.quality;
      worstIdx = t;
    }
  }

  const avg = totalQuality / triCount;
  const problem = (histogram.poor + histogram.failing) / triCount;
  const overallGrade = gradeFromQuality(avg);

  return {
    perElement: scores,
    histogram,
    overallGrade,
    averageQuality: avg,
    worstElementId: worstIdx,
    problemFraction: problem,
  };
}

// ── Per-element scoring ────────────────────────────────────────

function computeElementScore(
  id: number,
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  opts: ScoreOptions,
): ElementScore {
  const e01 = distance(p0, p1);
  const e12 = distance(p1, p2);
  const e20 = distance(p2, p0);
  const minEdge = Math.min(e01, e12, e20);
  const maxEdge = Math.max(e01, e12, e20);
  const aspect = minEdge > 1e-9 ? maxEdge / minEdge : Infinity;

  // Angles via law of cosines: cos(C) = (a² + b² - c²) / 2ab where c is opposite C.
  const angleAtP0 = angleAt(e01, e20, e12);
  const angleAtP1 = angleAt(e01, e12, e20);
  const angleAtP2 = angleAt(e12, e20, e01);
  const angles = [angleAtP0, angleAtP1, angleAtP2];
  const minAngleDeg = Math.min(...angles);
  const maxAngleDeg = Math.max(...angles);

  // Skewness = (60 - minAngle) / 60 for tri elements (equiangular is 60°).
  const skewness = Math.max(0, (60 - minAngleDeg) / 60);

  // Quality scoring: combine aspect + skewness.
  const aspectScore = Math.max(0, 1 - (aspect - 1) / opts.maxAspectRatio);
  const skewScore = Math.max(0, 1 - skewness / opts.maxSkewness);
  const quality = Math.min(aspectScore, skewScore);

  return {
    triangleId: id,
    aspectRatio: aspect,
    skewness,
    minAngleDeg,
    maxAngleDeg,
    quality,
    grade: gradeFromQuality(quality),
  };
}

function gradeFromQuality(q: number): QualityGrade {
  if (q >= 0.9) return 'excellent';
  if (q >= 0.7) return 'good';
  if (q >= 0.5) return 'acceptable';
  if (q >= 0.2) return 'poor';
  return 'failing';
}

// ── Helpers ────────────────────────────────────────────────────

function vertex(mesh: MeshArrays, i: number): [number, number, number] {
  return [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function angleAt(adjA: number, adjB: number, opposite: number): number {
  // Law of cosines.
  if (adjA < 1e-9 || adjB < 1e-9) return 0;
  const cosTheta = (adjA * adjA + adjB * adjB - opposite * opposite) / (2 * adjA * adjB);
  const clamped = Math.max(-1, Math.min(1, cosTheta));
  return (Math.acos(clamped) * 180) / Math.PI;
}

// ── Summary ────────────────────────────────────────────────────

export interface QualitySummary {
  elementCount: number;
  averageQuality: number;
  overallGrade: QualityGrade;
  excellentFraction: number;
  problemFraction: number;
  failingCount: number;
}

export function summarize(result: QualityResult): QualitySummary {
  const total = result.perElement.length;
  return {
    elementCount: total,
    averageQuality: result.averageQuality,
    overallGrade: result.overallGrade,
    excellentFraction: total > 0 ? result.histogram.excellent / total : 0,
    problemFraction: result.problemFraction,
    failingCount: result.histogram.failing,
  };
}
