import * as THREE from 'three';
import type { FeatureDefinition } from './types';

export const draftFeature: FeatureDefinition = {
  type: 'draft',
  icon: '📐',
  params: [
    { key: 'angle', labelKey: 'paramDraftAngle', default: 5, min: 1, max: 30, step: 0.5, unit: '°' },
    {
      key: 'direction',
      labelKey: 'paramDraftDirection',
      default: 0,
      min: 0,
      max: 1,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'featureOpt_upward' },
        { value: 1, labelKey: 'featureOpt_downward' },
      ],
    },
  ],
  apply(geometry, params) {
    const angleDeg = params.angle;
    const direction = Math.round(params.direction) === 0 ? 1 : -1;
    const tanAngle = Math.tan((angleDeg * Math.PI) / 180);

    const clone = geometry.clone();
    const posAttr = clone.getAttribute('position');
    const positions = posAttr.array as Float32Array;

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];

      // Distance from neutral plane (Y = 0)
      const distY = y;
      const offset = tanAngle * distY * direction;

      positions[i] = x + offset;     // offset X
      positions[i + 2] = z + offset;  // offset Z
    }

    posAttr.needsUpdate = true;
    clone.computeVertexNormals();
    return clone;
  },
};
