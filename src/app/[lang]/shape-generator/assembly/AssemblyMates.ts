// ─── Assembly Mate / Constraint System ────────────────────────────────────────
//
// Two solver stacks (M3-P1: intentional until unified — see docs/strategy/M3_ASSEMBLY.md):
//
// 1) **solveMates** (this file) — mesh-face iterative solver for `AssemblyPart` +
//    `AssemblyMate` (face indices). Used by `applyGeometryMatesToPlaced` and the
//    nfab / library placement pipeline so saved transforms match solved geometry.
//
// 2) **solveAssembly** (matesSolver.ts) — Gauss-Seidel on `AssemblyState` with
//    `Mate` + `MateSelection` (body index + local points). Used by `AssemblyMatesPanel`
//    for viewport assembly UI; not the same data model as PlacedPart snapshots.
//
// Re-export matesSolver types/solver so callers can import from either location.
//
export type {
  MateType as SolverMateType,
  MateSelectionType,
  MateSelection,
  Mate,
  AssemblyBody,
  AssemblyState,
  SolveResult,
} from './matesSolver';
export { solveAssembly, calculateDOF } from './matesSolver';

import * as THREE from 'three';

export type MateType =
  | 'coincident' | 'concentric' | 'distance' | 'angle' | 'parallel' | 'perpendicular' | 'tangent'
  | 'hinge' | 'slider' | 'gear'
  | 'limitDistance' | 'limitAngle' | 'width';

export interface AssemblyMate {
  id: string;
  type: MateType;
  partA: string; // part id
  partB: string;
  faceA?: number; // face index
  faceB?: number;
  /** distance (mm) / angle (deg) target — for `gear`, the ratio ω_A:ω_B. */
  value?: number;
  /** limitDistance (mm) / limitAngle (deg): lower bound of the allowed range. */
  min?: number;
  /** limitDistance (mm) / limitAngle (deg): upper bound of the allowed range. */
  max?: number;
  /** width: SECOND reference face on part A (`faceA` is the first). */
  faceA2?: number;
  locked: boolean;
}

export interface AssemblyPart {
  id: string;
  geometry: THREE.BufferGeometry;
  transform: THREE.Matrix4;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Estimate face normal from geometry at a given face (triangle) index */
function getFaceNormal(geometry: THREE.BufferGeometry, faceIndex: number): THREE.Vector3 {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | null;
  if (!posAttr) return new THREE.Vector3(); // malformed/empty geometry (e.g. corrupt import) — avoid crash
  const index = geometry.index;

  let i0: number, i1: number, i2: number;
  if (index) {
    i0 = index.getX(faceIndex * 3);
    i1 = index.getX(faceIndex * 3 + 1);
    i2 = index.getX(faceIndex * 3 + 2);
  } else {
    i0 = faceIndex * 3;
    i1 = faceIndex * 3 + 1;
    i2 = faceIndex * 3 + 2;
  }

  const a = new THREE.Vector3().fromBufferAttribute(posAttr, i0);
  const b = new THREE.Vector3().fromBufferAttribute(posAttr, i1);
  const c = new THREE.Vector3().fromBufferAttribute(posAttr, i2);

  const edge1 = new THREE.Vector3().subVectors(b, a);
  const edge2 = new THREE.Vector3().subVectors(c, a);
  return new THREE.Vector3().crossVectors(edge1, edge2).normalize();
}

/** Get the centroid of a face */
function getFaceCentroid(geometry: THREE.BufferGeometry, faceIndex: number): THREE.Vector3 {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | null;
  if (!posAttr) return new THREE.Vector3(); // malformed/empty geometry (e.g. corrupt import) — avoid crash
  const index = geometry.index;

  let i0: number, i1: number, i2: number;
  if (index) {
    i0 = index.getX(faceIndex * 3);
    i1 = index.getX(faceIndex * 3 + 1);
    i2 = index.getX(faceIndex * 3 + 2);
  } else {
    i0 = faceIndex * 3;
    i1 = faceIndex * 3 + 1;
    i2 = faceIndex * 3 + 2;
  }

  const a = new THREE.Vector3().fromBufferAttribute(posAttr, i0);
  const b = new THREE.Vector3().fromBufferAttribute(posAttr, i1);
  const c = new THREE.Vector3().fromBufferAttribute(posAttr, i2);

  return new THREE.Vector3().addVectors(a, b).add(c).divideScalar(3);
}

/** Get the center of the geometry bounding box */
function getGeometryCenter(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox();
  const center = new THREE.Vector3();
  geometry.boundingBox!.getCenter(center);
  return center;
}

// ─── Per-mate constraint solvers ─────────────────────────────────────────────

function solveCoincident(
  partB: AssemblyPart,
  partA: AssemblyPart,
  mate: AssemblyMate,
): THREE.Matrix4 {
  const normalA = getFaceNormal(partA.geometry, mate.faceA ?? 0)
    .applyMatrix4(new THREE.Matrix4().extractRotation(partA.transform));
  const normalB = getFaceNormal(partB.geometry, mate.faceB ?? 0)
    .applyMatrix4(new THREE.Matrix4().extractRotation(partB.transform));

  // Rotation: align normalB to be opposite of normalA
  const targetNormal = normalA.clone().negate();
  const rotQuat = new THREE.Quaternion().setFromUnitVectors(normalB.normalize(), targetNormal.normalize());
  const rotMat = new THREE.Matrix4().makeRotationFromQuaternion(rotQuat);

  // Position: move face B centroid to face A centroid
  const centroidA = getFaceCentroid(partA.geometry, mate.faceA ?? 0).applyMatrix4(partA.transform);
  const centroidB = getFaceCentroid(partB.geometry, mate.faceB ?? 0).applyMatrix4(
    new THREE.Matrix4().multiplyMatrices(rotMat, partB.transform),
  );

  const offset = new THREE.Vector3().subVectors(centroidA, centroidB);
  const transMat = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z);

