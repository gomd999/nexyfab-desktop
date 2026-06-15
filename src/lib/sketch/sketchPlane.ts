/**
 * SketchPlane — Phase 1.4 of NexyFab Pro own-CAD (ADR-013).
 *
 * 2D sketch plane embedded in 3D world space. Used to:
 *   - convert sketch entities (2D u,v coords) into 3D coords for OCCT
 *     extrude/revolve/sweep (Phase 2),
 *   - re-project a 3D selection back into sketch coords for editing,
 *   - represent planar references (face / datum-plane) that constrain
 *     a sketch's orientation in space.
 *
 * Pure math, no Three.js / OCCT dependency — easier to unit-test, and the
 * 3D viewport translates these Vec3s into its own vector types at the edge.
 *
 * Sign convention: right-handed. normal = u × v. localToWorld preserves
 * orientation. worldToLocal returns (u, v) plus the signed perpendicular
 * distance from the plane (`w`) so callers can decide whether a 3D point
 * is "in the plane" for snapping/projection.
 */

// ─── Vec3 ─────────────────────────────────────────────────────────────────

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lengthOf(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

export function normalize(v: Vec3): Vec3 {
  const len = lengthOf(v);
  if (len < 1e-12) {
    throw new Error('normalize: zero-length vector');
  }
  return scale(v, 1 / len);
}

// ─── 2D point on the sketch plane ────────────────────────────────────────

export interface Point2D {
  readonly u: number;
  readonly v: number;
}

export function point2d(u: number, v: number): Point2D {
  return { u, v };
}

// ─── SketchPlane ─────────────────────────────────────────────────────────

/**
 * A 2D plane embedded in 3D. Defined by an origin and two orthonormal
 * in-plane basis vectors. Normal is computed as `u × v` (right-handed).
 *
 * Construction is via factory functions (validates orthonormality).
 * The class itself never mutates — for a translated/rotated plane,
 * construct a new instance.
 */
export class SketchPlane {
  readonly origin: Vec3;
  readonly uAxis: Vec3;
  readonly vAxis: Vec3;
  readonly normal: Vec3;

  /** @internal — use `fromAxes`, `fromThreePoints`, `XY`, etc. */
  constructor(origin: Vec3, uAxis: Vec3, vAxis: Vec3) {
    this.origin = origin;
    this.uAxis = uAxis;
    this.vAxis = vAxis;
    this.normal = normalize(cross(uAxis, vAxis));
  }

  /** Convert a 2D sketch point to 3D world coordinates. */
  localToWorld(p: Point2D): Vec3 {
    return add(add(this.origin, scale(this.uAxis, p.u)), scale(this.vAxis, p.v));
  }

  /**
   * Project a 3D world point onto this plane's 2D coordinates.
   * Returns `(u, v)` plus the signed perpendicular distance `w` from the
   * plane. `Math.abs(w) < tol` means the point lies in the plane.
   */
  worldToLocal(p: Vec3): { u: number; v: number; w: number } {
    const rel = sub(p, this.origin);
    return {
      u: dot(rel, this.uAxis),
      v: dot(rel, this.vAxis),
      w: dot(rel, this.normal),
    };
  }

  /** True if a 3D point is within `tol` of the plane. Default tol: 1e-6. */
  contains(p: Vec3, tol: number = 1e-6): boolean {
    return Math.abs(this.worldToLocal(p).w) < tol;
  }

  /**
   * Return a new plane translated along its own normal by `offset` (mm).
   * Useful for "parallel plane at offset N from this face".
   */
  offsetAlongNormal(offset: number): SketchPlane {
    return new SketchPlane(add(this.origin, scale(this.normal, offset)), this.uAxis, this.vAxis);
  }

  /** Translate a sketch line (its two endpoint 2D coords) into 3D. */
  edge3D(a: Point2D, b: Point2D): { a: Vec3; b: Vec3 } {
    return { a: this.localToWorld(a), b: this.localToWorld(b) };
  }
}

// ─── Standard planes ─────────────────────────────────────────────────────

export function planeXY(): SketchPlane {
  return new SketchPlane(vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0));
}

export function planeYZ(): SketchPlane {
  return new SketchPlane(vec3(0, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1));
}

export function planeXZ(): SketchPlane {
  return new SketchPlane(vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 0, 1));
}

// ─── Construction factories ──────────────────────────────────────────────

/**
 * Plane from an origin + 2 already-orthonormal axes.
 * Validates orthonormality (within `tol`). Returns the same as the
 * constructor but with a runtime check — call this if axes come from
 * user input.
 */
export function fromAxes(
  origin: Vec3,
  uAxis: Vec3,
  vAxis: Vec3,
  tol: number = 1e-6,
): SketchPlane {
  const uLen = lengthOf(uAxis);
  const vLen = lengthOf(vAxis);
  if (Math.abs(uLen - 1) > tol) {
    throw new Error(`fromAxes: uAxis is not unit length (|u|=${uLen})`);
  }
  if (Math.abs(vLen - 1) > tol) {
    throw new Error(`fromAxes: vAxis is not unit length (|v|=${vLen})`);
  }
  if (Math.abs(dot(uAxis, vAxis)) > tol) {
    throw new Error(`fromAxes: uAxis and vAxis are not orthogonal (u·v=${dot(uAxis, vAxis)})`);
  }
  return new SketchPlane(origin, uAxis, vAxis);
}

/**
 * Plane through 3 non-collinear points.
 * Origin = p1, uAxis = normalize(p2-p1), vAxis = Gram-Schmidt of (p3-p1).
 * Throws if the points are collinear (cross-product is near-zero).
 */
export function fromThreePoints(p1: Vec3, p2: Vec3, p3: Vec3): SketchPlane {
  const uRaw = sub(p2, p1);
  const uAxis = normalize(uRaw);
  const w = sub(p3, p1);
  // remove the component of w along uAxis to make v orthogonal to u
  const wAlongU = scale(uAxis, dot(w, uAxis));
  const vRaw = sub(w, wAlongU);
  const vLen = lengthOf(vRaw);
  if (vLen < 1e-9) {
    throw new Error('fromThreePoints: points are collinear');
  }
  const vAxis = scale(vRaw, 1 / vLen);
  return new SketchPlane(p1, uAxis, vAxis);
}

/**
 * Plane from origin + normal vector. uAxis and vAxis are chosen automatically
 * (picks the most numerically stable seed). Use this when only the plane's
 * orientation matters (sketch can rotate freely within it before constraints
 * pin it down).
 */
export function fromOriginAndNormal(origin: Vec3, normalRaw: Vec3): SketchPlane {
  const n = normalize(normalRaw);
  // Pick the world axis least aligned with n as our seed.
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  let seed: Vec3;
  if (ax <= ay && ax <= az) seed = vec3(1, 0, 0);
  else if (ay <= ax && ay <= az) seed = vec3(0, 1, 0);
  else seed = vec3(0, 0, 1);
  // Project seed onto plane (subtract n-component) → u
  const uAxis = normalize(sub(seed, scale(n, dot(seed, n))));
  // v = n × u  (right-handed)
  const vAxis = normalize(cross(n, uAxis));
  return new SketchPlane(origin, uAxis, vAxis);
}
