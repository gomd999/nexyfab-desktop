/**
 * perpendicularityEvaluator.ts — Evaluate ASME Y14.5 / ISO 1101
 * perpendicularity (squareness): a surface or axis must lie within a
 * zone oriented at exactly 90° to a datum.
 *
 * Surface perpendicularity: the controlled surface should be normal to
 * the datum. We project measured points onto the datum's IN-PLANE
 * direction that the surface is supposed to be parallel to... simpler:
 * the controlled surface's nominal normal is parallel to the datum
 * plane (perpendicular surface → its normal lies IN the datum plane).
 * So we project points onto the datum normal direction's perpendicular
 * — i.e. the spread of points along the datum normal IS the
 * perpendicularity (a perfectly square wall has zero variation along
 * the datum normal as you traverse it... no — along the controlled
 * direction).
 *
 * Practical model: given the datum normal d and the controlled surface's
 * nominal direction (the axis the wall should run along = d), measure
 * each point's deviation along d after removing the in-plane position.
 * Perpendicularity = spread of (point · d_perp) where d_perp is the
 * surface's expected normal (a direction ⟂ to d). We take the controlled
 * surface normal estimate and report tilt.
 *
 * For an AXIS perpendicular to a datum plane: the axis must lie in a
 * cylindrical zone whose axis is along the datum normal. Zone = 2× max
 * radial deviation of axis points from the datum-normal line through
 * their centroid.
 */

export interface Vec3 { x: number; y: number; z: number }
export interface Point3D { x: number; y: number; z: number }

// ── Axis perpendicular to a datum plane ─────────────────────────────

export interface AxisPerpInput {
  axisPoints: Point3D[];
  datumNormal: Vec3; // normal of the datum plane the axis must be ⟂ to (= the ideal axis direction)
  toleranceMm: number;
}

export interface AxisPerpResult {
  diametralZoneMm: number;
  maxRadialDeviationMm: number;
  tiltAngleDeg: number;
  passed: boolean;
  warnings: string[];
}

export function evaluateAxis(input: AxisPerpInput): AxisPerpResult {
  const warnings: string[] = [];
  if (input.axisPoints.length < 2) warnings.push('Need at least 2 axis points.');
  if (input.toleranceMm <= 0) warnings.push('Tolerance must be positive.');
  if (input.axisPoints.length < 2) {
    return { diametralZoneMm: 0, maxRadialDeviationMm: 0, tiltAngleDeg: 0, passed: true, warnings };
  }

  const dir = normalize(input.datumNormal); // ideal axis direction = datum normal
  const n = input.axisPoints.length;
  const c = {
    x: input.axisPoints.reduce((s, p) => s + p.x, 0) / n,
    y: input.axisPoints.reduce((s, p) => s + p.y, 0) / n,
    z: input.axisPoints.reduce((s, p) => s + p.z, 0) / n,
  };
  let maxRadial = 0;
  for (const p of input.axisPoints) {
    const v = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
    const along = v.x * dir.x + v.y * dir.y + v.z * dir.z;
    const perp = { x: v.x - along * dir.x, y: v.y - along * dir.y, z: v.z - along * dir.z };
    maxRadial = Math.max(maxRadial, Math.hypot(perp.x, perp.y, perp.z));
  }

  // Actual axis direction (first→last) vs ideal.
  const first = input.axisPoints[0]!;
  const last = input.axisPoints[n - 1]!;
  const actual = normalize({ x: last.x - first.x, y: last.y - first.y, z: last.z - first.z });
  const dot = Math.max(-1, Math.min(1, Math.abs(actual.x * dir.x + actual.y * dir.y + actual.z * dir.z)));
  const tilt = Math.acos(dot) * 180 / Math.PI;

  const zone = 2 * maxRadial;
  return {
    diametralZoneMm: zone,
    maxRadialDeviationMm: maxRadial,
    tiltAngleDeg: tilt,
    passed: zone <= input.toleranceMm + 1e-9,
    warnings,
  };
}

// ── Surface perpendicular to a datum ────────────────────────────────

export interface SurfacePerpInput {
  points: Point3D[];
  datumNormal: Vec3;          // datum plane normal
  controlledNormal: Vec3;     // nominal normal of the controlled (vertical) surface — should be ⟂ to datumNormal
  toleranceMm: number;
}

export interface SurfacePerpResult {
  perpendicularityMm: number; // spread of points along the controlled normal
  maxDeviationMm: number;
  minDeviationMm: number;
  squarenessAngleDeg: number; // actual angle between controlledNormal and datumNormal
  passed: boolean;
  warnings: string[];
}

export function evaluateSurface(input: SurfacePerpInput): SurfacePerpResult {
  const warnings: string[] = [];
  if (input.points.length < 2) warnings.push('Need at least 2 points.');
  const cn = normalize(input.controlledNormal);
  const dn = normalize(input.datumNormal);

  if (input.points.length === 0) {
    return { perpendicularityMm: 0, maxDeviationMm: 0, minDeviationMm: 0, squarenessAngleDeg: 90, passed: true, warnings };
  }

  let max = -Infinity, min = Infinity;
  for (const p of input.points) {
    const proj = p.x * cn.x + p.y * cn.y + p.z * cn.z;
    max = Math.max(max, proj);
    min = Math.min(min, proj);
  }
  const perp = max - min;
  const dot = Math.max(-1, Math.min(1, cn.x * dn.x + cn.y * dn.y + cn.z * dn.z));
  const angleBetweenNormals = Math.acos(Math.abs(dot)) * 180 / Math.PI; // 0..90
  // Ideal: controlled normal ⟂ datum normal → angleBetweenNormals = 90°.
  // Squareness deviation = how far from that ideal.
  const squarenessDeviation = Math.abs(angleBetweenNormals - 90);

  return {
    perpendicularityMm: perp,
    maxDeviationMm: max,
    minDeviationMm: min,
    squarenessAngleDeg: squarenessDeviation,
    passed: perp <= input.toleranceMm + 1e-9,
    warnings,
  };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function summarizeAxis(r: AxisPerpResult): { passed: boolean; diametralZoneMm: number; tiltAngleDeg: number } {
  return { passed: r.passed, diametralZoneMm: r.diametralZoneMm, tiltAngleDeg: r.tiltAngleDeg };
}

export function summarizeSurface(r: SurfacePerpResult): { passed: boolean; perpendicularityMm: number } {
  return { passed: r.passed, perpendicularityMm: r.perpendicularityMm };
}
