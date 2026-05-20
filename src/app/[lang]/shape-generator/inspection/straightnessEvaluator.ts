/**
 * straightnessEvaluator.ts — Evaluate ASME Y14.5 / ISO 1101 straightness
 * for either:
 *   - a LINE element on a surface (2-D deviations from a best-fit line), or
 *   - a derived MEDIAN-LINE / AXIS of a feature of size (3-D centre-line).
 *
 * Surface-line straightness: project measured points onto a plane, fit
 * the best line, straightness = total spread perpendicular to that line
 * (max − min signed deviation = min-zone width once we use the extreme
 * pair, here approximated by the least-squares line spread).
 *
 * Axis straightness (RFS): the derived axis points (one per section)
 * must lie within a cylindrical tolerance zone of diameter t. We fit the
 * axis line in 3-D and report the diametral zone = 2 × max radial
 * distance of axis points from the fitted line.
 */

export interface Point2D { x: number; y: number }
export interface Point3D { x: number; y: number; z: number }

// ── Surface-line straightness (2-D) ────────────────────────────────

export interface LineStraightnessInput {
  points: Point2D[]; // ordered along the line element
  toleranceMm: number;
}

export interface LineStraightnessResult {
  straightnessMm: number;
  maxDeviationMm: number;
  minDeviationMm: number;
  passed: boolean;
  slope: number;
  intercept: number;
  warnings: string[];
}

export function evaluateLine(input: LineStraightnessInput): LineStraightnessResult {
  const warnings: string[] = [];
  if (input.points.length < 2) warnings.push('Need at least 2 points.');
  if (input.toleranceMm <= 0) warnings.push('Tolerance must be positive.');

  if (input.points.length < 2) {
    return { straightnessMm: 0, maxDeviationMm: 0, minDeviationMm: 0, passed: true, slope: 0, intercept: 0, warnings };
  }

  const { slope, intercept } = linearFit(input.points.map(p => [p.x, p.y]));
  // Perpendicular deviation of each point from the line y = slope·x + intercept.
  const denom = Math.sqrt(1 + slope * slope);
  let max = -Infinity, min = Infinity;
  for (const p of input.points) {
    const d = (p.y - (slope * p.x + intercept)) / denom;
    max = Math.max(max, d);
    min = Math.min(min, d);
  }
  const straightness = max - min;
  return {
    straightnessMm: straightness,
    maxDeviationMm: max,
    minDeviationMm: min,
    passed: straightness <= input.toleranceMm + 1e-9,
    slope,
    intercept,
    warnings,
  };
}

// ── Axis straightness (3-D, diametral zone) ─────────────────────────

export interface AxisStraightnessInput {
  axisPoints: Point3D[]; // one derived centre per section
  toleranceMm: number;   // diametral zone
}

export interface AxisStraightnessResult {
  diametralZoneMm: number;
  maxRadialDeviationMm: number;
  passed: boolean;
  warnings: string[];
}

export function evaluateAxis(input: AxisStraightnessInput): AxisStraightnessResult {
  const warnings: string[] = [];
  if (input.axisPoints.length < 2) warnings.push('Need at least 2 axis points.');
  if (input.axisPoints.length < 2) {
    return { diametralZoneMm: 0, maxRadialDeviationMm: 0, passed: true, warnings };
  }

  // Fit a 3-D line: centroid + direction (PCA-lite via dominant axis assumption).
  const n = input.axisPoints.length;
  const c = {
    x: input.axisPoints.reduce((s, p) => s + p.x, 0) / n,
    y: input.axisPoints.reduce((s, p) => s + p.y, 0) / n,
    z: input.axisPoints.reduce((s, p) => s + p.z, 0) / n,
  };
  // Direction = vector from first to last (good enough for near-straight axes).
  const first = input.axisPoints[0]!;
  const last = input.axisPoints[n - 1]!;
  const dir = normalize3({ x: last.x - first.x, y: last.y - first.y, z: last.z - first.z });

  let maxRadial = 0;
  for (const p of input.axisPoints) {
    const v = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
    const along = v.x * dir.x + v.y * dir.y + v.z * dir.z;
    const perp = {
      x: v.x - along * dir.x,
      y: v.y - along * dir.y,
      z: v.z - along * dir.z,
    };
    maxRadial = Math.max(maxRadial, Math.hypot(perp.x, perp.y, perp.z));
  }
  const diametralZone = 2 * maxRadial;

  return {
    diametralZoneMm: diametralZone,
    maxRadialDeviationMm: maxRadial,
    passed: diametralZone <= input.toleranceMm + 1e-9,
    warnings,
  };
}

function normalize3(v: Point3D): Point3D {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function linearFit(pairs: number[][]): { slope: number; intercept: number } {
  const n = pairs.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? pairs[0]![1]! : 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const pr of pairs) {
    const x = pr[0]!, y = pr[1]!;
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / denom;
  return { slope, intercept: (sy - slope * sx) / n };
}

export function summarizeLine(r: LineStraightnessResult): { passed: boolean; straightnessMm: number } {
  return { passed: r.passed, straightnessMm: r.straightnessMm };
}

export function summarizeAxis(r: AxisStraightnessResult): { passed: boolean; diametralZoneMm: number } {
  return { passed: r.passed, diametralZoneMm: r.diametralZoneMm };
}
