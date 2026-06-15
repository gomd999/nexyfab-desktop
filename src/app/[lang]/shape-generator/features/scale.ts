import * as THREE from 'three';
import type { FeatureDefinition } from './types';
import { occtScale } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';

function applyScaleMesh(geometry: THREE.BufferGeometry, params: Record<string, number>): THREE.BufferGeometry {
  const { scaleX, scaleY, scaleZ } = params;
  const clone = geometry.clone();
  clone.applyMatrix4(new THREE.Matrix4().makeScale(scaleX, scaleY, scaleZ));
  clone.computeVertexNormals();
  return clone;
}

export const scaleFeature: FeatureDefinition = {
  type: 'scale',
  icon: '🔍',
  params: [
    { key: 'scaleX', labelKey: 'paramScaleX', default: 1, min: 0.1, max: 5, step: 0.01, unit: '×' },
    { key: 'scaleY', labelKey: 'paramScaleY', default: 1, min: 0.1, max: 5, step: 0.01, unit: '×' },
    { key: 'scaleZ', labelKey: 'paramScaleZ', default: 1, min: 0.1, max: 5, step: 0.01, unit: '×' },
  ],
  apply(geometry, params) {
    return applyScaleMesh(geometry, params);
  },
  async applyAsync(geometry, params) {
    if (shouldUseOcctEngine()) {
      const handle = geometry.userData?.occtHandle as string | undefined;
      if (handle) {
        try {
          const r = occtScale(handle, params.scaleX, params.scaleY, params.scaleZ);
          if (r.handle) {
            r.geometry.userData.occtHandle = r.handle;
            return r.geometry;
          }
        } catch (err) {
          console.warn('[scale] OCCT path failed, falling back to mesh:', err);
        }
      }
    }
    return applyScaleMesh(geometry, params);
  },
};
