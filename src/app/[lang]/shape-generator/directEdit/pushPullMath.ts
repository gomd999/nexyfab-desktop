/**
 * pushPullMath.ts — Wave 2 Phase 3 Track E1.
 *
 * Pure math helpers for push-pull face editing. No THREE.js, no React.
 * Tests run these in isolation; the mesh-level applier in
 * `applyPushPull.ts` composes them with the BufferGeometry traversal.
 *
 * Why split:
 *   - The math (projection / validation / snap) is deterministic and
 *     cheap; it can run inside the live-drag loop hundreds of times a
 *     second. Tests cover known geometry to lock the projection sign
 *     convention.
 *   - The mesh applier needs THREE.js BufferGeometry + face provenance
 *     reads + normal recomputation. It's expensive and is exercised
 *     by the perf-budget test in `applyPushPull.test.ts`.
 */

export type Vec3 = readonly [number, number, number];

/** Smallest meaningful drag in mm. Anything below this is rounded to
 *  zero so the controller doesn't record a no-op into the stack. */
export const PUSH_PULL_EPSILON_MM = 1e-4;

/** Maximum |offset| allowed by `validatePushPullOffset` as a sanity
 *  bound. Mesh-level push-pull on a non-B-Rep substrate can degenerate
 *  if you ask for a 10m offset on a 10mm face — we refuse early.
 *  Tuned against the M8-fixture scale used by the Wave 2 perf tests. */
export const PUSH_PULL_MAX_OFFSET_MM = 1000;

/** Minimum face-normal magnitude before we consider it "non-degenerate".
 *  A normal close to zero means the face was tagged but its geometry
 *  is degenerate (zero-area triangle) — refuse the op rather than
 *  divide by zero. */
const MIN_NORMAL_LEN = 1e-6;

/**
 * Project a drag vector onto the face normal and return the scalar
 * offset (positive = outward push, negative = inward pull).
 *
 * Sign convention:
 *   - If the drag vector points along +normal, the offset is positive.
 *   - If the drag vector points along -normal, the offset is negative.
 *
 * The face normal is assumed but not required to be unit length; the
 * function normalises internally. Returning 0 for a degenerate normal
 * is intentional — callers treat zero as "no-op, don't record".
 */
export function computePushPullOffset(
  faceNormal: Vec3,
  dragDelta: Vec3,
): number {
  const [nx, ny, nz] = faceNormal;
  const len = Math.hypot(nx, ny, nz);
  if (len < MIN_NORMAL_LEN) return 0;
  const ux = nx / len;
  const uy = ny / len;
  const uz = nz / len;
  // Standard scalar projection of `dragDelta` onto the unit normal.
  const offset = dragDelta[0] * ux + dragDelta[1] * uy + dragDelta[2] * uz;
  // Guard against numerical noise that flips a true zero drag into a
  // sub-epsilon offset — the controller would otherwise pollute the
  // session stack with no-op entries.
  return Math.abs(offset) < PUSH_PULL_EPSILON_MM ? 0 : offset;
}

/** Inputs accepted by `validatePushPullOffset`. We don't depend on a
 *  THREE.js BufferGeometry here — the applier reads the geometry and
 *  passes the bounding box dimensions through. */
export interface PushPullValidationContext {
  /** Side lengths of the geometry's bounding box, in mm.
   *  `[xExtent, yExtent, zExtent]`. */
  geometryBboxExtent: Vec3;
  /** Side lengths of the picked face's bounding box, projected into
   *  the plane perpendicular to the face normal. Two non-zero values
   *  for a planar face. Used to flag "offset larger than face" cases
   *  which the mesh-level applier cannot stitch reliably. */
  faceBboxExtent: Vec3;
}

export type PushPullValidationResult =
  | { ok: true }
  | { ok: false; reason: 'too_large' | 'self_intersect' | 'invalid_offset' };

