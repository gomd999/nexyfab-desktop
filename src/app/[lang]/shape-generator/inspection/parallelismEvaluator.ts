/**
 * parallelismEvaluator.ts — Evaluate ASME Y14.5 / ISO 1101 parallelism:
 * a surface (or axis) must lie within a zone of two planes (or a
 * cylinder) PARALLEL to a datum, separated by the tolerance.
 *
 * Surface parallelism: the controlled surface's points must fit between
 * two planes parallel to the datum plane. Since the zone planes are
 * parallel to the datum, we project each measured point onto the datum
 * NORMAL and take the spread (max − min). That spread is the parallelism
 * value (independent of the surface's offset from the datum).
 *
 * Axis parallelism: the derived axis must lie in a cylindrical zone whose
 * axis is parallel to the datum axis — i.e. the perpendicular distance of
 * the axis points from a line through their centroid parallel to the
 * datum direction, ×2 (diametral).
 */

export interface Vec3 { x: number; y: number; z: number }
export interface Point3D { x: number; y: number; z: number }

// ── Surface parallelism ─────────────────────────────────────────────

export interface SurfaceParallelismInput {
  points: Point3D[];
  datumNormal: Vec3; // unit normal of the datum plane
  toleranceMm: number;
}

export interface SurfaceParallelismResult {
  parallelismMm: number;
  maxProjection: number;
  minProjection: number;
  passed: boolean;
  warnings: string[];
}

export function evaluateSurface(input: SurfaceParallelismInput): SurfaceParallelismResult {
  const warnings: string[] = [];
  if (input.points.length < 2) warnings.push('Need at least 2 points.');
  if (input.toleranceMm <= 0) warnings.push('Tolerance must be positive.');

  const n = normalize(input.datumNormal);
  if (input.points.length === 0) {
    return { parallelismMm: 0, maxProjection: 0, minProjection: 0, passed: true, warnings };
  }
  let max = -Infinity, min = Infinity;
  for (const p of input.points) {
    const proj = p.x * n.x + p.y * n.y + p.z * n.z;
    max = Math.max(max, proj);
    min = Math.min(min, proj);
  }
  const parallelism = max - min;
  return {
    parallelismMm: parallelism,
    maxProjection: max,
    minProjection: min,
    passed: parallelism <= input.toleranceMm + 1e-9,
    warnings,
  };
}

// ── Axis parallelism ────────────────────────────────────────────────

export interface AxisParallelismInput {
  axisPoints: Point3D[];
  datumDirection: Vec3; // unit direction of the datum axis
  toleranceMm: number;  // diametral zone
}

export interface AxisParallelismResult {
  diametralZoneMm: number;
  maxRadialDeviationMm: number;
  passed: boolean;
  warnings: string[];
}

export function evaluateAxis(input: AxisParallelismInput): AxisParallelismResult {
  const warnings: string[] = [];
  if (input.axisPoints.length < 2) warnings.push('Need at least 2 axis points.');
  if (input.axisPoints.length === 0) {
    return { diametralZoneMm: 0, maxRadialDeviationMm: 0, passed: true, warnings };
  }

  const dir = normalize(input.datumDirection);
  const n = input.axisPoints.length;
  const c = {
    x: input.axisPoints.reduce((s, p) => s + p.x, 0) / n,
    y: input.axisPoints.reduce((s, p) => s + p.y, 0) / n,
    z: input.axisPoints.reduce((s, p) => s + p.z, 0) / n,
  };
  // Zone axis = line through centroid parallel to the DATUM direction.
  let maxRadial = 0;
  for (const p of input.axisPoints) {
    const v = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
    const along = v.x * dir.x + v.y * dir.y + v.z * dir.z;
    const perp = { x: v.x - along * dir.x, y: v.y - along * dir.y, z: v.z - along * dir.z };
    maxRadial = Math.max(maxRadial, Math.hypot(perp.x, perp.y, perp.z));
  }
  const zone = 2 * maxRadial;
  return {
    diametralZoneMm: zone,
    maxRadialDeviationMm: maxRadial,
    passed: zone <= input.toleranceMm + 1e-9,
    warnings,
  };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Tilt angle (deg) of a best-fit surface normal vs the datum normal. */
export function tiltAngleDeg(surfaceNormal: Vec3, datumNormal: Vec3): number {
  const a = normalize(surfaceNormal);
  const b = normalize(datumNormal);
  const dot = Math.max(-1, Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z)));
  return Math.acos(dot) * 180 / Math.PI;
}

export function summarizeSurface(r: SurfaceParallelismResult): { passed: boolean; parallelismMm: number } {
  return { passed: r.passed, parallelismMm: r.parallelismMm };
}

export function summarizeAxis(r: AxisParallelismResult): { passed: boolean; diametralZoneMm: number } {
  return { passed: r.passed, diametralZoneMm: r.diametralZoneMm };
}