  return new THREE.Matrix4().multiplyMatrices(transMat, new THREE.Matrix4().multiplyMatrices(rotMat, partB.transform));
}

/** Concentric: align the cylindrical axes implied by `faceA` and `faceB`.
 *  The previous version aligned whole geometry centres, which only worked
 *  when both parts happened to be centred on their cylinder axis — for a
 *  pin in an off-centre hole this gave visibly wrong results.
 *
 *  Approach: treat each selected face's normal as the cylinder axis (the
 *  user typically clicks the cap of a hole/cylinder, whose normal is the
 *  axis direction). Rotate part B so its axis becomes parallel to A's
 *  axis, then translate so B's axis line passes through A's axis line
 *  at the chosen face's centroid. Axes can be anti-parallel — the
 *  rotation `setFromUnitVectors` handles both. */
function solveConcentric(
  partB: AssemblyPart,
  partA: AssemblyPart,
  mate: AssemblyMate,
): THREE.Matrix4 {
  const rotA = new THREE.Matrix4().extractRotation(partA.transform);
  const rotB = new THREE.Matrix4().extractRotation(partB.transform);

  // No face selection on either side → fall back to centre-on-centre so
  // the mate still does *something* visually rather than silently no-op.
  if (mate.faceA == null || mate.faceB == null) {
    const centerA = getGeometryCenter(partA.geometry).applyMatrix4(partA.transform);
    const centerB = getGeometryCenter(partB.geometry).applyMatrix4(partB.transform);
    const offset = new THREE.Vector3().subVectors(centerA, centerB);
    const transMat = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    return new THREE.Matrix4().multiplyMatrices(transMat, partB.transform);
  }

  const axisA = getFaceNormal(partA.geometry, mate.faceA).applyMatrix4(rotA).normalize();
  const axisB = getFaceNormal(partB.geometry, mate.faceB).applyMatrix4(rotB).normalize();

  // Align axes — prefer parallel (same direction) but accept anti-parallel
  // since a pin can mate into either side of a through-hole.
  const rotQuat = new THREE.Quaternion().setFromUnitVectors(axisB, axisA);
  const rotMat = new THREE.Matrix4().makeRotationFromQuaternion(rotQuat);

  const newTransformB = new THREE.Matrix4().multiplyMatrices(rotMat, partB.transform);

  // Pick an axis point that's actually *on* the cylinder axis: the cap's
  // face centroid sits off-axis when the cap is fan-triangulated (the
  // first triangle's centroid is at radius/3 from the centre). The geometry
  // bbox centre, by contrast, lies on the axis for any centred primitive.
  // For non-primitive imports the bbox centre is still the best heuristic
  // until proper B-Rep axis extraction lands.
  const bboxCenterA = getGeometryCenter(partA.geometry).applyMatrix4(partA.transform);
  const bboxCenterB = getGeometryCenter(partB.geometry).applyMatrix4(newTransformB);

  // axisLineA passes through bboxCenterA in direction axisA. Project B's
  // bbox centre onto that line, then translate by the residual perpendicular.
  const rel = new THREE.Vector3().subVectors(bboxCenterB, bboxCenterA);
  const along = axisA.dot(rel);
  const closest = bboxCenterA.clone().add(axisA.clone().multiplyScalar(along));
  const perpOffset = new THREE.Vector3().subVectors(closest, bboxCenterB);

  const transMat = new THREE.Matrix4().makeTranslation(perpOffset.x, perpOffset.y, perpOffset.z);
  return new THREE.Matrix4().multiplyMatrices(transMat, newTransformB);
}

