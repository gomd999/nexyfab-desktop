/**
 * referenceGeometry/math.ts — pure math for reference geometry.
 *
 * Wave 2 Phase 2 Track D Week 1. Pure functions. No React, no Zustand,
 * no THREE. Spec: `docs/wave-2-phase-2-reference-geometry-spec.md` §11.
 *
 * The existing `features/referenceGeometry.ts` ships the bulk of the
 * constructors. We re-export the contract here under the new tuple
 * `Vec3` shape and add the two helpers spec §11.1 + §11.2 calls out:
 *
 *   - `planeAngleAboutAxis` (Rodrigues rotation, §11.1)
 *   - `planeTangentToCylinder` (radial tangent point + outward normal, §11.2)
 *
 * Numerical stability:
 *
 *   - All "is this zero" checks use a shared `EPS = 1e-9` for vector
 *     length tests; a looser `PARALLEL_EPS = 1e-6` for parallel-plane
 *     detection (matching the existing `features/referenceGeometry.ts`).
 *   - Cross-product based formulas are well-conditioned except at
 *     degenerate inputs (collinear points, parallel planes); each
 *     constructor returns `null` rather than NaN on such inputs.
 *   - Rodrigues rotation uses the canonical
 *     `v' = v·cos θ + (k × v)·sin θ + k·(k·v)·(1 − cos θ)` form.
 *   - 3×3 linear systems use Cramer's rule (`det` check gates the solve).
 *
 * Determinism: no random tie-breaks, no Math.random, no Date.now.
 */

import type {
  Vec3,
  ResolvedPlane,
  ResolvedAxis,
  ResolvedPoint,
  ResolvedCsys,
} from './types';

const EPS = 1e-9;
const PARALLEL_EPS = 1e-6;

// ─── Vec3 helpers (mutating-free, tuple-friendly) ───────────────

export function v3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** Returns `null` when |a| < EPS so callers can fail fast. */
export function normalize(a: Vec3): Vec3 | null {
  const len = length(a);
  if (len < EPS) return null;
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function approxEqualVec3(a: Vec3, b: Vec3, eps = 1e-6): boolean {
  return (
    Math.abs(a[0] - b[0]) < eps &&
    Math.abs(a[1] - b[1]) < eps &&
    Math.abs(a[2] - b[2]) < eps
  );
}

// ─── Standard planes / axes ─────────────────────────────────────

export const FRONT_PLANE: ResolvedPlane = { origin: [0, 0, 0], normal: [0, 0, 1] };
export const TOP_PLANE: ResolvedPlane = { origin: [0, 0, 0], normal: [0, 1, 0] };
export const RIGHT_PLANE: ResolvedPlane = { origin: [0, 0, 0], normal: [1, 0, 0] };

export const X_AXIS: ResolvedAxis = { origin: [0, 0, 0], direction: [1, 0, 0] };
export const Y_AXIS: ResolvedAxis = { origin: [0, 0, 0], direction: [0, 1, 0] };
export const Z_AXIS: ResolvedAxis = { origin: [0, 0, 0], direction: [0, 0, 1] };

export const WORLD_CSYS: ResolvedCsys = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  zAxis: [0, 0, 1],
};

export function standardPlane(id: 'front' | 'top' | 'right' | 'xy' | 'xz' | 'yz'): ResolvedPlane {
  switch (id) {
    case 'front':
    case 'xy':
      return FRONT_PLANE;
    case 'top':
    case 'xz':
      return TOP_PLANE;
    case 'right':
    case 'yz':
      return RIGHT_PLANE;
  }
}

export function standardAxis(id: 'x' | 'y' | 'z'): ResolvedAxis {
  switch (id) {
    case 'x':
      return X_AXIS;
    case 'y':
      return Y_AXIS;
    case 'z':
      return Z_AXIS;
  }
}

// ─── Plane constructors ─────────────────────────────────────────

/** Plane through 3 points. Normal = normalize((p2−p1) × (p3−p1)).
 *
 *  Returns null when points are collinear (cross product magnitude < EPS). */
export function planeFromThreePoints(p1: Vec3, p2: Vec3, p3: Vec3): ResolvedPlane | null {
  const n = normalize(cross(sub(p2, p1), sub(p3, p1)));
  if (n === null) return null;
  return { origin: p1, normal: n };
}

