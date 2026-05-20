/**
 * referenceGeometry.ts — Reference plane / axis / coordinate system / point.
 *
 * Reference geometry is the *scaffolding* of a CAD model: not visible
 * in the final part, but used as anchors for sketches, features, mates.
 *
 * SolidWorks emits explicit "Front/Top/Right" planes + lets users add
 * custom planes ("offset 25mm from Front", "through 3 vertices",
 * "perpendicular to a curve"). This module ships the math for:
 *
 *   - **Plane**: 6 construction modes
 *   - **Axis**: 5 construction modes
 *   - **Coordinate system**: 3 construction modes
 *   - **Point**: 5 construction modes
 *
 * Each construction returns a normalized representation (point + normal
 * for plane, point + direction for axis, etc) that the rest of the
 * pipeline can consume as a "this is forever-stable, even when the
 * underlying topology changes" reference.
 */

export type Vec3 = [number, number, number];

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// ── Reference Plane ──────────────────────────────────────────────

export interface ReferencePlane {
  /** A point lying on the plane. */
  origin: Vec3;
  /** Unit normal of the plane. */
  normal: Vec3;
  /** Display label. */
  label: string;
}

/** Plane through 3 points (counter-clockwise normal = (p2-p1) × (p3-p1)). */
export function planeFromThreePoints(p1: Vec3, p2: Vec3, p3: Vec3, label = 'Plane'): ReferencePlane {
  const normal = normalize(cross(sub(p2, p1), sub(p3, p1)));
  return { origin: p1, normal, label };
}

/** Plane offset from another plane along its normal. */
export function planeOffset(base: ReferencePlane, distanceMm: number, label = 'Offset Plane'): ReferencePlane {
  return {
    origin: [
      base.origin[0] + base.normal[0] * distanceMm,
      base.origin[1] + base.normal[1] * distanceMm,
      base.origin[2] + base.normal[2] * distanceMm,
    ],
    normal: base.normal,
    label,
  };
}

/** Plane parallel to a reference plane, passing through a point. */
export function planeParallelThroughPoint(base: ReferencePlane, point: Vec3, label = 'Parallel Plane'): ReferencePlane {
  return { origin: point, normal: base.normal, label };
}

/** Plane at midpoint of two parallel planes. */
export function planeMidBetween(a: ReferencePlane, b: ReferencePlane, label = 'Mid Plane'): ReferencePlane | null {
  // Require parallel normals (dot ≈ ±1).
  const d = Math.abs(dot(a.normal, b.normal));
  if (d < 0.999) return null;
  return {
    origin: [(a.origin[0] + b.origin[0]) / 2, (a.origin[1] + b.origin[1]) / 2, (a.origin[2] + b.origin[2]) / 2],
    normal: a.normal,
    label,
  };
}

/** Plane normal to a curve at a given parameter value.
 *  Caller supplies the curve's tangent at that point. */
export function planeNormalToCurve(point: Vec3, tangent: Vec3, label = 'Normal Plane'): ReferencePlane {
  return { origin: point, normal: normalize(tangent), label };
}

/** Plane containing a line and a point. */
export function planeLineAndPoint(linePoint: Vec3, lineDir: Vec3, externalPoint: Vec3, label = 'Through Line+Point'): ReferencePlane | null {
  const toExternal = sub(externalPoint, linePoint);
  const n = cross(normalize(lineDir), toExternal);
  if (Math.hypot(n[0], n[1], n[2]) < 1e-6) return null; // point on line
  return { origin: linePoint, normal: normalize(n), label };
}

// ── Reference Axis ───────────────────────────────────────────────

export interface ReferenceAxis {
  origin: Vec3;
  direction: Vec3;
  label: string;
}

/** Axis from two points. */
export function axisFromTwoPoints(p1: Vec3, p2: Vec3, label = 'Axis'): ReferenceAxis | null {
  const d = sub(p2, p1);
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-9) return null;
  return { origin: p1, direction: normalize(d), label };
}

