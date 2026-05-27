/**
 * variableFilletPath.ts — Continuous radius interpolation for
 * variable-radius fillets along an edge.
 *
 * Stage 1 (`variableFillet.ts`) takes a list of (parameter, radius)
 * control points and applies a fillet at each one. Stage 2 (here)
 * supplies the *path math* — given the user-defined control radii,
 * compute the actual radius at any parameter t along the edge,
 * using one of three interpolation modes:
 *
 *   - **linear** — segment-wise, sharp corner at each control point.
 *   - **catmull-rom** — C1-continuous spline through every control
 *     point. SolidWorks-style smoothness.
 *   - **monotone-cubic** — Fritsch-Carlson: smooth AND preserves
 *     monotonicity (no overshoot below 0 or above max).
 *
 * Also generates the tangent-vector-aware fillet "rail" curves used
 * by the swept-cross-section meshing in the variable-fillet feature.
 */

export interface RadiusControlPoint {
  /** Parameter along the edge (0..1). */
  t: number;
  /** Fillet radius at this t (mm). */
  radiusMm: number;
}

export type InterpolationMode = 'linear' | 'catmull-rom' | 'monotone-cubic';

export interface RadiusPath {
  controlPoints: RadiusControlPoint[];
  mode: InterpolationMode;
}

/** Evaluate the radius at parameter t. Outside [0,1] clamps to
 *  the first/last control point. */
export function radiusAt(path: RadiusPath, t: number): number {
  const cps = path.controlPoints;
  if (cps.length === 0) return 0;
  if (cps.length === 1) return cps[0]!.radiusMm;
  // Ensure sorted.
  const sorted = cps.slice().sort((a, b) => a.t - b.t);
  if (t <= sorted[0]!.t) return sorted[0]!.radiusMm;
  if (t >= sorted[sorted.length - 1]!.t) return sorted[sorted.length - 1]!.radiusMm;

  // Find the segment containing t.
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1]!.t < t) i++;
  const p0 = sorted[i]!;
  const p1 = sorted[i + 1]!;
  const u = (t - p0.t) / (p1.t - p0.t);

  switch (path.mode) {
    case 'linear':
      return p0.radiusMm + (p1.radiusMm - p0.radiusMm) * u;
    case 'catmull-rom': {
      const pm1 = sorted[Math.max(0, i - 1)]!;
      const p2 = sorted[Math.min(sorted.length - 1, i + 2)]!;
      return catmullRom(pm1.radiusMm, p0.radiusMm, p1.radiusMm, p2.radiusMm, u);
    }
    case 'monotone-cubic':
      return monotoneCubic(sorted, i, t);
  }
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  // Standard centripetal Catmull-Rom: 0.5·((2·p1) + (-p0+p2)·t + (2·p0-5·p1+4·p2-p3)·t² + (-p0+3·p1-3·p2+p3)·t³)
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1)
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/** Fritsch-Carlson monotone cubic. */
function monotoneCubic(cps: RadiusControlPoint[], i: number, t: number): number {
  // Tangents at p0 and p1 using Fritsch-Carlson formula.
  const p0 = cps[i]!;
  const p1 = cps[i + 1]!;
  const h = p1.t - p0.t;
  const d = (p1.radiusMm - p0.radiusMm) / h;

  // tangent at p0
  const dPrev = i > 0 ? (cps[i]!.radiusMm - cps[i - 1]!.radiusMm) / (cps[i]!.t - cps[i - 1]!.t) : d;
  const dNext = i < cps.length - 2 ? (cps[i + 2]!.radiusMm - cps[i + 1]!.radiusMm) / (cps[i + 2]!.t - cps[i + 1]!.t) : d;

  let m0 = (dPrev + d) / 2;
  let m1 = (d + dNext) / 2;

  // Enforce monotonicity.
  if (d === 0) {
    m0 = 0; m1 = 0;
  } else {
    const a = m0 / d;
    const b = m1 / d;
    const hyp = a * a + b * b;
    if (hyp > 9) {
      const tau = 3 / Math.sqrt(hyp);
      m0 = tau * a * d;
      m1 = tau * b * d;
    }
  }

  // Hermite basis.
  const u = (t - p0.t) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return h00 * p0.radiusMm + h10 * h * m0 + h01 * p1.radiusMm + h11 * h * m1;
}

/** Sample the radius path at N uniform parameter intervals. */
export function sampleRadiusPath(path: RadiusPath, sampleCount: number = 32): Array<{ t: number; radiusMm: number }> {
  const out: Array<{ t: number; radiusMm: number }> = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = i / (sampleCount - 1);
    out.push({ t, radiusMm: radiusAt(path, t) });
  }
  return out;
}

/** Validate the radius path — no negative radii, no extreme outliers. */
export interface PathValidation {
  isValid: boolean;
  warnings: string[];
}

export function validateRadiusPath(path: RadiusPath, maxAllowedRadiusMm: number = 100): PathValidation {
  const warnings: string[] = [];
  for (const cp of path.controlPoints) {
    if (cp.radiusMm < 0) warnings.push(`Negative radius at t=${cp.t}`);
    if (cp.radiusMm > maxAllowedRadiusMm) warnings.push(`Radius ${cp.radiusMm} exceeds max ${maxAllowedRadiusMm} at t=${cp.t}`);
    if (cp.t < 0 || cp.t > 1) warnings.push(`Parameter t=${cp.t} outside [0,1]`);
  }
  // Sample finely + check for negatives in interpolation (esp. catmull-rom overshoot).
  const samples = sampleRadiusPath(path, 64);
  if (samples.some(s => s.radiusMm < 0)) {
    warnings.push('Interpolated radius dips below 0 — try monotone-cubic mode');
  }
  return { isValid: warnings.length === 0, warnings };
}

// ── Sweep cross-section rails ────────────────────────────────────

export interface EdgeSample {
  position: [number, number, number];
  /** Edge tangent at this position. */
  tangent: [number, number, number];
  /** Surface normal A. */
  normalA: [number, number, number];
  /** Surface normal B. */
  normalB: [number, number, number];
}

export interface FilletRail {
  /** Point on surface A at distance `radius` from edge along its normal. */
  railA: Array<[number, number, number]>;
  /** Same for surface B. */
  railB: Array<[number, number, number]>;
  /** Radius used at each sample (mm). */
  radii: number[];
}

/** Given edge samples + a radius path, compute the two fillet rail
 *  curves along which the rolling-ball touches surface A and B. */
export function computeFilletRails(
  edgeSamples: EdgeSample[],
  path: RadiusPath,
): FilletRail {
  const railA: Array<[number, number, number]> = [];
  const railB: Array<[number, number, number]> = [];
  const radii: number[] = [];

  for (let i = 0; i < edgeSamples.length; i++) {
    const t = i / Math.max(1, edgeSamples.length - 1);
    const r = radiusAt(path, t);
    radii.push(r);
    const s = edgeSamples[i]!;
    // Foot on surface A = position + radius along bisector projected
    // onto surface A.
    railA.push([
      s.position[0] - s.normalA[0] * r,
      s.position[1] - s.normalA[1] * r,
      s.position[2] - s.normalA[2] * r,
    ]);
    railB.push([
      s.position[0] - s.normalB[0] * r,
      s.position[1] - s.normalB[1] * r,
      s.position[2] - s.normalB[2] * r,
    ]);
  }
  return { railA, railB, radii };
}