/** Translate plane along its normal. `direction` flips the sign. */
export function planeOffset(base: ResolvedPlane, distanceMm: number, direction: 1 | -1 = 1): ResolvedPlane {
  const d = distanceMm * direction;
  return {
    origin: add(base.origin, scale(base.normal, d)),
    normal: base.normal,
  };
}

/** Plane parallel to `base`, through `point`. */
export function planeParallelThroughPoint(base: ResolvedPlane, point: Vec3): ResolvedPlane {
  return { origin: point, normal: base.normal };
}

/** Midplane between two **parallel** planes. Returns null if not parallel. */
export function planeMidBetween(a: ResolvedPlane, b: ResolvedPlane): ResolvedPlane | null {
  if (Math.abs(dot(a.normal, b.normal)) < 1 - PARALLEL_EPS) return null;
  return {
    origin: scale(add(a.origin, b.origin), 0.5),
    normal: a.normal,
  };
}

/** Plane normal to a curve at the supplied tangent direction. */
export function planeNormalToCurve(point: Vec3, tangent: Vec3): ResolvedPlane | null {
  const n = normalize(tangent);
  if (n === null) return null;
  return { origin: point, normal: n };
}

/** Plane containing a line + an external point. Returns null when point lies on line. */
export function planeThroughLineAndPoint(
  linePoint: Vec3,
  lineDir: Vec3,
  externalPoint: Vec3,
): ResolvedPlane | null {
  const dir = normalize(lineDir);
  if (dir === null) return null;
  const toExternal = sub(externalPoint, linePoint);
  const n = normalize(cross(dir, toExternal));
  if (n === null) return null; // point lies on line
  return { origin: linePoint, normal: n };
}

/** Spec §11.1 — Rodrigues rotation of `parent.normal` about `axis.direction`.
 *
 *  Formula (Wikipedia, Rodrigues' rotation formula):
 *
 *    v' = v·cos θ + (k × v)·sin θ + k·(k·v)·(1 − cos θ)
 *
 *  Where `k` is the unit axis direction and `θ` the angle in radians. The
 *  resulting plane's origin is the closest point on the axis line to
 *  `parent.origin` (i.e. project origin onto axis), which keeps the
 *  rotated plane physically anchored to the rotation axis. When `flip`
 *  is true the normal is reversed (used in UI direction toggle).
 *
 *  Returns null when axis direction is zero. */
export function planeAngleAboutAxis(
  parent: ResolvedPlane,
  axis: ResolvedAxis,
  angleDeg: number,
  flip = false,
): ResolvedPlane | null {
  const k = normalize(axis.direction);
  if (k === null) return null;
  const theta = (angleDeg * Math.PI) / 180;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const v = parent.normal;
  const kxv = cross(k, v);
  const kdv = dot(k, v);
  // Rodrigues
  const rotated: Vec3 = [
    v[0] * c + kxv[0] * s + k[0] * kdv * (1 - c),
    v[1] * c + kxv[1] * s + k[1] * kdv * (1 - c),
    v[2] * c + kxv[2] * s + k[2] * kdv * (1 - c),
  ];
  const n = normalize(rotated);
  if (n === null) return null;
  // Anchor the new plane's origin to the axis line by projecting parent.origin onto it.
  const projOrigin = projectPointOntoLine(parent.origin, axis);
  return {
    origin: projOrigin,
    normal: flip ? scale(n, -1) : n,
  };
}

/** Project a point onto an infinite line. Pure math; used as a helper for §11.1. */
export function projectPointOntoLine(p: Vec3, axis: ResolvedAxis): Vec3 {
  const dir = normalize(axis.direction);
  if (dir === null) return p;
  const t = dot(sub(p, axis.origin), dir);
  return add(axis.origin, scale(dir, t));
}

/** Spec §11.2 — plane tangent to a cylinder at the tangent point along `refDir`.
 *
 *  Strategy:
 *
 *   1. Project `refDir` onto the plane perpendicular to `cylAxis.direction`
 *      to get the in-radial-plane direction.
 *   2. The tangent point is at distance `cylRadius` along that direction
 *      from the cylinder axis.
 *   3. The plane's normal is the outward radial direction at that point.
 *
 *  Returns null when `refDir` is parallel to the axis (no unique tangent
 *  point) or `cylRadius <= 0`. */