/** Axis at intersection of two planes. */
export function axisFromTwoPlanes(a: ReferencePlane, b: ReferencePlane, label = 'Plane Intersect'): ReferenceAxis | null {
  const dir = cross(a.normal, b.normal);
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (len < 1e-6) return null; // parallel planes
  // Find a point on both planes — solve the 3×3 system.
  // dot(p, a.n) = dot(a.o, a.n), dot(p, b.n) = dot(b.o, b.n).
  // Pick p on the line such that one coordinate is 0 to make solvable.
  const da = dot(a.origin, a.normal);
  const db = dot(b.origin, b.normal);
  const n1 = a.normal, n2 = b.normal, n3 = normalize(dir);
  // Solve [n1; n2; n3] · p = [da; db; 0]. Cramer's rule.
  const det =
    n1[0] * (n2[1] * n3[2] - n2[2] * n3[1])
    - n1[1] * (n2[0] * n3[2] - n2[2] * n3[0])
    + n1[2] * (n2[0] * n3[1] - n2[1] * n3[0]);
  if (Math.abs(det) < 1e-9) return null;
  const px = (
    da * (n2[1] * n3[2] - n2[2] * n3[1])
    - n1[1] * (db * n3[2] - 0)
    + n1[2] * (db * n3[1] - 0)
  ) / det;
  const py = (
    n1[0] * (db * n3[2] - 0)
    - da * (n2[0] * n3[2] - n2[2] * n3[0])
    + n1[2] * (n2[0] * 0 - db * n3[0])
  ) / det;
  const pz = (
    n1[0] * (n2[1] * 0 - db * n3[1])
    - n1[1] * (n2[0] * 0 - db * n3[0])
    + da * (n2[0] * n3[1] - n2[1] * n3[0])
  ) / det;
  return { origin: [px, py, pz], direction: normalize(dir), label };
}

/** Axis through a point with a given direction. */
export function axisFromPointDirection(point: Vec3, direction: Vec3, label = 'Axis'): ReferenceAxis {
  return { origin: point, direction: normalize(direction), label };
}

/** Axis from an edge (caller supplies edge endpoints). */
export function axisFromEdge(p1: Vec3, p2: Vec3, label = 'Edge Axis'): ReferenceAxis | null {
  return axisFromTwoPoints(p1, p2, label);
}

/** Axis from a circular face — the face's center + normal direction. */
export function axisFromCircularFace(center: Vec3, normal: Vec3, label = 'Circular Axis'): ReferenceAxis {
  return { origin: center, direction: normalize(normal), label };
}

// ── Reference Coordinate System ──────────────────────────────────

export interface ReferenceCsys {
  origin: Vec3;
  /** 3 unit basis vectors. */
  xAxis: Vec3;
  yAxis: Vec3;
  zAxis: Vec3;
  label: string;
}

/** Build a CSYS from an origin + 2 directions (z derived by cross). */
export function csysFromOriginAndAxes(origin: Vec3, xDir: Vec3, yDir: Vec3, label = 'CSys'): ReferenceCsys {
  const x = normalize(xDir);
  // Orthogonalize y against x via Gram-Schmidt.
  const yDotX = dot(yDir, x);
  const yOrtho = normalize([yDir[0] - yDotX * x[0], yDir[1] - yDotX * x[1], yDir[2] - yDotX * x[2]]);
  const z = cross(x, yOrtho);
  return { origin, xAxis: x, yAxis: yOrtho, zAxis: z, label };
}

/** CSYS aligned to a plane (z = plane normal, x/y in the plane). */
export function csysOnPlane(plane: ReferencePlane, inPlaneRefDir: Vec3, label = 'Plane CSys'): ReferenceCsys {
  const z = plane.normal;
  // Project inPlaneRefDir to the plane.
  const projDot = dot(inPlaneRefDir, z);
  const xRaw: Vec3 = [
    inPlaneRefDir[0] - projDot * z[0],
    inPlaneRefDir[1] - projDot * z[1],
    inPlaneRefDir[2] - projDot * z[2],
  ];
  const x = normalize(xRaw);
  const y = cross(z, x);
  return { origin: plane.origin, xAxis: x, yAxis: y, zAxis: z, label };
}