function solveDistance(
  partB: AssemblyPart,
  partA: AssemblyPart,
  mate: AssemblyMate,
): THREE.Matrix4 {
  const dist = mate.value ?? 10;
  const normalA = getFaceNormal(partA.geometry, mate.faceA ?? 0)
    .applyMatrix4(new THREE.Matrix4().extractRotation(partA.transform))
    .normalize();

  const centroidA = getFaceCentroid(partA.geometry, mate.faceA ?? 0).applyMatrix4(partA.transform);
  const centroidB = getFaceCentroid(partB.geometry, mate.faceB ?? 0).applyMatrix4(partB.transform);

  const targetPos = centroidA.clone().add(normalA.clone().multiplyScalar(dist));
  const offset = new THREE.Vector3().subVectors(targetPos, centroidB);

  const transMat = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z);
  return new THREE.Matrix4().multiplyMatrices(transMat, partB.transform);
}

/** Angle mate: rotate partB so the angle between its face normal and
 *  partA's face normal matches `mate.value` (degrees).
 *
 *  Two issues the old version had:
 *   1. `Math.acos` returns [0, π] only — anti-parallel normals
 *      (currentAngle = π) produced a zero cross-product axis, so the
 *      solver bailed out with no rotation even when a half-turn was
 *      required.
 *   2. The cross-product axis flipped sign as B passed through alignment,
 *      so delta swung the wrong direction and the solver oscillated
 *      instead of converging.
 *
 *  Fix: when axes are degenerate (parallel or anti-parallel), choose a
 *  stable perpendicular fallback so we can still rotate; otherwise use
 *  the cross axis as before but normalise consistently. */
