import * as THREE from 'three';
import { Evaluator, Brush, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CSGOperation = 'union' | 'subtract' | 'intersect';

export type CSGToolShape = 'box' | 'sphere' | 'cylinder';

export interface CSGToolParams {
  shape: CSGToolShape;
  width: number;
  height: number;
  depth: number;
  posX: number;
  posY: number;
  posZ: number;
  rotY: number;
}

// ─── makeToolGeometry ─────────────────────────────────────────────────────────
// Creates the tool shape geometry with position/rotation baked in (non-indexed).

export function makeToolGeometry(params: CSGToolParams): THREE.BufferGeometry {
  const { shape, width, height, depth, posX, posY, posZ, rotY } = params;

  let geo: THREE.BufferGeometry;

  switch (shape) {
    case 'sphere': {
      const radius = Math.min(width, height, depth) / 2;
      geo = new THREE.SphereGeometry(radius, 32, 24);
      break;
    }
    case 'cylinder': {
      const radius = Math.min(width, depth) / 2;
      geo = new THREE.CylinderGeometry(radius, radius, height, 32);
      break;
    }
    case 'box':
    default: {
      geo = new THREE.BoxGeometry(width, height, depth);
      break;
    }
  }

  // Apply position and Y-rotation via a matrix
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3(posX, posY, posZ);
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0, THREE.MathUtils.degToRad(rotY), 0)
  );
  const scale = new THREE.Vector3(1, 1, 1);
  matrix.compose(position, quaternion, scale);

  geo.applyMatrix4(matrix);

  // Return non-indexed geometry so CSG works correctly
  return geo.toNonIndexed();
}

// ─── applyCSG ─────────────────────────────────────────────────────────────────
// Performs a boolean operation between baseGeo and toolGeo using three-bvh-csg.
// Returns the resulting BufferGeometry.

export function applyCSG(
  baseGeo: THREE.BufferGeometry,
  toolGeo: THREE.BufferGeometry,
  op: CSGOperation
): THREE.BufferGeometry {
  const evaluator = new Evaluator();

  // Brushes require a material
  const material = new THREE.MeshStandardMaterial();

  const baseBrush = new Brush(baseGeo, material);
  const toolBrush = new Brush(toolGeo, material);

  baseBrush.updateMatrixWorld();
  toolBrush.updateMatrixWorld();

  let csgOp: typeof ADDITION | typeof SUBTRACTION | typeof INTERSECTION;
  switch (op) {
    case 'union':
      csgOp = ADDITION;
      break;
    case 'intersect':
      csgOp = INTERSECTION;
      break;
    case 'subtract':
    default:
      csgOp = SUBTRACTION;
      break;
  }

  let resultGeo: THREE.BufferGeometry;
  try {
    const result = evaluator.evaluate(baseBrush, toolBrush, csgOp);
    // Clone the geometry so we own it independently of the result mesh
    resultGeo = result.geometry.clone();
    // Dispose the result mesh geometry to avoid leaks
    result.geometry.dispose();
  } catch (err) {
    console.error('[CSGOperations] applyCSG failed:', err);
    // Fall back to the original base geometry on error
    resultGeo = baseGeo.clone();
  } finally {
    material.dispose();
  }

  return resultGeo;
}