/** World coordinate system at origin. */
export const WORLD_CSYS: ReferenceCsys = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  zAxis: [0, 0, 1],
  label: 'World',
};

// ── Reference Point ──────────────────────────────────────────────

export interface ReferencePoint {
  position: Vec3;
  label: string;
}

/** Midpoint of two points. */
export function pointMid(p1: Vec3, p2: Vec3, label = 'Mid Point'): ReferencePoint {
  return {
    position: [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2],
    label,
  };
}

/** Centroid of N points. */
export function pointCentroid(points: Vec3[], label = 'Centroid'): ReferencePoint | null {
  if (points.length === 0) return null;
  let x = 0, y = 0, z = 0;
  for (const p of points) { x += p[0]; y += p[1]; z += p[2]; }
  return { position: [x / points.length, y / points.length, z / points.length], label };
}

/** Intersection of three planes. */
export function pointThreePlaneIntersect(a: ReferencePlane, b: ReferencePlane, c: ReferencePlane, label = '3-Plane'): ReferencePoint | null {
  const det =
    a.normal[0] * (b.normal[1] * c.normal[2] - b.normal[2] * c.normal[1])
    - a.normal[1] * (b.normal[0] * c.normal[2] - b.normal[2] * c.normal[0])
    + a.normal[2] * (b.normal[0] * c.normal[1] - b.normal[1] * c.normal[0]);
  if (Math.abs(det) < 1e-9) return null;
  const da = dot(a.origin, a.normal);
  const db = dot(b.origin, b.normal);
  const dc = dot(c.origin, c.normal);
  const px = (
    da * (b.normal[1] * c.normal[2] - b.normal[2] * c.normal[1])
    - a.normal[1] * (db * c.normal[2] - b.normal[2] * dc)
    + a.normal[2] * (db * c.normal[1] - b.normal[1] * dc)
  ) / det;
  const py = (
    a.normal[0] * (db * c.normal[2] - b.normal[2] * dc)
    - da * (b.normal[0] * c.normal[2] - b.normal[2] * c.normal[0])
    + a.normal[2] * (b.normal[0] * dc - db * c.normal[0])
  ) / det;
  const pz = (
    a.normal[0] * (b.normal[1] * dc - db * c.normal[1])
    - a.normal[1] * (b.normal[0] * dc - db * c.normal[0])
    + da * (b.normal[0] * c.normal[1] - b.normal[1] * c.normal[0])
  ) / det;
  return { position: [px, py, pz], label };
}

/** Project a point onto a plane. */
export function pointProjectToPlane(p: Vec3, plane: ReferencePlane, label = 'Projected'): ReferencePoint {
  const d = dot(sub(p, plane.origin), plane.normal);
  return {
    position: [p[0] - d * plane.normal[0], p[1] - d * plane.normal[1], p[2] - d * plane.normal[2]],
    label,
  };
}

/** Intersection of a line + plane. */
export function pointLinePlaneIntersect(linePoint: Vec3, lineDir: Vec3, plane: ReferencePlane, label = 'Line-Plane'): ReferencePoint | null {
  const denom = dot(lineDir, plane.normal);
  if (Math.abs(denom) < 1e-9) return null; // line parallel to plane
  const t = dot(sub(plane.origin, linePoint), plane.normal) / denom;
  return {
    position: [linePoint[0] + lineDir[0] * t, linePoint[1] + lineDir[1] * t, linePoint[2] + lineDir[2] * t],
    label,
  };
}

// ── Standard planes (Front / Top / Right) ────────────────────────

export const FRONT_PLANE: ReferencePlane = { origin: [0, 0, 0], normal: [0, 0, 1], label: 'Front' };
export const TOP_PLANE: ReferencePlane   = { origin: [0, 0, 0], normal: [0, 1, 0], label: 'Top' };
export const RIGHT_PLANE: ReferencePlane = { origin: [0, 0, 0], normal: [1, 0, 0], label: 'Right' };

export const STANDARD_PLANES = [FRONT_PLANE, TOP_PLANE, RIGHT_PLANE];
