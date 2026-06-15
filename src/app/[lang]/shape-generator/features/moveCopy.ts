import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition } from './types';
import { occtMoveCopy } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';

function applyMoveCopyMesh(geometry: THREE.BufferGeometry, params: Record<string, number>): THREE.BufferGeometry {
  const { offsetX, offsetY, offsetZ } = params;
  const operation = Math.round(params.operation);
  const translation = new THREE.Matrix4().makeTranslation(offsetX, offsetY, offsetZ);

  if (operation === 0) {
    const clone = geometry.clone();
    clone.applyMatrix4(translation);
    return clone;
  }

  const original = geometry.clone();
  const copy = geometry.clone();
  copy.applyMatrix4(translation);
  const merged = mergeGeometries([original, copy]);
  if (!merged) throw new Error('MoveCopy merge failed');
  return merged;
}

export const moveCopyFeature: FeatureDefinition = {
  type: 'moveCopy',
  icon: '📋',
  params: [
    { key: 'offsetX', labelKey: 'paramOffsetX', default: 0, min: -500, max: 500, step: 1, unit: 'mm' },
    { key: 'offsetY', labelKey: 'paramOffsetY', default: 0, min: -500, max: 500, step: 1, unit: 'mm' },
    { key: 'offsetZ', labelKey: 'paramOffsetZ', default: 50, min: -500, max: 500, step: 1, unit: 'mm' },
    {
      key: 'operation',
      labelKey: 'paramMoveCopyOp',
      default: 0,
      min: 0,
      max: 1,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'featureOpt_move' },
        { value: 1, labelKey: 'featureOpt_copy' },
      ],
    },
  ],
  apply(geometry, params) {
    return applyMoveCopyMesh(geometry, params);
  },
  async applyAsync(geometry, params) {
    if (shouldUseOcctEngine()) {
      const handle = geometry.userData?.occtHandle as string | undefined;
      if (handle) {
        try {
          const r = occtMoveCopy(
            handle,
            params.offsetX,
            params.offsetY,
            params.offsetZ,
            Math.round(params.operation),
          );
          if (r.handle) {
            r.geometry.userData.occtHandle = r.handle;
            return r.geometry;
          }
        } catch (err) {
          console.warn('[moveCopy] OCCT path failed, falling back to mesh:', err);
        }
      }
    }
    return applyMoveCopyMesh(geometry, params);
  },
};
