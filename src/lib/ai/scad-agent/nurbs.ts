/**
 * Z7 — NURBS curve + surface continuity helpers.
 *
 * For turbine-blade-grade surfaces, sweep/loft alone isn't enough — you
 * need control over continuity between adjacent patches. C0 = touching,
 * C1 = same tangent, C2 = same curvature, G2 = same curvature direction
 * (parameterization-independent). G2 is the visual "smooth" most CAD
 * users mean when they say "no kinks".
 *
 * This module is NOT a full NURBS kernel — replicad/OCCT remain the
 * geometry source of truth. It's the analysis layer: given two curves
 * sharing an endpoint (or two surfaces sharing an edge), measure the
 * continuity class and report what's needed to upgrade C1→G2.
 *
 * Coordinate convention: 3D points as [x, y, z]; knot vectors clamped
 * + uniform unless specified; degree fixed at 3 (cubic) since that's
 * the universal default for class-A surfaces.
 */

export type Vec3 = [number, number, number];

export interface NurbsCurve {
  degree: number;            // 3 for cubic (typical)
  controlPoints: Vec3[];     // length = knots.length - degree - 1
  weights: number[];         // length = controlPoints.length; 1.0 for B-spline
  knots: number[];           // clamped: [0,0,0,0, ..., 1,1,1,1] for cubic
}

// ─── Vector ops (compact, internal) ───────────────────────────────────────

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
const normalize = (a: Vec3): Vec3 => {
  const n = norm(a);
  if (n < 1e-12) return [0, 0, 0];
  return scale(a, 1 / n);
};

// ─── B-spline basis (Cox-de Boor, simplified for cubic clamped) ────────────

/** Find the knot span s.t. knots[i] ≤ u < knots[i+1]. */
function findSpan(u: number, knots: number[], degree: number): number {
  const n = knots.length - degree - 2;
  if (u >= knots[n + 1]) return n;
  let low = degree;
  let high = n + 1;
  let mid = (low + high) >> 1;
  while (u < knots[mid] || u >= knots[mid + 1]) {
    if (u < knots[mid]) high = mid;
    else low = mid;
    mid = (low + high) >> 1;
  }
  return mid;
}

