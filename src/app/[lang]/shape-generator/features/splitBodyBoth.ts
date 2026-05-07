import * as THREE from 'three';
import { Evaluator, Brush, INTERSECTION } from 'three-bvh-csg';
import { isOcctReady, isOcctGlobalMode, occtBoxBooleanWithPrimitive, hostBoxFromGeometry } from './occtEngine';

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo.toNonIndexed(), new THREE.MeshStandardMaterial());
}

/**
 * Splits a geometry along a plane and returns BOTH halves.
 * plane: 0=XY (split along Z), 1=XZ (split along Y), 2=YZ (split along X)
 * offset: translation of the cut plane in mm
 * Returns [positiveSide, negativeSide]
 */
export function splitBodyBoth(
  geometry: THREE.BufferGeometry,
  plane: number,
  offset: number,
): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const SIZE = 4000;
  
  if (isOcctGlobalMode() && isOcctReady()) {
    try {
      const upstreamHandle = (geometry.userData?.occtHandle as string | undefined) ?? null;
      const host = hostBoxFromGeometry(geometry);
      
      let cxPos = 0, cyPos = 0, czPos = 0;
      switch (plane) {
        case 0: czPos = (SIZE / 2) + offset; break;
        case 1: cyPos = (SIZE / 2) + offset; break;
        case 2: cxPos = (SIZE / 2) + offset; break;
      }
      
      const posResult = occtBoxBooleanWithPrimitive('intersect', host, { shape: 'box', w: SIZE, h: SIZE, d: SIZE, cx: cxPos, cy: cyPos, cz: czPos, rx: 0, ry: 0, rz: 0 }, undefined, upstreamHandle);
      
      let cxNeg = 0, cyNeg = 0, czNeg = 0;
      switch (plane) {
        case 0: czNeg = -(SIZE / 2) + offset; break;
        case 1: cyNeg = -(SIZE / 2) + offset; break;
        case 2: cxNeg = -(SIZE / 2) + offset; break;
      }
      
      const negResult = occtBoxBooleanWithPrimitive('intersect', host, { shape: 'box', w: SIZE, h: SIZE, d: SIZE, cx: cxNeg, cy: cyNeg, cz: czNeg, rx: 0, ry: 0, rz: 0 }, undefined, upstreamHandle);
      
      if (posResult.handle) posResult.geometry.userData.occtHandle = posResult.handle;
      if (negResult.handle) negResult.geometry.userData.occtHandle = negResult.handle;
      
      return [posResult.geometry, negResult.geometry];
    } catch (err) {
      console.warn('[splitBodyBoth] OCCT path failed, falling back to three-bvh-csg:', err);
    }
  }

  const evaluator = new Evaluator();

  function makeCutBox(sign: 1 | -1): THREE.BufferGeometry {
    const box = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
    switch (plane) {
      case 0: box.translate(0, 0, sign * SIZE / 2 + offset); break;
      case 1: box.translate(0, sign * SIZE / 2 + offset, 0); break;
      case 2: default: box.translate(sign * SIZE / 2 + offset, 0, 0); break;
    }
    return box;
  }

  const brushA = makeBrush(geometry);
  brushA.updateMatrixWorld();

  // Positive side
  const posBox = makeCutBox(1);
  const brushPos = makeBrush(posBox);
  brushPos.updateMatrixWorld();
  let posGeo: THREE.BufferGeometry;
  try {
    const posResult = evaluator.evaluate(brushA, brushPos, INTERSECTION);
    posGeo = posResult.geometry.clone();
    posGeo.computeVertexNormals();
    posResult.geometry.dispose();
  } catch {
    posGeo = geometry.clone();
  }
  posBox.dispose();

  // Negative side
  const negBox = makeCutBox(-1);
  const brushNeg = makeBrush(negBox);
  brushNeg.updateMatrixWorld();
  let negGeo: THREE.BufferGeometry;
  try {
    const negResult = evaluator.evaluate(brushA, brushNeg, INTERSECTION);
    negGeo = negResult.geometry.clone();
    negGeo.computeVertexNormals();
    negResult.geometry.dispose();
  } catch {
    negGeo = geometry.clone();
  }
  negBox.dispose();

  return [posGeo, negGeo];
}