export function planeTangentToCylinder(
  cylAxis: ResolvedAxis,
  cylRadius: number,
  refDir: Vec3,
): ResolvedPlane | null {
  if (cylRadius <= 0) return null;
  const axisDir = normalize(cylAxis.direction);
  if (axisDir === null) return null;
  // Subtract the axis-parallel component to keep only the radial part.
  const refParallel = dot(refDir, axisDir);
  const refRadial: Vec3 = [
    refDir[0] - refParallel * axisDir[0],
    refDir[1] - refParallel * axisDir[1],
    refDir[2] - refParallel * axisDir[2],
  ];
  const radialDir = normalize(refRadial);
  if (radialDir === null) return null; // refDir parallel to axis
  const tangentPoint: Vec3 = add(cylAxis.origin, scale(radialDir, cylRadius));
  return {
    origin: tangentPoint,
    normal: radialDir,
  };
}

// ─── Axis constructors ──────────────────────────────────────────

export function axisFromTwoPoints(p1: Vec3, p2: Vec3): ResolvedAxis | null {
  const dir = normalize(sub(p2, p1));
  if (dir === null) return null;
  return { origin: p1, direction: dir };
}

export function axisFromPointDirection(point: Vec3, direction: Vec3): ResolvedAxis | null {
  const dir = normalize(direction);
  if (dir === null) return null;
  return { origin: point, direction: dir };
}

/** Axis at the intersection of two planes. Returns null when parallel.
 *
 *  Direction = normalize(n_a × n_b).
 *  Origin = a point on both planes: solve the 3×3 system
 *    [n_a; n_b; n_a × n_b] · p = [d_a; d_b; 0]
 *  via Cramer's rule, with `d_i = n_i · origin_i`. */
export function axisFromTwoPlanes(a: ResolvedPlane, b: ResolvedPlane): ResolvedAxis | null {
  const crossDir = cross(a.normal, b.normal);
  const direction = normalize(crossDir);
  if (direction === null) return null; // parallel
  const da = dot(a.origin, a.normal);
  const db = dot(b.origin, b.normal);
  const origin = solveOriginOnTwoPlanes(a.normal, b.normal, direction, da, db);
  if (origin === null) return null;
  return { origin, direction };
}

function solveOriginOnTwoPlanes(
  n1: Vec3,
  n2: Vec3,
  n3: Vec3, // unit cross direction; third row of constraint
  da: number,
  db: number,
): Vec3 | null {
  // We want p such that n1·p = da, n2·p = db, n3·p = 0 (origin lies in the
  // plane perpendicular to the line direction through world origin).
  const det = det3(n1, n2, n3);
  if (Math.abs(det) < EPS) return null;
  // Cramer's rule. Each numerator replaces one column of [n1; n2; n3]
  // with the RHS [da, db, 0] and computes det of the substituted matrix.
  // Columns of the matrix are (n1[0], n2[0], n3[0]) etc; we solve A·p = b
  // where A's rows are n1/n2/n3 (per the dot constraint), so the i'th
  // unknown is det(A with column i replaced by b) / det(A).
  // Express A as 3 row vectors → use formula with rows.
  // det(matrix with column i replaced) is computed by replacing that
  // column of A; since A is row-vector form, we expand by minors.
  const px = det3([da, db, 0] as const, [n1[1], n2[1], n3[1]] as const, [n1[2], n2[2], n3[2]] as const) / det;
  const py = det3([n1[0], n2[0], n3[0]] as const, [da, db, 0] as const, [n1[2], n2[2], n3[2]] as const) / det;
  const pz = det3([n1[0], n2[0], n3[0]] as const, [n1[1], n2[1], n3[1]] as const, [da, db, 0] as const) / det;
  return [px, py, pz];
}

/** Determinant of a 3×3 matrix whose **columns** are col0, col1, col2. */
function det3(col0: Vec3, col1: Vec3, col2: Vec3): number {
  return (
    col0[0] * (col1[1] * col2[2] - col1[2] * col2[1]) -
    col0[1] * (col1[0] * col2[2] - col1[2] * col2[0]) +
    col0[2] * (col1[0] * col2[1] - col1[1] * col2[0])
  );
}

/** Axis normal to a plane at a point. */
export function axisNormalToPlaneAtPoint(plane: ResolvedPlane, point: Vec3): ResolvedAxis {
  return { origin: point, direction: plane.normal };
}