/** Cox-de Boor basis function values N[0..degree] at u for span i. */
function basisFunctions(i: number, u: number, knots: number[], degree: number): number[] {
  const N: number[] = [1];
  const left: number[] = new Array(degree + 1).fill(0);
  const right: number[] = new Array(degree + 1).fill(0);
  for (let j = 1; j <= degree; j++) {
    left[j] = u - knots[i + 1 - j];
    right[j] = knots[i + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const denom = right[r + 1] + left[j - r];
      const temp = denom === 0 ? 0 : N[r] / denom;
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
  return N;
}

/** Evaluate a NURBS curve at parameter u ∈ [knots[degree], knots[knots.length-degree-1]]. */
export function evaluateCurve(curve: NurbsCurve, u: number): Vec3 {
  const i = findSpan(u, curve.knots, curve.degree);
  const N = basisFunctions(i, u, curve.knots, curve.degree);
  // Rational evaluation: sum(N_j * w_j * P_j) / sum(N_j * w_j)
  let num: Vec3 = [0, 0, 0];
  let den = 0;
  for (let j = 0; j <= curve.degree; j++) {
    const idx = i - curve.degree + j;
    const w = curve.weights[idx];
    const p = curve.controlPoints[idx];
    const wN = N[j] * w;
    num = add(num, scale(p, wN));
    den += wN;
  }
  if (den === 0) return [0, 0, 0];
  return scale(num, 1 / den);
}

/** Approximate first derivative via finite differences — adequate for
 *  continuity classification at endpoints (the only place we need it). */
export function curveDerivative(curve: NurbsCurve, u: number, eps = 1e-4): Vec3 {
  const uMin = curve.knots[curve.degree];
  const uMax = curve.knots[curve.knots.length - curve.degree - 1];
  const uA = Math.max(uMin, Math.min(uMax, u - eps));
  const uB = Math.max(uMin, Math.min(uMax, u + eps));
  const a = evaluateCurve(curve, uA);
  const b = evaluateCurve(curve, uB);
  return scale(sub(b, a), 1 / (uB - uA));
}

/** Approximate second derivative. */
export function curveSecondDerivative(curve: NurbsCurve, u: number, eps = 1e-4): Vec3 {
  const uMin = curve.knots[curve.degree];
  const uMax = curve.knots[curve.knots.length - curve.degree - 1];
  const uA = Math.max(uMin, Math.min(uMax, u - eps));
  const uB = u;
  const uC = Math.max(uMin, Math.min(uMax, u + eps));
  const a = evaluateCurve(curve, uA);
  const b = evaluateCurve(curve, uB);
  const c = evaluateCurve(curve, uC);
  // (a - 2b + c) / eps²
  const acc = sub(add(a, c), scale(b, 2));
  return scale(acc, 1 / (eps * eps));
}

// ─── Continuity classification ─────────────────────────────────────────────

export type Continuity = 'discontinuous' | 'C0' | 'G1' | 'C1' | 'G2' | 'C2';

export interface ContinuityReport {
  level: Continuity;
  positionGap: number;
  tangentAngleDeg: number;
  tangentMagnitudeRatio: number;
  curvatureRatio: number;
  recommendation: string;
}

/**
 * Classify the continuity at the join of curve A's endpoint to curve B's
 * start point. Caller decides which end of each — pass uA + uB explicitly
 * (typically curve.knots[degree] for the start, knots[end-degree-1] for end).
 */
export function classifyContinuity(
  curveA: NurbsCurve, uA: number,
  curveB: NurbsCurve, uB: number,
  positionTol = 1e-3,
  angleTolDeg = 0.5,
  curvatureRatioTol = 0.1,
): ContinuityReport {
  const pA = evaluateCurve(curveA, uA);
  const pB = evaluateCurve(curveB, uB);
  const positionGap = norm(sub(pA, pB));

  if (positionGap > positionTol) {
    return {
      level: 'discontinuous',
      positionGap,
      tangentAngleDeg: Number.NaN,
      tangentMagnitudeRatio: Number.NaN,
      curvatureRatio: Number.NaN,
      recommendation: `Endpoints differ by ${positionGap.toFixed(4)}mm. Move control points so the curves meet.`,
    };
  }

  const tA = curveDerivative(curveA, uA);
  const tB = curveDerivative(curveB, uB);
  const magA = norm(tA);
  const magB = norm(tB);
  const tangentMagnitudeRatio = magA > 0 && magB > 0 ? Math.min(magA, magB) / Math.max(magA, magB) : 0;
  const cosTheta = magA > 0 && magB > 0 ? Math.max(-1, Math.min(1, dot(tA, tB) / (magA * magB))) : 0;
  const tangentAngleDeg = (Math.acos(cosTheta) * 180) / Math.PI;

  if (tangentAngleDeg > angleTolDeg) {
    return {
      level: 'C0',
      positionGap,
      tangentAngleDeg,
      tangentMagnitudeRatio,
      curvatureRatio: Number.NaN,
      recommendation: `Position OK but tangents differ ${tangentAngleDeg.toFixed(2)}°. Align last segment of A with first of B for G1.`,
    };
  }

  // Tangent direction match. C1 requires equal magnitude too; G1 just direction.
  const isC1 = tangentMagnitudeRatio > 0.95;
  const baseLevel: Continuity = isC1 ? 'C1' : 'G1';

  // Curvature comparison via second derivative magnitudes.
  const sA = curveSecondDerivative(curveA, uA);
  const sB = curveSecondDerivative(curveB, uB);
  const kA = norm(cross(tA, sA)) / Math.max(magA * magA * magA, 1e-12);
  const kB = norm(cross(tB, sB)) / Math.max(magB * magB * magB, 1e-12);
  const curvatureRatio = kA > 0 && kB > 0 ? Math.min(kA, kB) / Math.max(kA, kB) : 0;
  const curvatureMatch = Math.abs(1 - curvatureRatio) <= curvatureRatioTol;

  if (!curvatureMatch) {
    return {
      level: baseLevel,
      positionGap, tangentAngleDeg, tangentMagnitudeRatio, curvatureRatio,
      recommendation: `${baseLevel} continuity. Curvatures differ ${(Math.abs(1 - curvatureRatio) * 100).toFixed(1)}% — adjust 2nd-from-end CPs to match for G2 (no visible kink).`,
    };
  }

  const isC2 = isC1 && curvatureMatch;
  return {
    level: isC2 ? 'C2' : 'G2',
    positionGap, tangentAngleDeg, tangentMagnitudeRatio, curvatureRatio,
    recommendation: `${isC2 ? 'C2' : 'G2'} continuity — class-A smooth.`,
  };
}

/** Make a clamped uniform cubic curve from N control points. Convenience
 *  for tests + agent-side construction. */
export function makeCubicCurve(controlPoints: Vec3[], weights?: number[]): NurbsCurve {
  const n = controlPoints.length;
  if (n < 4) throw new Error('Cubic NURBS needs ≥4 control points');
  const degree = 3;
  const interior = n - degree - 1;
  const knots: number[] = [];
  for (let i = 0; i <= degree; i++) knots.push(0);
  for (let i = 1; i <= interior; i++) knots.push(i / (interior + 1));
  for (let i = 0; i <= degree; i++) knots.push(1);
  return {
    degree,
    controlPoints,
    weights: weights ?? new Array(n).fill(1),
    knots,
  };
}

// avoid unused-warn for normalize since not all flows need it explicitly
void normalize;
