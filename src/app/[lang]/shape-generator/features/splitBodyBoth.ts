import * as THREE from 'three';
import { Evaluator, Brush, INTERSECTION } from 'three-bvh-csg';

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