// ─── Point constructors ─────────────────────────────────────────

export function pointMid(p1: Vec3, p2: Vec3): ResolvedPoint {
  return { position: scale(add(p1, p2), 0.5) };
}

export function pointCentroid(points: readonly Vec3[]): ResolvedPoint | null {
  if (points.length === 0) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const n = points.length;
  return { position: [x / n, y / n, z / n] };
}

/** Intersection of 3 planes. Returns null when planes are parallel or coincident. */
export function pointThreePlaneIntersect(
  a: ResolvedPlane,
  b: ResolvedPlane,
  c: ResolvedPlane,
): ResolvedPoint | null {
  const det = det3(a.normal, b.normal, c.normal);
  if (Math.abs(det) < EPS) return null;
  const da = dot(a.origin, a.normal);
  const db = dot(b.origin, b.normal);
  const dc = dot(c.origin, c.normal);
  // Solve A · p = (da, db, dc) by Cramer's rule. A's rows are normals.
  const px =
    det3([da, db, dc] as const, [a.normal[1], b.normal[1], c.normal[1]] as const, [a.normal[2], b.normal[2], c.normal[2]] as const) / det;
  const py =
    det3([a.normal[0], b.normal[0], c.normal[0]] as const, [da, db, dc] as const, [a.normal[2], b.normal[2], c.normal[2]] as const) / det;
  const pz =
    det3([a.normal[0], b.normal[0], c.normal[0]] as const, [a.normal[1], b.normal[1], c.normal[1]] as const, [da, db, dc] as const) / det;
  return { position: [px, py, pz] };
}

/** Project a point onto a plane (perpendicular projection). */
export function pointProjectToPlane(p: Vec3, plane: ResolvedPlane): ResolvedPoint {
  const d = dot(sub(p, plane.origin), plane.normal);
  return {
    position: [
      p[0] - d * plane.normal[0],
      p[1] - d * plane.normal[1],
      p[2] - d * plane.normal[2],
    ],
  };
}

/** Intersection of a line and a plane. Returns null when line is parallel
 *  to the plane (line·normal ≈ 0). */
export function pointLinePlaneIntersect(
  linePoint: Vec3,
  lineDir: Vec3,
  plane: ResolvedPlane,
): ResolvedPoint | null {
  const denom = dot(lineDir, plane.normal);
  if (Math.abs(denom) < EPS) return null;
  const t = dot(sub(plane.origin, linePoint), plane.normal) / denom;
  return {
    position: [
      linePoint[0] + lineDir[0] * t,
      linePoint[1] + lineDir[1] * t,
      linePoint[2] + lineDir[2] * t,
    ],
  };
}

// ─── Coord-system constructors ──────────────────────────────────

/** CSys from origin + 2 directions (z derived via right-hand cross product). */
export function csysFromOriginAndAxes(
  origin: Vec3,
  xDir: Vec3,
  yDir: Vec3,
): ResolvedCsys | null {
  const xUnit = normalize(xDir);
  if (xUnit === null) return null;
  // Gram-Schmidt orthogonalize yDir against xUnit.
  const yProj = dot(yDir, xUnit);
  const yOrtho = normalize([
    yDir[0] - yProj * xUnit[0],
    yDir[1] - yProj * xUnit[1],
    yDir[2] - yProj * xUnit[2],
  ]);
  if (yOrtho === null) return null; // x and y parallel
  const zUnit = cross(xUnit, yOrtho);
  return { origin, xAxis: xUnit, yAxis: yOrtho, zAxis: zUnit };
}

/** CSys aligned to a plane (z = plane normal, x = inPlaneRefDir projected). */
export function csysOnPlane(plane: ResolvedPlane, inPlaneRefDir: Vec3): ResolvedCsys | null {
  const z = plane.normal;
  const dotZ = dot(inPlaneRefDir, z);
  const xProj: Vec3 = [
    inPlaneRefDir[0] - dotZ * z[0],
    inPlaneRefDir[1] - dotZ * z[1],
    inPlaneRefDir[2] - dotZ * z[2],
  ];
  const xUnit = normalize(xProj);
  if (xUnit === null) return null;
  const yUnit = cross(z, xUnit);
  return { origin: plane.origin, xAxis: xUnit, yAxis: yUnit, zAxis: z };
}
