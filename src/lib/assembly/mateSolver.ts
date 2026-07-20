/**
 * mateSolver — Phase 3.2 starter of NexyFab Pro own-CAD (ADR-013).
 *
 * Rigid-body placement solver. Phase 3.2 full deliverable is the
 * iterative Newton-with-Lagrange-multiplier solver for arbitrary mate
 * graphs; this starter covers only the analytical single-mate case
 * (1 fixed part + 1 free part + 1 concentric or coincident mate).
 *
 * The analytical solutions here also serve as good initial guesses for
 * the iterative solver in Phase 3.2.2 — getting close-to-feasible
 * placement before Newton kicks in cuts iteration count drastically.
 *
 * Scope (Phase 3.2.1 — analytical):
 *   - placeAxisOntoAxis(free, target) — rotates + translates free part so
 *     its axis becomes collinear with the target axis (concentric mate).
 *   - placePointOntoPoint(free, target) — pure translation to make a
 *     reference point on free coincide with target (coincident point/point).
 *   - placePlaneOntoPlane(free, target) — rotation + translation to make
 *     a reference plane on free coincident with target plane.
 *
 * Out of scope (Phase 3.2.2+):
 *   - Multi-mate Newton solver
 *   - Conflict / redundancy detection (Jacobian rank)
 *   - Sub-assembly rigid composition
 *   - Bilateral mates (parts on both sides free)
 *
 * NOTE: This module does NOT consume Mate IRs directly — it works with
 * already-resolved geometry refs (3D vectors + axes). The Phase 3.2.2
 * solver will translate Mate IRs → these primitives before iterating.
 */

import { type Vec3, vec3, add, sub, dot, cross, normalize, scale, lengthOf } from '@/lib/sketch/sketchPlane';
import { type Quat, IDENTITY_QUAT, quat } from './assemblyState';

// ─── quaternion helpers ──────────────────────────────────────────────────

export function quatMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatNormalize(q: Quat): Quat {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len < 1e-12) return IDENTITY_QUAT;
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

