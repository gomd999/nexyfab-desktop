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

export type MateType = 'coincident' | 'concentric' | 'distance' | 'angle' | 'parallel' | 'perpendicular' | 'tangent' | 'hinge' | 'slider' | 'gear';

export interface AssemblyMate {
  id: string;
  type: MateType;
  partA: string; // part id
  partB: string;
  faceA?: number; // face index
  faceB?: number;
  value?: number; // distance or angle value
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
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
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
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
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

function solveConcentric(
  partB: AssemblyPart,
  partA: AssemblyPart,
  _mate: AssemblyMate,
): THREE.Matrix4 {
  // Align centers of both parts
  const centerA = getGeometryCenter(partA.geometry).applyMatrix4(partA.transform);
  const centerB = getGeometryCenter(partB.geometry).applyMatrix4(partB.transform);
  const offset = new THREE.Vector3().subVectors(centerA, centerB);

  const transMat = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z);
  return new THREE.Matrix4().multiplyMatrices(transMat, partB.transform);
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

function solveAngle(
  partB: AssemblyPart,
  partA: AssemblyPart,
  mate: AssemblyMate,
): THREE.Matrix4 {
  const angleDeg = mate.value ?? 90;
  const angleRad = (angleDeg * Math.PI) / 180;

  const normalA = getFaceNormal(partA.geometry, mate.faceA ?? 0)
    .applyMatrix4(new THREE.Matrix4().extractRotation(partA.transform))
    .normalize();

  // Rotate partB around the cross axis to achieve the desired angle
  const normalB = getFaceNormal(partB.geometry, mate.faceB ?? 0)
    .applyMatrix4(new THREE.Matrix4().extractRotation(partB.transform))
    .normalize();

  const currentAngle = Math.acos(THREE.MathUtils.clamp(normalA.dot(normalB), -1, 1));
  const delta = angleRad - currentAngle;

  if (Math.abs(delta) < 0.001) return partB.transform.clone();

  const axis = new THREE.Vector3().crossVectors(normalB, normalA).normalize();
  if (axis.lengthSq() < 0.0001) return partB.transform.clone();

  const rotQuat = new THREE.Quaternion().setFromAxisAngle(axis, delta);
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

function solveTangent(
  partB: AssemblyPart,
  partA: AssemblyPart,
  mate: AssemblyMate,
): THREE.Matrix4 {
  // Tangent: align faces touching (similar to coincident but without flipping normal)
  const centroidA = getFaceCentroid(partA.geometry, mate.faceA ?? 0).applyMatrix4(partA.transform);
  const centroidB = getFaceCentroid(partB.geometry, mate.faceB ?? 0).applyMatrix4(partB.transform);

  const offset = new THREE.Vector3().subVectors(centroidA, centroidB);
  const transMat = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z);
  return new THREE.Matrix4().multiplyMatrices(transMat, partB.transform);
}

// ─── Main Solver ─────────────────────────────────────────────────────────────

const SOLVER_MAP: Record<MateType, (partB: AssemblyPart, partA: AssemblyPart, mate: AssemblyMate) => THREE.Matrix4> = {
  coincident: solveCoincident,
  concentric: solveConcentric,
  distance: solveDistance,
  angle: solveAngle,
  parallel: solveParallel,
  perpendicular: solvePerpendicular,
  tangent: solveTangent,
  hinge: solveAngle,
  slider: solveDistance,
  gear: solveParallel,
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
  },
};