function solveAngle(
  partB: AssemblyPart,
  partA: AssemblyPart,
  mate: AssemblyMate,
): THREE.Matrix4 {
  const angleDeg = mate.value ?? 90;
  const angleRad = (angleDeg * Math.PI) / 180;

  const rotA = new THREE.Matrix4().extractRotation(partA.transform);
  const rotB = new THREE.Matrix4().extractRotation(partB.transform);
  const normalA = getFaceNormal(partA.geometry, mate.faceA ?? 0).applyMatrix4(rotA).normalize();
  const normalB = getFaceNormal(partB.geometry, mate.faceB ?? 0).applyMatrix4(rotB).normalize();

  const dot = THREE.MathUtils.clamp(normalA.dot(normalB), -1, 1);
  const currentAngle = Math.acos(dot);
  const delta = angleRad - currentAngle;

  if (Math.abs(delta) < 1e-4) return partB.transform.clone();

  let axis = new THREE.Vector3().crossVectors(normalB, normalA);
  if (axis.lengthSq() < 1e-8) {
    // normalB ‖ ±normalA → pick any vector perpendicular to normalA so the
    // rotation has a well-defined plane. World up works unless normalA is
    // itself up, in which case fall back to world X.
    const fallback = Math.abs(normalA.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    axis = new THREE.Vector3().crossVectors(normalA, fallback);
    if (axis.lengthSq() < 1e-8) return partB.transform.clone();
  }
  axis.normalize();

  // Sign convention (Phase 2 fix): rotating normalB about axis = normalB ×
  // normalA by +φ DECREASES the A→B angle, so achieving an angle CHANGE of
  // `delta` requires rotating by −delta. The old `+delta` ran away from the
  // target from any non-degenerate start (120° → 150° instead of → 90°);
  // both prior tests started at the degenerate 0°/180° poses where the
  // fallback axis makes direction arbitrary, which hid this.
  const rotQuat = new THREE.Quaternion().setFromAxisAngle(axis, -delta);
  const rotMat = new THREE.Matrix4().makeRotationFromQuaternion(rotQuat);

  return new THREE.Matrix4().multiplyMatrices(rotMat, partB.transform);
}

function solveParallel(
  partB: AssemblyPart,
  partA: AssemblyPart,
  mate: AssemblyMate,
): THREE.Matrix4 {
  const normalA = getFaceNormal(partA.geometry, mate.faceA ?? 0)
    .applyMatrix4(new THREE.Matrix4().extractRotation(partA.transform))
    .normalize();
  const normalB = getFaceNormal(partB.geometry, mate.faceB ?? 0)
    .applyMatrix4(new THREE.Matrix4().extractRotation(partB.transform))
    .normalize();

  const rotQuat = new THREE.Quaternion().setFromUnitVectors(normalB, normalA);
  const rotMat = new THREE.Matrix4().makeRotationFromQuaternion(rotQuat);

  return new THREE.Matrix4().multiplyMatrices(rotMat, partB.transform);
}

function solvePerpendicular(
  partB: AssemblyPart,
  partA: AssemblyPart,
  mate: AssemblyMate,
): THREE.Matrix4 {
  // Force 90 degrees
  return solveAngle(partB, partA, { ...mate, value: 90 });
}

/** Tangent: surfaces touch with matching tangent plane — normals point
 *  the SAME direction (vs. coincident, where they're opposite). Useful
 *  for resting a cylinder on a plane or two cylinders side-by-side.
 *
 *  Prior version just slammed centroid B onto centroid A, which is what
 *  coincident-without-rotation already does. This version actually
 *  aligns the surface frames and places B on A's positive-normal side. */
function solveTangent(
  partB: AssemblyPart,
  partA: AssemblyPart,
  mate: AssemblyMate,
): THREE.Matrix4 {
  const rotA = new THREE.Matrix4().extractRotation(partA.transform);
  const rotB = new THREE.Matrix4().extractRotation(partB.transform);

  const normalA = getFaceNormal(partA.geometry, mate.faceA ?? 0).applyMatrix4(rotA).normalize();
  const normalB = getFaceNormal(partB.geometry, mate.faceB ?? 0).applyMatrix4(rotB).normalize();

  // Same-direction alignment (not negated) is the tangent condition.
  const rotQuat = new THREE.Quaternion().setFromUnitVectors(normalB, normalA);
  const rotMat = new THREE.Matrix4().makeRotationFromQuaternion(rotQuat);

  const newTransformB = new THREE.Matrix4().multiplyMatrices(rotMat, partB.transform);

  // Place B's face centroid on A's face plane: project the rotated B
  // centroid onto the plane (centroidA, normalA), then translate by the
  // residual along-normal component.
  const centroidA = getFaceCentroid(partA.geometry, mate.faceA ?? 0).applyMatrix4(partA.transform);
  const centroidB = getFaceCentroid(partB.geometry, mate.faceB ?? 0).applyMatrix4(newTransformB);
  const rel = new THREE.Vector3().subVectors(centroidB, centroidA);
  const alongNormal = normalA.dot(rel);
  const offset = normalA.clone().multiplyScalar(-alongNormal);

  const transMat = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z);
  return new THREE.Matrix4().multiplyMatrices(transMat, newTransformB);
}

