import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition } from './types';

export const linearPatternFeature: FeatureDefinition = {
  type: 'linearPattern',
  icon: '📏',
  params: [
    { key: 'axis', labelKey: 'paramPatternAxis', default: 0, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'axisX' },
        { value: 1, labelKey: 'axisY' },
        { value: 2, labelKey: 'axisZ' },
      ] },
    { key: 'count', labelKey: 'paramPatternCount', default: 3, min: 2, max: 20, step: 1, unit: '' },
    { key: 'spacing', labelKey: 'paramPatternSpacing', default: 60, min: 1, max: 500, step: 1, unit: 'mm' },
  ],
  apply(geometry, params) {
    const axis = Math.round(params.axis);
    const count = Math.round(params.count);
    const spacing = params.spacing;

    const copies: THREE.BufferGeometry[] = [];
    for (let i = 0; i < count; i++) {
      const clone = geometry.clone();
      const offset = [0, 0, 0];
      offset[axis] = i * spacing;
      clone.translate(offset[0], offset[1], offset[2]);
      copies.push(clone);
    }

    const merged = mergeGeometries(copies);
    if (!merged) throw new Error('Linear pattern merge failed');
    return merged;
  },
};
