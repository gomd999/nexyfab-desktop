/**
 * cylindricityEvaluator.ts — Evaluate ASME Y14.5 / ISO 1101 cylindricity.
 *
 * Cylindricity constrains a surface to lie between two coaxial cylinders
 * whose radial separation is the tolerance. Unlike circularity (per
 * cross-section) or total runout (referenced to a datum axis),
 * cylindricity is datum-LESS: the reference axis is the best-fit axis of
 * the measured surface itself.
 *
 * Method (least-squares cylinder, simplified):
 *   1. Fit the axis as the line through the centroid in the direction of
 *      least radial variance (assume nominal axis ≈ Z; fit centre offset
 *      + small tilt via least squares on (x,y) vs z).
 *   2. Compute each point's radial distance from the fitted axis.
 *   3. cylindricity = max radius − min radius.
 *
 * Input points carry full 3-D coordinates. We assume the part axis is
 * roughly along +Z and fit centre-line drift cx(z), cy(z) linearly.
 */

export interface Point3D { x: number; y: number; z: number }

export interface CylindricityInput {
  points: Point3D[];
  toleranceMm: number;
}

export interface CylindricityResult {
  cylindricityMm: number;
  fittedRadiusMm: number;
  axisTiltMmPerMm: number; // magnitude of centre-line drift per unit z
  maxRadiusMm: number;
  minRadiusMm: number;
  passed: boolean;
  warnings: string[];
}

export function evaluate(input: CylindricityInput): CylindricityResult {
  const warnings: string[] = [];
  if (input.points.length < 6) warnings.push('Need at least 6 points for a stable cylinder fit.');
  if (input.toleranceMm <= 0) warnings.push('Tolerance must be positive.');

  if (input.points.length === 0) {
    return { cylindricityMm: 0, fittedRadiusMm: 0, axisTiltMmPerMm: 0, maxRadiusMm: 0, minRadiusMm: 0, passed: true, warnings };
  }

  // Fit cx(z) = ax·z + bx and cy(z) = ay·z + by by least squares.
  const { slope: ax, intercept: bx } = linearFit(input.points.map(p => [p.z, p.x]));
  const { slope: ay, intercept: by } = linearFit(input.points.map(p => [p.z, p.y]));

  // Radial distance of each point from the (z-dependent) axis centre.
  let min = Infinity, max = -Infinity, sumR = 0;
  for (const p of input.points) {
    const cx = ax * p.z + bx;
    const cy = ay * p.z + by;
    const r = Math.hypot(p.x - cx, p.y - cy);
    if (r < min) min = r;
    if (r > max) max = r;
    sumR += r;
  }
  const meanR = sumR / input.points.length;
  const cylindricity = max - min;
  const tilt = Math.hypot(ax, ay);

  return {
    cylindricityMm: cylindricity,
    fittedRadiusMm: meanR,
    axisTiltMmPerMm: tilt,
    maxRadiusMm: max,
    minRadiusMm: min,
    passed: cylindricity <= input.toleranceMm + 1e-9,
    warnings,
  };
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
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

/** Decompose cylindricity into roundness (per-section) + straightness (axis) contributions. */
export interface CylindricityDecomposition {
  roundnessMm: number;   // worst per-section circularity
  straightnessMm: number; // axis drift across the z-span
}

export function decompose(input: CylindricityInput, sectionTolMm: number = 1.0): CylindricityDecomposition {
  if (input.points.length === 0) return { roundnessMm: 0, straightnessMm: 0 };
  // Group points by z into bands.
  const zs = input.points.map(p => p.z);
  const zmin = Math.min(...zs), zmax = Math.max(...zs);
  const span = zmax - zmin || 1;
  const bands = Math.max(1, Math.round(span / sectionTolMm));
  const bandPts: Point3D[][] = Array.from({ length: bands }, () => []);
  for (const p of input.points) {
    const idx = Math.min(bands - 1, Math.floor(((p.z - zmin) / span) * bands));
    bandPts[idx]!.push(p);
  }

  let worstRound = 0;
  const centres: { z: number; cx: number; cy: number }[] = [];
  for (const band of bandPts) {
    if (band.length < 3) continue;
    const cx = band.reduce((s, p) => s + p.x, 0) / band.length;
    const cy = band.reduce((s, p) => s + p.y, 0) / band.length;
    let mn = Infinity, mx = -Infinity;
    for (const p of band) {
      const r = Math.hypot(p.x - cx, p.y - cy);
      mn = Math.min(mn, r); mx = Math.max(mx, r);
    }
    worstRound = Math.max(worstRound, mx - mn);
    centres.push({ z: band[0]!.z, cx, cy });
  }

  // Straightness = max deviation of section centres from their mean line.
  let straightness = 0;
  if (centres.length >= 2) {
    const mcx = centres.reduce((s, c) => s + c.cx, 0) / centres.length;
    const mcy = centres.reduce((s, c) => s + c.cy, 0) / centres.length;
    for (const c of centres) {
      straightness = Math.max(straightness, Math.hypot(c.cx - mcx, c.cy - mcy));
    }
    straightness *= 2; // diameter-basis zone
  }

  return { roundnessMm: worstRound, straightnessMm: straightness };
}

export function summarize(r: CylindricityResult): { passed: boolean; cylindricityMm: number; fittedRadiusMm: number } {
  return { passed: r.passed, cylindricityMm: r.cylindricityMm, fittedRadiusMm: r.fittedRadiusMm };
}