/** Rotate a Vec3 by a unit Quat. */
export function rotateVec(v: Vec3, q: Quat): Vec3 {
  // v' = q * v * q^-1; standard formula.
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/**
 * Quaternion that rotates `from` (unit) onto `to` (unit). For parallel
 * inputs returns identity; for anti-parallel returns a 180° rotation
 * around an arbitrary perpendicular axis.
 */
export function quatFromTo(from: Vec3, to: Vec3): Quat {
  const f = normalize(from);
  const t = normalize(to);
  const d = dot(f, t);
  if (d > 1 - 1e-9) return IDENTITY_QUAT;
  if (d < -1 + 1e-9) {
    // 180° rotation: pick the smallest world axis least aligned with f.
    const ax = Math.abs(f.x);
    const ay = Math.abs(f.y);
    const az = Math.abs(f.z);
    let seed: Vec3;
    if (ax <= ay && ax <= az) seed = vec3(1, 0, 0);
    else if (ay <= ax && ay <= az) seed = vec3(0, 1, 0);
    else seed = vec3(0, 0, 1);
    const axis = normalize(cross(f, seed));
    return quat(axis.x, axis.y, axis.z, 0);
  }
  const c = cross(f, t);
  const w = 1 + d;
  return quatNormalize({ x: c.x, y: c.y, z: c.z, w });
}

// ─── target shapes ───────────────────────────────────────────────────────

export interface AxisInWorld {
  origin: Vec3;
  /** Unit direction. */
  direction: Vec3;
}

export interface PlaneInWorld {
  origin: Vec3;
  /** Unit normal. */
  normal: Vec3;
}

// ─── placement output ────────────────────────────────────────────────────

export interface Placement {
  /** New position of the free part's origin in world frame. */
  position: Vec3;
  /** New orientation of the free part. */
  orientation: Quat;
}

// ─── placeAxisOntoAxis (concentric) ──────────────────────────────────────

/**
 * Compute the transform that maps the free part such that
 * `freeAxis` (expressed in free-part-local space) becomes collinear with
 * `targetAxis` (in world space). Equivalent to a single concentric mate
 * with the free part as the dependent.
 *
 * Inputs:
 *   - freeAxis: axis in the free part's LOCAL frame (origin + direction).
 *   - currentPlacement: free part's current world placement.
 *   - targetAxis: axis in WORLD space (typically derived from the fixed
 *     part's resolved geometry).
 *
 * Returns a new Placement (orientation + position) for the free part.
 * Leaves the axial slide DoF (1) and rotation-about-axis DoF (1) at
 * whatever current value puts the free part as close as possible to its
 * pre-mate location (minimum-disruption placement).
 */
export function placeAxisOntoAxis(
  freeAxis: AxisInWorld,
  currentPlacement: Placement,
  targetAxis: AxisInWorld,
): Placement {
  // Step 1: compute the world-frame free axis BEFORE rotation.
  const currentDirWorld = rotateVec(freeAxis.direction, currentPlacement.orientation);
  const currentOriginWorld = add(
    currentPlacement.position,
    rotateVec(freeAxis.origin, currentPlacement.orientation),
  );

  // Step 2: rotation that aligns the free axis direction with the target.
  const alignRot = quatFromTo(currentDirWorld, targetAxis.direction);
  const newOrientation = quatNormalize(quatMul(alignRot, currentPlacement.orientation));

  // Step 3: now re-compute the free axis origin in world after rotation.
  const rotatedOriginWorld = applyRotationAroundPoint(
    currentOriginWorld,
    alignRot,
    currentPlacement.position,
  );

  // Step 4: translate so the free axis passes through the target axis. The
  // simplest minimum-disruption choice: shift by the perpendicular component
  // of (target.origin - rotatedFreeOrigin) projected onto the plane
  // perpendicular to the target axis.
  const w = sub(targetAxis.origin, rotatedOriginWorld);
  const along = dot(w, targetAxis.direction); // free to slide along axis
  const perp = sub(w, scale(targetAxis.direction, along));
  // perp is the shift needed; rotation-induced position drift was around
  // currentPlacement.position so we apply the perp to the whole part.
  // We discard the `along` component → preserves axial position.
  const newPosition = add(currentPlacement.position, perp);

  return { position: newPosition, orientation: newOrientation };
}

// ─── placePointOntoPoint (coincident point/point) ────────────────────────

/**
 * Pure translation: move the free part so a named point on it coincides
 * with a target world point. No rotation change.
 */
export function placePointOntoPoint(
  freePointLocal: Vec3,
  currentPlacement: Placement,
  targetWorldPoint: Vec3,
): Placement {
  const currentPointWorld = add(
    currentPlacement.position,
    rotateVec(freePointLocal, currentPlacement.orientation),
  );
  const shift = sub(targetWorldPoint, currentPointWorld);
  return {
    position: add(currentPlacement.position, shift),
    orientation: currentPlacement.orientation,
  };
}

// ─── placePlaneOntoPlane (coincident plane/plane) ────────────────────────

/**
 * Rotate the free part so a named plane on it (local normal + origin) has
 * its normal anti-parallel to the target plane's normal (mating surfaces
 * face each other, hence anti-parallel), then translate so the planes are
 * coincident.
 *
 * Slide DoF along the plane (2) and spin DoF around the normal (1) are
 * left at minimum-disruption values from the current placement.
 */
export function placePlaneOntoPlane(
  freePlane: PlaneInWorld,
  currentPlacement: Placement,
  targetPlane: PlaneInWorld,
): Placement {
  const currentNormalWorld = rotateVec(freePlane.normal, currentPlacement.orientation);
  const currentOriginWorld = add(
    currentPlacement.position,
    rotateVec(freePlane.origin, currentPlacement.orientation),
  );
  // Mating: free normal should face opposite the target normal.
  const targetAntiNormal = scale(targetPlane.normal, -1);
  const rot = quatFromTo(currentNormalWorld, targetAntiNormal);
  const newOrientation = quatNormalize(quatMul(rot, currentPlacement.orientation));
  // Translate along target normal so the free plane sits on the target.
  const rotatedOrigin = applyRotationAroundPoint(
    currentOriginWorld,
    rot,
    currentPlacement.position,
  );
  const w = sub(targetPlane.origin, rotatedOrigin);
  const along = dot(w, targetPlane.normal); // only this component matters
  const shift = scale(targetPlane.normal, along);
  return { position: add(currentPlacement.position, shift), orientation: newOrientation };
}

// ─── internals ────────────────────────────────────────────────────────────

function applyRotationAroundPoint(point: Vec3, rot: Quat, pivot: Vec3): Vec3 {
  const rel = sub(point, pivot);
  const rotated = rotateVec(rel, rot);
  return add(pivot, rotated);
}

// ─── distance helpers (for tests + Phase 3.2.2 verification) ─────────────

/** Distance between an axis and a 3D point. */
export function distancePointToAxis(p: Vec3, axis: AxisInWorld): number {
  const rel = sub(p, axis.origin);
  const along = dot(rel, axis.direction);
  const perp = sub(rel, scale(axis.direction, along));
  return lengthOf(perp);
}

/** Distance between two infinite axes (parallel → perpendicular distance;
 *  skew → closest-approach distance; intersecting → 0). */
export function distanceAxisToAxis(a: AxisInWorld, b: AxisInWorld): number {
  const n = cross(a.direction, b.direction);
  const nLen = lengthOf(n);
  if (nLen < 1e-9) {
    // Parallel.
    return distancePointToAxis(a.origin, b);
  }
  return Math.abs(dot(sub(b.origin, a.origin), n)) / nLen;
}

// ─── public programmatic facade (W5-F, dogfood F14) ──────────────────────
//
// `solveMates` is the one-call entry point designers reach for first:
//   solveMates(assembly, mates, opts?) → { converged, parts, ... }
// It lives in ./api.ts (to keep this module's analytical core focused) and
// is re-exported here because `@/lib/assembly/mateSolver` is the import
// path a designer naturally guesses. Purely additive — every pre-existing
// export above is untouched.

export {
  solveMates,
  AssemblyApiError,
  type SolveAssemblyInput,
  type SolvePartSpec,
  type PartRefSpec,
  type SolveMateSpec,
  type MateSideSpec,
  type SolveMatesOptions,
  type SolveMatesResult,
  type SolvedPartPlacement,
} from './api';
