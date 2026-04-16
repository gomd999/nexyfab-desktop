import * as THREE from 'three';
import type { FeatureDefinition } from './types';

export const scaleFeature: FeatureDefinition = {
  type: 'scale',
  icon: '🔍',
  params: [
    { key: 'scaleX', labelKey: 'paramScaleX', default: 1, min: 0.1, max: 5, step: 0.01, unit: '×' },
    { key: 'scaleY', labelKey: 'paramScaleY', default: 1, min: 0.1, max: 5, step: 0.01, unit: '×' },
    { key: 'scaleZ', labelKey: 'paramScaleZ', default: 1, min: 0.1, max: 5, step: 0.01, unit: '×' },
  ],
  apply(geometry, params) {
    const { scaleX, scaleY, scaleZ } = params;
    const clone = geometry.clone();
    clone.applyMatrix4(new THREE.Matrix4().makeScale(scaleX, scaleY, scaleZ));
    clone.computeVertexNormals();
    return clone;
  },
};
