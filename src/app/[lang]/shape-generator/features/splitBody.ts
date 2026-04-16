import * as THREE from 'three';
import { Evaluator, Brush, INTERSECTION } from 'three-bvh-csg';
import type { FeatureDefinition } from './types';

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

export const splitBodyFeature: FeatureDefinition = {
  type: 'splitBody',
  icon: '✂️',
  params: [
    {
      key: 'plane',
      labelKey: 'paramSplitPlane',
      default: 0,
      min: 0,
      max: 2,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'featureOpt_planeXY' },
        { value: 1, labelKey: 'featureOpt_planeXZ' },
        { value: 2, labelKey: 'featureOpt_planeYZ' },
      ],
    },
    { key: 'offset', labelKey: 'paramSplitOffset', default: 0, min: -250, max: 250, step: 1, unit: 'mm' },
    {
      key: 'keepSide',
      labelKey: 'paramKeepSide',
      default: 0,
      min: 0,
      max: 1,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'featureOpt_keepPos' },
        { value: 1, labelKey: 'featureOpt_keepNeg' },
      ],
    },
  ],
  apply(geometry, params) {
    const plane = Math.round(params.plane);
    const offset = params.offset;
    const keepSide = Math.round(params.keepSide);

    // Create a large cutting box on one side of the plane
    const SIZE = 2000; // large enough to cover any geometry

    let cutBoxGeo: THREE.BufferGeometry;

    // Determine sign: keepSide 0 = positive half, 1 = negative half
    const sign = keepSide === 0 ? 1 : -1;

    switch (plane) {
      case 0: {
        // XY plane: split along Z
        cutBoxGeo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
        cutBoxGeo.translate(0, 0, sign * (SIZE / 2) + offset);
        break;
      }
      case 1: {
        // XZ plane: split along Y
        cutBoxGeo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
        cutBoxGeo.translate(0, sign * (SIZE / 2) + offset, 0);
        break;
      }
      case 2: {
        // YZ plane: split along X
        cutBoxGeo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
        cutBoxGeo.translate(sign * (SIZE / 2) + offset, 0, 0);
        break;
      }
      default:
        return geometry.clone();
    }

    const evaluator = new Evaluator();
    const brushA = makeBrush(geometry);
    const brushB = makeBrush(cutBoxGeo);

    const result = evaluator.evaluate(brushA, brushB, INTERSECTION);
    return result.geometry;
  },
};