/**
 * Validate a push-pull offset BEFORE applying it. Pure check; does not
 * touch the mesh.
 *
 * Refusal cases:
 *   - `invalid_offset` — non-finite or below epsilon.
 *   - `too_large` — magnitude exceeds `PUSH_PULL_MAX_OFFSET_MM` or
 *     exceeds the geometry's largest extent (would yank the face
 *     out of the part bounding box by more than the part is wide).
 *   - `self_intersect` — heuristic: if inward pull magnitude exceeds
 *     the shortest face extent the face will likely collide with the
 *     opposite face. Conservative; B-Rep solver would do this exactly.
 *     Returns `ok: true` for outward pushes regardless of face size.
 */
export function validatePushPullOffset(
  offset: number,
  ctx: PushPullValidationContext,
): PushPullValidationResult {
  if (!Number.isFinite(offset)) {
    return { ok: false, reason: 'invalid_offset' };
  }
  if (Math.abs(offset) < PUSH_PULL_EPSILON_MM) {
    return { ok: false, reason: 'invalid_offset' };
  }
  if (Math.abs(offset) > PUSH_PULL_MAX_OFFSET_MM) {
    return { ok: false, reason: 'too_large' };
  }
  const maxGeomExtent = Math.max(...ctx.geometryBboxExtent);
  if (Math.abs(offset) > maxGeomExtent * 2) {
    // Stretching the face by more than 2× the part's largest dim is
    // never what the user meant — refuse and let them retry.
    return { ok: false, reason: 'too_large' };
  }
  if (offset < 0) {
    // Inward pull: refuse if magnitude exceeds the shortest in-plane
    // face extent. (`faceBboxExtent` has one near-zero entry — the
    // normal direction — so we filter that.)
    const inPlane = ctx.faceBboxExtent.filter(v => v > MIN_NORMAL_LEN);
    if (inPlane.length === 0) return { ok: true };
    const minFaceExtent = Math.min(...inPlane);
    if (Math.abs(offset) > minFaceExtent) {
      return { ok: false, reason: 'self_intersect' };
    }
  }
  return { ok: true };
}

/**
 * Snap an offset to the nearest grid value when shift is held during
 * drag. `gridSize` is the snap increment in mm (e.g. 0.1, 1, 10).
 * Returns the original offset unchanged when `gridSize <= 0`.
 */
export function dragSnapToGrid(offset: number, gridSize: number): number {
  if (!Number.isFinite(offset)) return offset;
  if (!Number.isFinite(gridSize) || gridSize <= 0) return offset;
  return Math.round(offset / gridSize) * gridSize;
}

/** Helper: compute a face's in-plane bounding box from triangle
 *  positions. Used by the applier to pass `faceBboxExtent` to the
 *  validator without re-walking the mesh twice.
 *
 *  `positions` is a flat array of 3D points in world coordinates
 *  (xyz xyz ...). `faceNormal` is the face's averaged normal
 *  (assumed unit length).
 */
export function computeFaceBboxExtent(
  positions: Float32Array | number[],
  faceVertexIndices: number[],
  faceNormal: Vec3,
): Vec3 {
  if (faceVertexIndices.length === 0) return [0, 0, 0];
  // Build an orthonormal basis (u, v) in the face plane.
  const [nx, ny, nz] = faceNormal;
  // Pick a non-parallel axis to seed u.
  const seed: Vec3 = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  // u = normalise(seed - (seed·n)·n)
  const sdotn = seed[0] * nx + seed[1] * ny + seed[2] * nz;
  let ux = seed[0] - sdotn * nx;
  let uy = seed[1] - sdotn * ny;
  let uz = seed[2] - sdotn * nz;
  const ulen = Math.hypot(ux, uy, uz) || 1;
  ux /= ulen; uy /= ulen; uz /= ulen;
  // v = n × u
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;
  let minU = Infinity, maxU = -Infinity;
  let minV = Infinity, maxV = -Infinity;
  for (const idx of faceVertexIndices) {
    const px = positions[idx * 3]!;
    const py = positions[idx * 3 + 1]!;
    const pz = positions[idx * 3 + 2]!;
    const u = px * ux + py * uy + pz * uz;
    const v = px * vx + py * vy + pz * vz;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  return [maxU - minU, maxV - minV, 0];
}
