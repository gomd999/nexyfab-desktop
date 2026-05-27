/**
 * dimensionOriginSelector.ts — Pick the optimal dimensioning origin
 * (datum) for ordinate-style dimensions on a drawing.
 *
 * Three common ordinate dimensioning schemes:
 *
 *   1. Baseline: all dimensions from one origin (avoids tolerance
 *      stack-up).
 *   2. Chain: each dimension from the previous (compact but stacks).
 *   3. Combined: hybrid.
 *
 * Module picks the best origin from candidate vertices/features by
 * minimising the maximum lever distance (so each feature is closest
 * to the origin), with secondary criterion of overall annotation
 * "ink" length.
 *
 * The output identifies the origin + the recommended ordinate
 * direction (X-then-Y or independent).
 */

export interface Vec2 { x: number; y: number }

export interface DimFeature {
  id: string;
  point: Vec2;
  /** Whether the feature is "critical" (functional, gets priority). */
  critical: boolean;
}

export interface SelectorOptions {
  /** Weight given to maximum lever (default 0.7) vs total ink (0.3). */
  leverWeight: number;
  /** Restrict origin to feature points; otherwise any (x,y) candidate. */
  restrictToFeatures: boolean;
  /** Number of grid samples per axis when not restricted. */
  gridSamples: number;
}

export const DEFAULT_OPTIONS: SelectorOptions = {
  leverWeight: 0.7,
  restrictToFeatures: true,
  gridSamples: 10,
};

export interface OriginCandidate {
  origin: Vec2;
  maxLever: number;
  totalInk: number;
  score: number;
}

export interface SelectionResult {
  bestOrigin: Vec2;
  rankedCandidates: OriginCandidate[];
  /** Sorted dimension list grouped by axis. */
  xDimensions: { id: string; value: number }[];
  yDimensions: { id: string; value: number }[];
}

// ── Top-level entry ────────────────────────────────────────────

export function selectOrigin(features: DimFeature[], options: Partial<SelectorOptions> = {}): SelectionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (features.length === 0) {
    return { bestOrigin: { x: 0, y: 0 }, rankedCandidates: [], xDimensions: [], yDimensions: [] };
  }

  const candidates: Vec2[] = opts.restrictToFeatures
    ? features.map(f => f.point)
    : gridCandidates(features, opts.gridSamples);

  const scored: OriginCandidate[] = candidates.map(origin => {
    let max = 0;
    let total = 0;
    for (const f of features) {
      const dist = Math.hypot(f.point.x - origin.x, f.point.y - origin.y);
      const weight = f.critical ? 1.5 : 1;
      total += weight * dist;
      if (dist * weight > max) max = dist * weight;
    }
    return { origin, maxLever: max, totalInk: total, score: 0 };
  });
  if (scored.length === 0) return { bestOrigin: { x: 0, y: 0 }, rankedCandidates: [], xDimensions: [], yDimensions: [] };
  // Normalise score: lower = better.
  const maxLever = Math.max(...scored.map(c => c.maxLever));
  const maxInk = Math.max(...scored.map(c => c.totalInk));
  for (const c of scored) {
    const leverNorm = maxLever === 0 ? 0 : c.maxLever / maxLever;
    const inkNorm = maxInk === 0 ? 0 : c.totalInk / maxInk;
    c.score = opts.leverWeight * leverNorm + (1 - opts.leverWeight) * inkNorm;
  }
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0]!.origin;

  const xDims = features.map(f => ({ id: f.id, value: f.point.x - best.x })).sort((a, b) => a.value - b.value);
  const yDims = features.map(f => ({ id: f.id, value: f.point.y - best.y })).sort((a, b) => a.value - b.value);

  return { bestOrigin: best, rankedCandidates: scored, xDimensions: xDims, yDimensions: yDims };
}

function gridCandidates(features: DimFeature[], samples: number): Vec2[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of features) {
    if (f.point.x < minX) minX = f.point.x;
    if (f.point.y < minY) minY = f.point.y;
    if (f.point.x > maxX) maxX = f.point.x;
    if (f.point.y > maxY) maxY = f.point.y;
  }
  const out: Vec2[] = [];
  for (let i = 0; i <= samples; i++) {
    for (let j = 0; j <= samples; j++) {
      out.push({
        x: minX + (maxX - minX) * i / samples,
        y: minY + (maxY - minY) * j / samples,
      });
    }
  }
  return out;
}

// ── Tolerance stack risk ──────────────────────────────────────

export interface StackRisk {
  /** Worst-case ordinate value (largest lever). */
  worstOrdinateMm: number;
  /** Risk score: longer levers = higher tolerance stack. */
  riskLevel: 'low' | 'medium' | 'high';
}

export function evaluateStackRisk(result: SelectionResult): StackRisk {
  const all = [...result.xDimensions, ...result.yDimensions];
  let worst = 0;
  for (const d of all) {
    if (Math.abs(d.value) > worst) worst = Math.abs(d.value);
  }
  let level: 'low' | 'medium' | 'high';
  if (worst < 50) level = 'low';
  else if (worst < 200) level = 'medium';
  else level = 'high';
  return { worstOrdinateMm: worst, riskLevel: level };
}

// ── Dimensioning style recommendation ─────────────────────────

export type DimStyle = 'baseline' | 'chain' | 'combined';

export function recommendStyle(features: DimFeature[]): DimStyle {
  if (features.length <= 3) return 'baseline';
  const criticalCount = features.filter(f => f.critical).length;
  if (criticalCount >= features.length / 2) return 'baseline';
  return 'combined';
}

// ── Summary ────────────────────────────────────────────────────

export interface SelectorSummary {
  bestOrigin: Vec2;
  candidateCount: number;
  xCount: number;
  yCount: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export function summarize(result: SelectionResult): SelectorSummary {
  const risk = evaluateStackRisk(result);
  return {
    bestOrigin: result.bestOrigin,
    candidateCount: result.rankedCandidates.length,
    xCount: result.xDimensions.length,
    yCount: result.yDimensions.length,
    riskLevel: risk.riskLevel,
  };
}
