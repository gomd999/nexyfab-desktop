import * as THREE from 'three';
import { buildShapeResult } from '../shapes';
import type { PlacedPart } from './PartPlacementPanel';
import type { AssemblyMate, AssemblyPart } from './AssemblyMates';
import { solveMates } from './AssemblyMates';

function matrixToPosRotDeg(m: THREE.Matrix4): {
  position: [number, number, number];
  rotation: [number, number, number];
} {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  m.decompose(pos, quat, scl);
  const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
  const r2d = 180 / Math.PI;
  return {
    position: [pos.x, pos.y, pos.z],
    rotation: [euler.x * r2d, euler.y * r2d, euler.z * r2d],
  };
}

function placedToAssemblyParts(placed: PlacedPart[]): AssemblyPart[] {
  return placed.map((p) => {
    const sr = buildShapeResult(p.shapeId, p.params);
    if (!sr) {
      throw new Error(`Unknown shape id: ${p.shapeId}`);
    }
    const geom = sr.geometry;
    const mat = new THREE.Matrix4();
    const e = new THREE.Euler(
      (p.rotation[0] * Math.PI) / 180,
      (p.rotation[1] * Math.PI) / 180,
      (p.rotation[2] * Math.PI) / 180,
    );
    mat.makeRotationFromEuler(e);
    mat.setPosition(p.position[0], p.position[1], p.position[2]);
    return { id: p.name, geometry: geom, transform: mat };
  });
}

/**
 * `AssemblyMates.solveMates` 기반으로 파트 B 변환을 반복 갱신한 뒤,
 * `PlacedPart` 위치·회전에 반영합니다. (면 인덱스가 있으면 해당 면 법선 사용)
 *
 * Viewport 전용 `matesSolver.solveAssembly`와 데이터 모델이 다릅니다 — M3_ASSEMBLY.md 참고.
 */
export function applyGeometryMatesToPlaced(
  placed: PlacedPart[],
  mates: AssemblyMate[],
  iterations = 8,
): PlacedPart[] {
  if (mates.length === 0 || placed.length < 2) return placed;
  const assemblyParts = placedToAssemblyParts(placed);
  const transforms = solveMates(assemblyParts, mates, iterations);
  return placed.map((p) => {
    const m = transforms.get(p.name);
    if (!m) return p;
    const pr = matrixToPosRotDeg(m);
    return { ...p, position: pr.position, rotation: pr.rotation };
  });
}
