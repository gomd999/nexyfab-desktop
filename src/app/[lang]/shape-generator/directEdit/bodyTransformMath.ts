/**
 * bodyTransformMath.ts — Wave 2 Phase 3 Track E3.
 *
 * Pure math helpers for body-level move / rotate direct edits. No
 * THREE.js, no React. Tested in isolation. The mesh-level appliers in
 * `applyMoveBody.ts` / `applyRotateBody.ts` compose these with the
 * BufferGeometry traversal.
 *
 * Why split (mirrors `pushPullMath.ts`):
 *   - The math (translation vector apply / Rodrigues' rotation matrix /
 *     pivot offset) is deterministic and cheap; can run inside the
 *     live-drag loop at hundreds of Hz.
 *   - The mesh applier needs THREE.js + normal recomputation; expensive
 *     and exercised by the perf-budget test.
 *
 * Rotation math:
 *   We use Rodrigues' rotation matrix because it composes well with
 *   a translation-to-pivot pre-multiply and is numerically stable for
 *   reasonable angles. THREE.Matrix4.makeRotationAxis exists but we
 *   prefer a pure-JS implementation here to keep the math file free of
 *   THREE imports — that keeps tests fast and the dependency surface
 *   for live-drag preview minimal.
 *
 *   R = I + sin(θ) * K + (1 - cos(θ)) * K²
 *
 *   Where K is the cross-product skew-symmetric matrix of the unit
 *   axis. The applied transform for vertex `v` with pivot `p` is:
 *
 *   v' = R · (v - p) + p
 */

export type Vec3 = readonly [number, number, number];

/** Smallest meaningful translation magnitude (mm) — below this the
 *  applier treats the op as a no-op and returns the geometry by
 *  reference. */
export const MOVE_BODY_EPSILON_MM = 1e-6;

/** Smallest meaningful rotation angle (rad). */
export const ROTATE_BODY_EPSILON_RAD = 1e-9;

/** Snap convention for body-translation when shift is held during
 *  drag (mm). Larger default than push-pull's 0.1mm because body
 *  moves are coarser by nature — translating a 100mm part by 0.1mm
 *  is dwarfed by the part itself. */
export const BODY_TRANSLATION_SNAP_MM = 1;

/** Snap convention for body-rotation when shift is held during drag
 *  (radians = 15°). Matches the existing ShapePreview TransformScene
 *  convention (`THREE.MathUtils.degToRad(15)`). */
export const BODY_ROTATION_SNAP_RAD = (15 * Math.PI) / 180;

/** Snap a translation vector to a grid. `gridSize` is the per-axis
 *  snap increment in mm. Returns the input unchanged when
 *  `gridSize <= 0` or any component is non-finite. */
export function snapTranslationToGrid(
  translation: Vec3,
  gridSize: number,
): Vec3 {
  if (!Number.isFinite(gridSize) || gridSize <= 0) return translation;
  return [
    Number.isFinite(translation[0])
      ? Math.round(translation[0] / gridSize) * gridSize
      : translation[0],
    Number.isFinite(translation[1])
      ? Math.round(translation[1] / gridSize) * gridSize
      : translation[1],
    Number.isFinite(translation[2])
      ? Math.round(translation[2] / gridSize) * gridSize
      : translation[2],
  ];
}

/** Snap a rotation angle (radians) to the nearest `stepRad` increment.
 *  Returns the input unchanged when `stepRad <= 0` or the angle is
 *  non-finite. */
export function snapAngleToStep(angleRad: number, stepRad: number): number {
  if (!Number.isFinite(stepRad) || stepRad <= 0) return angleRad;
  if (!Number.isFinite(angleRad)) return angleRad;
  return Math.round(angleRad / stepRad) * stepRad;
}

/** Apply a translation to a single position. Pure helper — appliers
 *  loop over this for every vertex but we expose it for tests. */
export function applyTranslationToPoint(p: Vec3, translation: Vec3): Vec3 {
  return [
    p[0] + translation[0],
    p[1] + translation[1],
    p[2] + translation[2],
  ];
}

/** Build a 3×3 Rodrigues' rotation matrix (row-major) for `angleRad`
 *  about `axis`. Normalises the axis internally. Returns the identity
 *  for a degenerate (zero-magnitude) axis OR for sub-epsilon angles. */
export function buildRotationMatrix3(axis: Vec3, angleRad: number): number[] {
  // Identity fallback.
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (!Number.isFinite(angleRad)) return I;
  if (Math.abs(angleRad) < ROTATE_BODY_EPSILON_RAD) return I;
  const axLen = Math.hypot(axis[0], axis[1], axis[2]);
  if (axLen < 1e-12) return I;
  const x = axis[0] / axLen;
  const y = axis[1] / axLen;
  const z = axis[2] / axLen;
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const t = 1 - c;
  // Row-major 3x3.
  //   [ tXX+c   tXY-zs  tXZ+ys ]
  //   [ tXY+zs  tYY+c   tYZ-xs ]
  //   [ tXZ-ys  tYZ+xs  tZZ+c  ]
  return [
    t * x * x + c,
    t * x * y - z * s,
    t * x * z + y * s,
    t * x * y + z * s,
    t * y * y + c,
    t * y * z - x * s,
    t * x * z - y * s,
    t * y * z + x * s,
    t * z * z + c,
  ];
}

