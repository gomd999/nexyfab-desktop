/**
 * profileOfSurfaceTolerance.ts — Evaluate ASME Y14.5 / ISO 1101
 * "profile of a surface": measured 3-D points must lie within a zone
 * around the nominal surface (a triangle mesh), bilateral or unilateral.
 *
 * Where profile-of-a-LINE (see [[profileOfLineTolerance]]) works in 2-D,
 * this works in 3-D: for each measured point we find the closest point
 * on the nominal triangle mesh, take the signed distance along the local
 * surface normal, and check it against the zone:
 *
 *   bilateral          : |dev| ≤ tol/2
 *   unilateral-outside : 0 ≤ dev ≤ tol
 *   unilateral-inside  : −tol ≤ dev ≤ 0
 */

export interface Point3D { x: number; y: number; z: number }
export interface Triangle { a: Point3D; b: Point3D; c: Point3D }

export type ProfileZoneType = 'bilateral' | 'unilateral-outside' | 'unilateral-inside';

export interface ProfileSurfaceInput {
  nominalMesh: Triangle[];
  measured: Point3D[];
  toleranceMm: number;
  zoneType: ProfileZoneType;
}

export interface SurfaceDeviationEntry {
  measured: Point3D;
  closest: Point3D;
  signedDeviationMm: number;
  withinZone: boolean;
}

export interface ProfileSurfaceResult {
  entries: SurfaceDeviationEntry[];
  maxAbsoluteDeviationMm: number;
  rmsDeviationMm: number;
  passed: boolean;
  worstIndex: number;
  warnings: string[];
}

export function evaluate(input: ProfileSurfaceInput): ProfileSurfaceResult {
  const warnings: string[] = [];
  if (input.nominalMesh.length === 0) warnings.push('Nominal mesh is empty.');
  if (input.measured.length === 0) warnings.push('No measured points.');
  if (input.toleranceMm <= 0) warnings.push('Tolerance must be positive.');

  const entries: SurfaceDeviationEntry[] = input.measured.map(m => {
    const { point, normal } = closestOnMesh(m, input.nominalMesh);
    const signed = (m.x - point.x) * normal.x + (m.y - point.y) * normal.y + (m.z - point.z) * normal.z;
    return { measured: m, closest: point, signedDeviationMm: signed, withinZone: checkZone(signed, input.toleranceMm, input.zoneType) };
  });

  let maxAbs = 0, sumSq = 0, worst = -1;
  entries.forEach((e, i) => {
    const a = Math.abs(e.signedDeviationMm);
    sumSq += e.signedDeviationMm * e.signedDeviationMm;
    if (a > maxAbs) { maxAbs = a; worst = i; }
  });
  const rms = entries.length ? Math.sqrt(sumSq / entries.length) : 0;

  return {
    entries,
    maxAbsoluteDeviationMm: maxAbs,
    rmsDeviationMm: rms,
    passed: entries.every(e => e.withinZone),
    worstIndex: worst,
    warnings,
  };
}

function closestOnMesh(p: Point3D, mesh: Triangle[]): { point: Point3D; normal: Point3D } {
  let best = Infinity;
  let bestPoint: Point3D = mesh[0]?.a ?? p;
  let bestNormal: Point3D = { x: 0, y: 0, z: 1 };
  for (const tri of mesh) {
    const cp = closestPointOnTriangle(p, tri);
    const d = dist2(p, cp);
    if (d < best) {
      best = d;
      bestPoint = cp;
      bestNormal = triangleNormal(tri);
    }
  }
  return { point: bestPoint, normal: bestNormal };
}

function closestPointOnTriangle(p: Point3D, tri: Triangle): Point3D {
  // Ericson "Real-Time Collision Detection" closest-point-on-triangle.
  const a = tri.a, b = tri.b, c = tri.c;
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return add(a, scale(ab, v));
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return add(a, scale(ac, w));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return add(b, scale(sub(c, b), w));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return add(a, add(scale(ab, v), scale(ac, w)));
}

function triangleNormal(tri: Triangle): Point3D {
  const n = cross(sub(tri.b, tri.a), sub(tri.c, tri.a));
  const len = Math.hypot(n.x, n.y, n.z) || 1;
  return { x: n.x / len, y: n.y / len, z: n.z / len };
}

function checkZone(signed: number, tol: number, type: ProfileZoneType): boolean {
  switch (type) {
    case 'bilateral': return Math.abs(signed) <= tol / 2 + 1e-9;
    case 'unilateral-outside': return signed >= -1e-9 && signed <= tol + 1e-9;
    case 'unilateral-inside': return signed >= -tol - 1e-9 && signed <= 1e-9;
  }
}

function sub(a: Point3D, b: Point3D): Point3D { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function add(a: Point3D, b: Point3D): Point3D { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(a: Point3D, s: number): Point3D { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
function dot(a: Point3D, b: Point3D): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Point3D, b: Point3D): Point3D { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function dist2(a: Point3D, b: Point3D): number { const d = sub(a, b); return dot(d, d); }

export function summarize(r: ProfileSurfaceResult): { passed: boolean; maxAbsoluteDeviationMm: number; pointCount: number } {
  return { passed: r.passed, maxAbsoluteDeviationMm: r.maxAbsoluteDeviationMm, pointCount: r.entries.length };
}
