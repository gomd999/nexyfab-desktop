import * as THREE from 'three';
import { Evaluator, Brush, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { FACE_FEATURE_ID_ATTR } from '../features/faceProvenance';

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
// Throws on failure (empty result, evaluator exception) so callers can surface
// the error to the user via toast + telemetry. Previously this swallowed errors
// and silently returned the base geometry, which made CSG failures invisible.

export class CSGEmptyResultError extends Error {
  readonly op: CSGOperation;
  constructor(op: CSGOperation) {
    super(`CSG ${op}: empty result — 도구와 본체가 교차하지 않거나 일치합니다`);
    this.name = 'CSGEmptyResultError';
    this.op = op;
  }
}

export function applyCSG(
  baseGeo: THREE.BufferGeometry,
  toolGeo: THREE.BufferGeometry,
  op: CSGOperation
): THREE.BufferGeometry {
  const evaluator = new Evaluator();
  // B1 deep — preserve per-triangle feature-id attribution through the
  // boolean op. Triangles inherited from base keep the base's feature id;
  // triangles inherited from tool keep the tool's. New triangles along the
  // cut inherit whichever input's edge spawned them (three-bvh-csg's
  // GeometryBuilder copies the source attribute per output vertex).
  if (baseGeo.getAttribute(FACE_FEATURE_ID_ATTR) || toolGeo.getAttribute(FACE_FEATURE_ID_ATTR)) {
    evaluator.attributes = [...evaluator.attributes, FACE_FEATURE_ID_ATTR];
  }

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

  try {
    const result = evaluator.evaluate(baseBrush, toolBrush, csgOp);
    const pos = result.geometry?.attributes?.position;
    if (!pos || pos.count === 0) {
      result.geometry?.dispose();
      throw new CSGEmptyResultError(op);
    }
    // Clone the geometry so we own it independently of the result mesh
    const resultGeo = result.geometry.clone();
    // B1 deep — Evaluator copies the per-triangle nfabFaceFeatureId
    // attribute when configured to, but it does NOT copy the userData map
    // that decodes those numeric ids back to feature strings. Merge the
    // maps from both inputs onto the result so getFaceFeatureId() resolves
    // every triangle correctly.
    const baseMap = baseGeo.userData?.nfabFeatureIdMap as Record<number, string> | undefined;
    const toolMap = toolGeo.userData?.nfabFeatureIdMap as Record<number, string> | undefined;
    if (baseMap || toolMap) {
      resultGeo.userData = {
        ...resultGeo.userData,
        nfabFeatureIdMap: { ...(baseMap ?? {}), ...(toolMap ?? {}) },
      };
    }
    // Dispose the result mesh geometry to avoid leaks
    result.geometry.dispose();
    return resultGeo;
  } finally {
    material.dispose();
  }
}
