import * as THREE from 'three';
import type { FeatureDefinition } from './types';
import { occtDraft } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';

function applyDraftMesh(geometry: THREE.BufferGeometry, params: Record<string, number>): THREE.BufferGeometry {
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
    // Distance from neutral plane (Y = 0); taper X/Z proportionally.
    const offset = tanAngle * y * direction;
    positions[i] = x + offset;
    positions[i + 2] = z + offset;
  }

  posAttr.needsUpdate = true;
  clone.computeVertexNormals();
  return clone;
}

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
    return applyDraftMesh(geometry, params);
  },
  async applyAsync(geometry, params) {
    if (shouldUseOcctEngine()) {
      const handle = geometry.userData?.occtHandle as string | undefined;
      if (handle) {
        try {
          const r = occtDraft(handle, params.angle, Math.round(params.direction));
          if (r.handle) {
            r.geometry.userData.occtHandle = r.handle;
            return r.geometry;
          }
        } catch (err) {
          console.warn('[draft] OCCT path failed, falling back to mesh:', err);
        }
      }
    }
    return applyDraftMesh(geometry, params);
  },
};