/** Current distance between the two mate-face centroids (world space). */
function currentFaceDistance(partB: AssemblyPart, partA: AssemblyPart, mate: AssemblyMate): number {
  const centroidA = getFaceCentroid(partA.geometry, mate.faceA ?? 0).applyMatrix4(partA.transform);
  const centroidB = getFaceCentroid(partB.geometry, mate.faceB ?? 0).applyMatrix4(partB.transform);
  return centroidA.distanceTo(centroidB);
}

/** Limit-distance: inequality — only act when the current centroid gap is
 *  outside `[min, max]`, then snap to the violated bound via the distance
 *  solver. Inside the range the placement is left untouched (free DOF). */
function solveLimitDistance(
  partB: AssemblyPart,
  partA: AssemblyPart,
  mate: AssemblyMate,
): THREE.Matrix4 {
  const lo = mate.min ?? 0;
  const hi = mate.max ?? lo;
  const d = currentFaceDistance(partB, partA, mate);
  if (d >= lo - 1e-9 && d <= hi + 1e-9) return partB.transform.clone();
  return solveDistance(partB, partA, { ...mate, value: d < lo ? lo : hi });
}

/** Limit-angle: inequality — only act when the current normal-to-normal angle
 *  is outside `[min, max]` degrees, then snap to the violated bound. */
function solveLimitAngle(
  partB: AssemblyPart,
  partA: AssemblyPart,
  mate: AssemblyMate,
): THREE.Matrix4 {
  const lo = mate.min ?? 0;
  const hi = mate.max ?? lo;
  const rotA = new THREE.Matrix4().extractRotation(partA.transform);
  const rotB = new THREE.Matrix4().extractRotation(partB.transform);
  const nA = getFaceNormal(partA.geometry, mate.faceA ?? 0).applyMatrix4(rotA).normalize();
  const nB = getFaceNormal(partB.geometry, mate.faceB ?? 0).applyMatrix4(rotB).normalize();
  const deg = (Math.acos(THREE.MathUtils.clamp(nA.dot(nB), -1, 1)) * 180) / Math.PI;
  if (deg >= lo - 1e-7 && deg <= hi + 1e-7) return partB.transform.clone();
  return solveAngle(partB, partA, { ...mate, value: deg < lo ? lo : hi });
}

/** Width: center part B's mate face between TWO reference faces on part A
 *  (`faceA` + `faceA2`), measured along faceA's normal. In-plane position is
 *  left free. Without `faceA2` this degrades to tangent-style plane contact
 *  (honest fallback — the UI requires the second face). */
function solveWidth(
  partB: AssemblyPart,
  partA: AssemblyPart,
  mate: AssemblyMate,
): THREE.Matrix4 {
  if (mate.faceA2 == null) return solveTangent(partB, partA, mate);
  const rotA = new THREE.Matrix4().extractRotation(partA.transform);
  const n = getFaceNormal(partA.geometry, mate.faceA ?? 0).applyMatrix4(rotA).normalize();
  const c1 = getFaceCentroid(partA.geometry, mate.faceA ?? 0).applyMatrix4(partA.transform);
  const c2 = getFaceCentroid(partA.geometry, mate.faceA2).applyMatrix4(partA.transform);
  // Midplane point between the two reference planes measured along n.
  const sep = c2.clone().sub(c1).dot(n);
  const mid = c1.clone().add(n.clone().multiplyScalar(sep * 0.5));

  const cB = getFaceCentroid(partB.geometry, mate.faceB ?? 0).applyMatrix4(partB.transform);
  const off = cB.clone().sub(mid).dot(n); // signed offset from the midplane
  const corr = n.clone().multiplyScalar(-off);
  const transMat = new THREE.Matrix4().makeTranslation(corr.x, corr.y, corr.z);
  return new THREE.Matrix4().multiplyMatrices(transMat, partB.transform);
}

