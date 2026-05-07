import * as THREE from 'three';

/** Round a single value to the nearest grid step. */
export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

/** Snap all three components of a Vector3 to the grid. */
export function snapVector3(v: THREE.Vector3, gridSize: number): THREE.Vector3 {
  return new THREE.Vector3(
    snapToGrid(v.x, gridSize),
    snapToGrid(v.y, gridSize),
    snapToGrid(v.z, gridSize),
  );
}
