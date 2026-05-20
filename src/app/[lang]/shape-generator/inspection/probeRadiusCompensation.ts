/**
 * probeRadiusCompensation.ts — Compensate for CMM probe tip radius.
 *
 * Every CMM measurement reports the *center of the probe ball*, not
 * the point where the ball touches the surface. To get the true
 * surface point you must offset the recorded center by the probe
 * radius along the *surface normal*.
 *
 * Two compensation modes:
 *
 *   - **Surface normal known** (e.g., from CAD nominal): subtract
 *     `r · n` from each measured center. Most accurate.
 *   - **Derived from cluster**: when probing a planar surface with
 *     N points, fit a plane through them and use the plane normal.
 *     Less accurate near edges; OK for shop-floor use.
 *
 * Also computes the *form error* (residual deviation after
 * compensation) as a sanity check.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface MeasuredPoint {
  id: string;
  /** Recorded probe-center position. */
  center: Vec3;
  /** Optional nominal surface normal (CAD-derived) at the contact point. */
  surfaceNormal?: Vec3;
}

export interface CompensatedPoint {
  id: string;
  /** Original probe center. */
  rawCenter: Vec3;
  /** Compensated surface contact point. */
  surfacePoint: Vec3;
  /** Normal used for compensation. */
  appliedNormal: Vec3;
}

export interface CompensationResult {
  points: CompensatedPoint[];
  /** Residual = max deviation of compensated points from best-fit plane. */
  formErrorMm: number;
  /** Fit-plane parameters if cluster mode used. */
  fitPlane?: { a: number; b: number; c: number; d: number };
}

export interface CompensationOptions {
  /** Probe tip ball radius, mm. */
  probeRadiusMm: number;
  /** Mode. */
  mode: 'surface-normal' | 'cluster-plane';
}

export const DEFAULT_OPTIONS: CompensationOptions = {
  probeRadiusMm: 3.0,
  mode: 'surface-normal',
};

// ── Top-level entry ────────────────────────────────────────────

export function compensateProbe(points: MeasuredPoint[], options: Partial<CompensationOptions> = {}): CompensationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (points.length === 0) {
    return { points: [], formErrorMm: 0 };
  }

  let fitPlane: { a: number; b: number; c: number; d: number } | undefined;
  let normalProvider: (p: MeasuredPoint) => Vec3;
  if (opts.mode === 'cluster-plane') {
    fitPlane = fitLeastSquaresPlane(points.map(p => p.center));
    normalProvider = () => ({ x: fitPlane!.a, y: fitPlane!.b, z: fitPlane!.c });
  } else {
    normalProvider = (p) => p.surfaceNormal ?? { x: 0, y: 0, z: 1 };
  }

  const compensated: CompensatedPoint[] = points.map(p => {
    const n = normalize(normalProvider(p));
    const sp: Vec3 = {
      x: p.center.x - n.x * opts.probeRadiusMm,
      y: p.center.y - n.y * opts.probeRadiusMm,
      z: p.center.z - n.z * opts.probeRadiusMm,
    };
    return { id: p.id, rawCenter: p.center, surfacePoint: sp, appliedNormal: n };
  });

  // Form error: max distance from compensated to best-fit plane through compensated.
  const formPlane = fitLeastSquaresPlane(compensated.map(c => c.surfacePoint));
  let maxDev = 0;
  for (const c of compensated) {
    const d = Math.abs(formPlane.a * c.surfacePoint.x + formPlane.b * c.surfacePoint.y + formPlane.c * c.surfacePoint.z + formPlane.d);
    if (d > maxDev) maxDev = d;
  }

  const result: CompensationResult = { points: compensated, formErrorMm: maxDev };
  if (fitPlane) result.fitPlane = fitPlane;
  return result;
}

// ── Helpers ────────────────────────────────────────────────────

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-9) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function fitLeastSquaresPlane(points: Vec3[]): { a: number; b: number; c: number; d: number } {
  const n = points.length;
  if (n < 3) return { a: 0, b: 0, c: 1, d: 0 };
  let cx = 0, cy = 0, cz = 0;
  for (const p of points) { cx += p.x; cy += p.y; cz += p.z; }
  cx /= n; cy /= n; cz /= n;
  let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0;
  for (const p of points) {
    const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
    xx += dx * dx; yy += dy * dy; zz += dz * dz;
    xy += dx * dy; xz += dx * dz; yz += dy * dz;
  }
  const detZ = xx * yy - xy * xy;
  const detY = xx * zz - xz * xz;
  const detX = yy * zz - yz * yz;
  let na = 0, nb = 0, nc = 1;
  if (detZ >= detY && detZ >= detX) {
    na = -xz; nb = -yz; nc = detZ;
  } else if (detY >= detX) {
    na = -xy; nb = detY; nc = -yz;
  } else {
    na = detX; nb = -xy; nc = -xz;
  }
  const len = Math.hypot(na, nb, nc);
  if (len < 1e-9) return { a: 0, b: 0, c: 1, d: -cz };
  const a = na / len, b = nb / len, c = nc / len;
  return { a, b, c, d: -(a * cx + b * cy + c * cz) };
}

// ── Summary ────────────────────────────────────────────────────

export interface CompensationSummary {
  pointCount: number;
  probeRadiusMm: number;
  formErrorMm: number;
  /** Average shift magnitude per point (mm). */
  averageShiftMm: number;
}

export function summarize(result: CompensationResult, probeRadiusMm: number): CompensationSummary {
  if (result.points.length === 0) {
    return { pointCount: 0, probeRadiusMm, formErrorMm: 0, averageShiftMm: 0 };
  }
  let totalShift = 0;
  for (const p of result.points) {
    const dx = p.surfacePoint.x - p.rawCenter.x;
    const dy = p.surfacePoint.y - p.rawCenter.y;
    const dz = p.surfacePoint.z - p.rawCenter.z;
    totalShift += Math.hypot(dx, dy, dz);
  }
  return {
    pointCount: result.points.length,
    probeRadiusMm,
    formErrorMm: result.formErrorMm,
    averageShiftMm: totalShift / result.points.length,
  };
}