// ─── Main Solver ─────────────────────────────────────────────────────────────

// Mate routing — `hinge` aligns the rotation axis (=concentric) so the
// user sees the parts snap onto a common pivot; the residual rotational
// DOF is held by the runtime drag manager rather than the static solver.
// `slider` and `gear` are intentionally aliased to the closest static
// approximation until Phase B introduces kinematic stepping:
//   slider → distance: holds two faces a fixed gap apart but does not
//            yet constrain the slide direction.
//   gear   → parallel: aligns the two gear-face normals so they're
//            mesh-ready visually; the `mate.value` ratio is not yet
//            used to couple rotation between the two parts.
const SOLVER_MAP: Record<MateType, (partB: AssemblyPart, partA: AssemblyPart, mate: AssemblyMate) => THREE.Matrix4> = {
  coincident: solveCoincident,
  concentric: solveConcentric,
  distance: solveDistance,
  angle: solveAngle,
  parallel: solveParallel,
  perpendicular: solvePerpendicular,
  tangent: solveTangent,
  hinge: solveConcentric,
  slider: solveDistance,
  gear: solveParallel,
  // Phase 2 (SolidWorks-parity roadmap) — limit/width are real static
  // constraints; gear's RATIO (mate.value) is a motion coupling and is
  // honored by the kinematic drag loop (`kinematicDragSolve` +
  // `matesSolver.applyGearConstraint`), not by this static placement pass.
  limitDistance: solveLimitDistance,
  limitAngle: solveLimitAngle,
  width: solveWidth,
};

/**
 * Iterative constraint solver: for each mate, adjust part B's transform to satisfy the constraint.
 * Returns a map of part id -> updated transform matrix.
 * The first part encountered is treated as the fixed reference.
 */
export function solveMates(
  parts: AssemblyPart[],
  mates: AssemblyMate[],
  iterations: number = 3,
): Map<string, THREE.Matrix4> {
  // Initialize with current transforms
  const transforms = new Map<string, THREE.Matrix4>();
  for (const p of parts) {
    transforms.set(p.id, p.transform.clone());
  }

  const partMap = new Map<string, AssemblyPart>();
  for (const p of parts) {
    partMap.set(p.id, p);
  }

  // Iterative solving (multiple passes for convergence)
  for (let iter = 0; iter < iterations; iter++) {
    for (const mate of mates) {
      if (mate.locked) continue;

      const pA = partMap.get(mate.partA);
      const pB = partMap.get(mate.partB);
      if (!pA || !pB) continue;

      const solver = SOLVER_MAP[mate.type];
      if (!solver) continue;

      // Use latest transforms
      const workA: AssemblyPart = { ...pA, transform: transforms.get(mate.partA)! };
      const workB: AssemblyPart = { ...pB, transform: transforms.get(mate.partB)! };

      const newTransform = solver(workB, workA, mate);
      transforms.set(mate.partB, newTransform);
    }
  }

  return transforms;
}

/** Generate a unique ID */
export function generateMateId(): string {
  return `mate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Human-readable mate type labels */
export const MATE_TYPE_LABELS: Record<string, Record<MateType, string>> = {
  ko: {
    coincident: '일치',
    concentric: '동심',
    distance: '거리',
    angle: '각도',
    parallel: '평행',
    perpendicular: '직각',
    tangent: '접선',
    hinge: '힌지',
    slider: '슬라이더',
    gear: '기어',
    limitDistance: '거리 제한',
    limitAngle: '각도 제한',
    width: '폭 (중앙 정렬)',
  },
  en: {
    coincident: 'Coincident',
    concentric: 'Concentric',
    distance: 'Distance',
    angle: 'Angle',
    parallel: 'Parallel',
    perpendicular: 'Perpendicular',
    tangent: 'Tangent',
    hinge: 'Hinge',
    slider: 'Slider',
    gear: 'Gear',
    limitDistance: 'Limit Distance',
    limitAngle: 'Limit Angle',
    width: 'Width',
  },
};
