/**
 * angularityEvaluator.ts — Evaluate ASME Y14.5 / ISO 1101 angularity:
 * a surface (or axis) must lie within a tolerance zone of two parallel
 * planes (or a cylinder) oriented at the SPECIFIED basic angle to a datum.
 *
 * Surface angularity (planar): measured points must lie between two
 * planes parallel to the *nominal angled plane* (at basic angle θ to the
 * datum), separated by the tolerance. We:
 *   1. Build the nominal plane normal from the datum normal rotated by θ.
 *   2. Project each measured point's signed distance onto that normal.
 *   3. angularity = max − min signed distance.
 *
 * The datum is given as a unit normal; the basic angle θ rotates the
 * reference plane about a specified rotation axis in the datum plane.
 */

export interface Vec3 { x: number; y: number; z: number }
export interface MeasuredPoint { x: number; y: number; z: number }

export interface AngularityInput {
  points: MeasuredPoint[];
  datumNormal: Vec3;     // unit normal of datum plane
  basicAngleDeg: number; // angle of the controlled surface to the datum
  rotationAxis: Vec3;    // axis (in datum plane) about which the angle is measured
  toleranceMm: number;
}

export interface AngularityResult {
  angularityMm: number;
  maxDeviationMm: number;
  minDeviationMm: number;
  passed: boolean;
  nominalNormal: Vec3;
  warnings: string[];
}

export function evaluate(input: AngularityInput): AngularityResult {
  const warnings: string[] = [];
  if (input.points.length < 3) warnings.push('Need at least 3 points for a surface angularity check.');
  if (input.toleranceMm <= 0) warnings.push('Tolerance must be positive.');

  const datum = normalize(input.datumNormal);
  const axis = normalize(input.rotationAxis);
  const theta = input.basicAngleDeg * Math.PI / 180;

  // The controlled surface sits at basic angle θ to the datum plane, so its
  // normal is the datum normal rotated by θ about the rotation axis.
  const nominalNormal = rotateAboutAxis(datum, axis, theta);

  if (input.points.length === 0) {
    return { angularityMm: 0, maxDeviationMm: 0, minDeviationMm: 0, passed: true, nominalNormal, warnings };
  }

  // Centroid for a stable reference offset.
  const c = {
    x: input.points.reduce((s, p) => s + p.x, 0) / input.points.length,
    y: input.points.reduce((s, p) => s + p.y, 0) / input.points.length,
    z: input.points.reduce((s, p) => s + p.z, 0) / input.points.length,
  };

  let max = -Infinity, min = Infinity;
  for (const p of input.points) {
    const d = (p.x - c.x) * nominalNormal.x + (p.y - c.y) * nominalNormal.y + (p.z - c.z) * nominalNormal.z;
    max = Math.max(max, d);
    min = Math.min(min, d);
  }
  const angularity = max - min;

  return {
    angularityMm: angularity,
    maxDeviationMm: max,
    minDeviationMm: min,
    passed: angularity <= input.toleranceMm + 1e-9,
    nominalNormal,
    warnings,
  };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Rodrigues rotation of vector v about unit axis k by angle φ. */
function rotateAboutAxis(v: Vec3, k: Vec3, phi: number): Vec3 {
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dot = v.x * k.x + v.y * k.y + v.z * k.z;
  const cross = {
    x: k.y * v.z - k.z * v.y,
    y: k.z * v.x - k.x * v.z,
    z: k.x * v.y - k.y * v.x,
  };
  return {
    x: v.x * cos + cross.x * sin + k.x * dot * (1 - cos),
    y: v.y * cos + cross.y * sin + k.y * dot * (1 - cos),
    z: v.z * cos + cross.z * sin + k.z * dot * (1 - cos),
  };
}

/** Measure the actual angle of a best-fit plane (from its normal) to the datum.
 *  Two planes meet at the same angle as their normals do. */
export function actualAngleDeg(planeNormal: Vec3, datumNormal: Vec3): number {
  const n = normalize(planeNormal);
  const d = normalize(datumNormal);
  const dot = Math.max(-1, Math.min(1, Math.abs(n.x * d.x + n.y * d.y + n.z * d.z)));
  return Math.acos(dot) * 180 / Math.PI;
}

export function summarize(r: AngularityResult): { passed: boolean; angularityMm: number } {
  return { passed: r.passed, angularityMm: r.angularityMm };
}
