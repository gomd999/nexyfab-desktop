/**
 * profileOfLineTolerance.ts — Evaluate ASME Y14.5 / ISO 1101
 * "profile of a line" GD&T tolerance.
 *
 * Profile of a line constrains a 2-D cross-section of a feature to lie
 * within a bilateral (or unilateral) zone around the nominal curve. We:
 *
 *   1. Sample measured points along the line.
 *   2. For each measured point, find the closest nominal point (curve
 *      sampled densely + linear interpolation between samples).
 *   3. Compute signed deviation (positive = above curve, negative = below).
 *   4. Check that |deviation| ≤ zone/2 (bilateral) or 0 ≤ dev ≤ zone
 *      (unilateral outside) or -zone ≤ dev ≤ 0 (unilateral inside).
 *
 * Reports max deviation, mean, std-dev, pass/fail and which point caused
 * the worst deviation.
 */

export interface NominalCurvePoint { x: number; y: number }
export interface MeasuredPoint { x: number; y: number }

export type ToleranceZoneType = 'bilateral' | 'unilateral-outside' | 'unilateral-inside';

export interface ProfileToleranceInput {
  nominal: NominalCurvePoint[]; // ordered polyline
  measured: MeasuredPoint[];
  toleranceMm: number;
  zoneType: ToleranceZoneType;
}

export interface DeviationEntry {
  measured: MeasuredPoint;
  closestNominal: NominalCurvePoint;
  signedDeviationMm: number;
  withinZone: boolean;
}

export interface ProfileToleranceResult {
  entries: DeviationEntry[];
  maxAbsoluteDeviationMm: number;
  meanDeviationMm: number;
  stdDeviationMm: number;
  passed: boolean;
  worstIndex: number;
  warnings: string[];
}

export function evaluate(input: ProfileToleranceInput): ProfileToleranceResult {
  const warnings: string[] = [];
  if (input.nominal.length < 2) warnings.push('Need at least 2 nominal points.');
  if (input.measured.length === 0) warnings.push('No measured points provided.');
  if (input.toleranceMm <= 0) warnings.push('Tolerance must be positive.');

  const entries: DeviationEntry[] = input.measured.map(m => {
    const proj = closestPointOnPolyline(m, input.nominal);
    const signed = signedDeviation(m, proj.point, proj.normal);
    const withinZone = checkZone(signed, input.toleranceMm, input.zoneType);
    return { measured: m, closestNominal: proj.point, signedDeviationMm: signed, withinZone };
  });

  let maxAbs = 0, sum = 0, worstIdx = -1;
  entries.forEach((e, i) => {
    const a = Math.abs(e.signedDeviationMm);
    sum += e.signedDeviationMm;
    if (a > maxAbs) { maxAbs = a; worstIdx = i; }
  });
  const mean = entries.length ? sum / entries.length : 0;
  const variance = entries.length
    ? entries.reduce((s, e) => s + (e.signedDeviationMm - mean) ** 2, 0) / entries.length
    : 0;
  const std = Math.sqrt(variance);
  const passed = entries.every(e => e.withinZone);

  return {
    entries,
    maxAbsoluteDeviationMm: maxAbs,
    meanDeviationMm: mean,
    stdDeviationMm: std,
    passed,
    worstIndex: worstIdx,
    warnings,
  };
}

function closestPointOnPolyline(
  p: MeasuredPoint,
  poly: NominalCurvePoint[],
): { point: NominalCurvePoint; normal: { nx: number; ny: number } } {
  let bestDist = Infinity;
  let bestPoint: NominalCurvePoint = poly[0]!;
  let bestNormal = { nx: 0, ny: 1 };
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2));
    const px = a.x + t * abx;
    const py = a.y + t * aby;
    const dx = p.x - px;
    const dy = p.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist) {
      bestDist = d2;
      bestPoint = { x: px, y: py };
      const len = Math.sqrt(len2);
      bestNormal = { nx: -aby / len, ny: abx / len };
    }
  }
  return { point: bestPoint, normal: bestNormal };
}

function signedDeviation(measured: MeasuredPoint, projected: NominalCurvePoint, normal: { nx: number; ny: number }): number {
  return (measured.x - projected.x) * normal.nx + (measured.y - projected.y) * normal.ny;
}

function checkZone(signed: number, tol: number, type: ToleranceZoneType): boolean {
  switch (type) {
    case 'bilateral': return Math.abs(signed) <= tol / 2 + 1e-9;
    case 'unilateral-outside': return signed >= -1e-9 && signed <= tol + 1e-9;
    case 'unilateral-inside': return signed >= -tol - 1e-9 && signed <= 1e-9;
  }
}

export function summarize(r: ProfileToleranceResult): {
  passed: boolean;
  maxAbsoluteDeviationMm: number;
  pointCount: number;
} {
  return {
    passed: r.passed,
    maxAbsoluteDeviationMm: r.maxAbsoluteDeviationMm,
    pointCount: r.entries.length,
  };
}