/** Apply a rotation matrix (3×3 row-major) to a single point, with an
 *  optional pivot. v' = R · (v - p) + p. */
export function applyRotationToPoint(
  p: Vec3,
  matrix3: number[],
  pivot: Vec3 = [0, 0, 0],
): Vec3 {
  const x = p[0] - pivot[0];
  const y = p[1] - pivot[1];
  const z = p[2] - pivot[2];
  const rx = matrix3[0]! * x + matrix3[1]! * y + matrix3[2]! * z;
  const ry = matrix3[3]! * x + matrix3[4]! * y + matrix3[5]! * z;
  const rz = matrix3[6]! * x + matrix3[7]! * y + matrix3[8]! * z;
  return [rx + pivot[0], ry + pivot[1], rz + pivot[2]];
}

/** Build a single 4×4 affine row-major matrix that composes a
 *  rotation (about `axis` through `pivot`) with a post-translation.
 *  Used by the applier when an op carries both rotation + translation
 *  (currently not in scope — rotateBody and moveBody are separate ops
 *  — but kept for forward compatibility with future "transform" op). */
export function composeTransforms(
  translation: Vec3 | null,
  rotation: {
    axis: Vec3;
    angleRad: number;
    pivot: Vec3;
  } | null,
): number[] {
  // Default: identity 4×4 row-major.
  const M: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  if (rotation) {
    const R = buildRotationMatrix3(rotation.axis, rotation.angleRad);
    const px = rotation.pivot[0];
    const py = rotation.pivot[1];
    const pz = rotation.pivot[2];
    // Composite: T(p) · R · T(-p)
    // For row-major 4×4 the translation part lives at indices 3, 7, 11.
    M[0] = R[0]!; M[1] = R[1]!; M[2] = R[2]!;
    M[4] = R[3]!; M[5] = R[4]!; M[6] = R[5]!;
    M[8] = R[6]!; M[9] = R[7]!; M[10] = R[8]!;
    // Translation column = p - R · p.
    M[3] = px - (R[0]! * px + R[1]! * py + R[2]! * pz);
    M[7] = py - (R[3]! * px + R[4]! * py + R[5]! * pz);
    M[11] = pz - (R[6]! * px + R[7]! * py + R[8]! * pz);
  }
  if (translation) {
    // Post-translation: add to the translation column.
    M[3] += translation[0];
    M[7] += translation[1];
    M[11] += translation[2];
  }
  return M;
}

/** Apply a 4×4 row-major affine matrix to a point. */
export function applyMatrix4ToPoint(p: Vec3, matrix4: number[]): Vec3 {
  const x =
    matrix4[0]! * p[0] +
    matrix4[1]! * p[1] +
    matrix4[2]! * p[2] +
    matrix4[3]!;
  const y =
    matrix4[4]! * p[0] +
    matrix4[5]! * p[1] +
    matrix4[6]! * p[2] +
    matrix4[7]!;
  const z =
    matrix4[8]! * p[0] +
    matrix4[9]! * p[1] +
    matrix4[10]! * p[2] +
    matrix4[11]!;
  return [x, y, z];
}

/** Compute the axis-aligned bounding box of a set of positions after
 *  applying a translation. Used by the overlay to size the live-drag
 *  preview ghost without a full vertex copy.
 *
 *  Returns `null` when the source positions array is empty.
 */
export function bboxAfterTranslation(
  positions: Float32Array | number[],
  translation: Vec3,
): { min: Vec3; max: Vec3 } | null {
  if (positions.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]! + translation[0];
    const y = positions[i + 1]! + translation[1];
    const z = positions[i + 2]! + translation[2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Compute the axis-aligned bounding box of a set of positions after
 *  applying a rotation about a pivot. */
export function bboxAfterRotation(
  positions: Float32Array | number[],
  rotation: { axis: Vec3; angleRad: number; pivot: Vec3 },
): { min: Vec3; max: Vec3 } | null {
  if (positions.length === 0) return null;
  const R = buildRotationMatrix3(rotation.axis, rotation.angleRad);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i]! - rotation.pivot[0];
    const py = positions[i + 1]! - rotation.pivot[1];
    const pz = positions[i + 2]! - rotation.pivot[2];
    const rx = R[0]! * px + R[1]! * py + R[2]! * pz + rotation.pivot[0];
    const ry = R[3]! * px + R[4]! * py + R[5]! * pz + rotation.pivot[1];
    const rz = R[6]! * px + R[7]! * py + R[8]! * pz + rotation.pivot[2];
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
    if (rz < minZ) minZ = rz;
    if (rx > maxX) maxX = rx;
    if (ry > maxY) maxY = ry;
    if (rz > maxZ) maxZ = rz;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}
