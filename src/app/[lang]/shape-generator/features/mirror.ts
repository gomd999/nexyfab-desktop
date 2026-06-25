import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition } from './types';
import { occtMirror } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback } from './downgradeNotice';

export const mirrorFeature: FeatureDefinition = {
  type: 'mirror',
  icon: '🪞',
  params: [
    { key: 'plane', labelKey: 'paramMirrorPlane', default: 0, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'planeYZ' },  // mirror across YZ (flip X)
        { value: 1, labelKey: 'planeXZ' },  // mirror across XZ (flip Y)
        { value: 2, labelKey: 'planeXY' },  // mirror across XY (flip Z)
      ] },
  ],
  apply(geometry, params) {
    const plane = Math.round(params.plane);
    const clone = geometry.clone();

    // Scale -1 on the mirror axis
    const scale = [1, 1, 1];
    scale[plane] = -1;
    clone.applyMatrix4(new THREE.Matrix4().makeScale(scale[0], scale[1], scale[2]));

    // Reverse winding order (flip index triplets) to fix normals after mirroring
    const index = clone.index;
    if (index) {
      const arr = index.array as Uint32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const tmp = arr[i];
        arr[i] = arr[i + 2];
        arr[i + 2] = tmp;
      }
      index.needsUpdate = true;
    }

    const merged = mergeGeometries([geometry.clone(), clone]);
    if (!merged) throw new Error('Mirror merge failed');
    return merged;
  },
  async applyAsync(geometry, params) {
    if (shouldUseOcctEngine()) {
      const handle = geometry.userData?.occtHandle as string | undefined;
      if (handle) {
        try {
          const r = occtMirror(handle, Math.round(params.plane));
          if (r.handle) { r.geometry.userData.occtHandle = r.handle; return r.geometry; }
        } catch (err) {
          console.warn('[mirror] OCCT path failed, falling back to mesh:', err);
        }
      }
    }
    // Mesh fallback after wanting B-rep: surface the downgrade (and the
    // helper drops any stale occtHandle so B-rep and mesh can't diverge).
    return noteMeshFallback(mirrorFeature.apply(geometry, params), { op: 'Mirror' });
  },
};
