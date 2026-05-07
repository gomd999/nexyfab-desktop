import * as THREE from 'three';
import { Evaluator, Brush, INTERSECTION } from 'three-bvh-csg';
import type { FeatureDefinition } from './types';
import { isOcctReady, isOcctGlobalMode, occtBoxBooleanWithPrimitive, hostBoxFromGeometry } from './occtEngine';

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
    {
      key: 'engine',
      labelKey: 'paramBoolEngine',
      default: 1,
      min: 0,
      max: 1,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'enumEngineMeshCsg' },
        { value: 1, labelKey: 'enumEngineOcct' },
      ],
    },
  ],
  apply(geometry, params) {
    const plane = Math.round(params.plane);
    const offset = params.offset;
    const keepSide = Math.round(params.keepSide);
    const engine = Math.round(params.engine ?? 0);

    const SIZE = 2000;
    const sign = keepSide === 0 ? 1 : -1;

    let cx = 0, cy = 0, cz = 0;
    switch (plane) {
      case 0: cz = sign * (SIZE / 2) + offset; break;
      case 1: cy = sign * (SIZE / 2) + offset; break;
      case 2: cx = sign * (SIZE / 2) + offset; break;
    }

    if ((engine === 1 || isOcctGlobalMode()) && isOcctReady()) {
      try {
        const upstreamHandle = (geometry.userData?.occtHandle as string | undefined) ?? null;
        const host = hostBoxFromGeometry(geometry);
        const result = occtBoxBooleanWithPrimitive(
          'intersect',
          host,
          { shape: 'box', w: SIZE, h: SIZE, d: SIZE, cx, cy, cz, rx: 0, ry: 0, rz: 0 },
          undefined,
          upstreamHandle
        );
        if (result.handle) result.geometry.userData.occtHandle = result.handle;
        return result.geometry;
      } catch (err) {
        console.warn('[splitBody] OCCT path failed, falling back to three-bvh-csg:', err);
      }
    }

    let cutBoxGeo: THREE.BufferGeometry;
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
