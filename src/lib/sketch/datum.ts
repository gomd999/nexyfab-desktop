/**
 * datum — Phase 2.5 of NexyFab Pro own-CAD (ADR-013).
 *
 * Datum (reference) geometry: named 3D points, lines, and planes used to
 * anchor sketches and feature axes. Datums are NOT part of the rendered
 * body — they're construction references the user can pick when starting
 * a new sketch or specifying a revolve axis.
 *
 * Phase 2.5 minimal scope:
 *   - DatumPoint  (3D named point)
 *   - DatumAxis   (infinite line through point + direction)
 *   - Standard datums: OriginPoint, X/Y/Z Axes, XY/YZ/XZ Planes
 *     (SketchPlane.planeXY etc. cover the planes — re-exported here)
 *   - Factories: through-two-points (axis), parallel-axis-offset (point)
 *
 * Out of scope (Phase 2.x+):
 *   - Coordinate system (3-axis frame) as a single datum object
 *   - Datum surfaces (warped reference patches)
 *   - User-named coordinate systems / inertial frames
 */

import { type Vec3, vec3, sub, normalize, add, scale, cross, dot, lengthOf } from './sketchPlane';

// ─── DatumPoint ───────────────────────────────────────────────────────────

export interface DatumPoint {
  readonly kind: 'datum_point';
  readonly id: string;
  readonly name: string;
  readonly position: Vec3;
}

export function datumPoint(id: string, name: string, position: Vec3): DatumPoint {
  return { kind: 'datum_point', id, name, position };
}

// ─── DatumAxis ────────────────────────────────────────────────────────────

export interface DatumAxis {
  readonly kind: 'datum_axis';
  readonly id: string;
  readonly name: string;
  /** A point on the axis (axis is infinite in both directions). */
  readonly origin: Vec3;
  /** Unit direction vector. */
  readonly direction: Vec3;
}

export function datumAxis(id: string, name: string, origin: Vec3, directionRaw: Vec3): DatumAxis {
  const direction = normalize(directionRaw);
  return { kind: 'datum_axis', id, name, origin, direction };
}

/** Build an axis through two distinct datum points (or arbitrary Vec3s). */
export function datumAxisThroughPoints(id: string, name: string, a: Vec3, b: Vec3): DatumAxis {
  const dir = sub(b, a);
  if (lengthOf(dir) < 1e-9) {
    throw new Error(`datumAxisThroughPoints: ${id} - points are coincident`);
  }
  return datumAxis(id, name, a, dir);
}

// ─── standard origin datums ───────────────────────────────────────────────

export const ORIGIN_POINT: DatumPoint = datumPoint('origin', 'Origin', vec3(0, 0, 0));
export const X_AXIS: DatumAxis = datumAxis('axis_x', 'X', vec3(0, 0, 0), vec3(1, 0, 0));
export const Y_AXIS: DatumAxis = datumAxis('axis_y', 'Y', vec3(0, 0, 0), vec3(0, 1, 0));
export const Z_AXIS: DatumAxis = datumAxis('axis_z', 'Z', vec3(0, 0, 0), vec3(0, 0, 1));

// ─── derived datums ───────────────────────────────────────────────────────

/**
 * A point offset from another point along a unit direction.
 * Useful for "point 10mm above another datum along the Z axis".
 */
export function offsetPoint(
  id: string,
  name: string,
  basePoint: DatumPoint,
  direction: Vec3,
  distance: number,
): DatumPoint {
  const unit = normalize(direction);
  return datumPoint(id, name, add(basePoint.position, scale(unit, distance)));
}

/**
 * Project a Vec3 onto a DatumAxis. Returns the foot of the perpendicular
 * (closest point on the axis to the input) plus the perpendicular distance.
 */
export function projectOntoAxis(p: Vec3, axis: DatumAxis): { foot: Vec3; perpDistance: number } {
  const rel = sub(p, axis.origin);
  const t = dot(rel, axis.direction);
  const foot = add(axis.origin, scale(axis.direction, t));
  const perp = sub(p, foot);
  return { foot, perpDistance: lengthOf(perp) };
}

/**
 * The shortest distance between two skew/parallel/intersecting axes. Returns
 * 0 if the axes intersect or are coincident. Caller can use the returned
 * `parallel` flag to distinguish parallel-but-non-coincident (distance > 0)
 * from skew (also distance > 0 but with non-parallel directions).
 */
export function axisToAxisDistance(
  a: DatumAxis,
  b: DatumAxis,
): { distance: number; parallel: boolean } {
  const n = cross(a.direction, b.direction);
  const nLen = lengthOf(n);
  if (nLen < 1e-9) {
    // Parallel — distance from any point on a to b's axis.
    const proj = projectOntoAxis(a.origin, b);
    return { distance: proj.perpDistance, parallel: true };
  }
  // Skew or intersecting — formula: |(b.origin - a.origin) · n| / |n|.
  const w = sub(b.origin, a.origin);
  const distance = Math.abs(dot(w, n)) / nLen;
  return { distance, parallel: false };
}

// Re-export the standard planes from sketchPlane so callers can `import
// { XY_PLANE } from '@/lib/sketch/datum'` if they prefer the datum-prefixed
// view of the world.
export { planeXY as XY_PLANE_FACTORY, planeYZ as YZ_PLANE_FACTORY, planeXZ as XZ_PLANE_FACTORY } from './sketchPlane';
