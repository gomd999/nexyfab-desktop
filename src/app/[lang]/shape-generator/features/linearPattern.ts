import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition } from './types';
import { occtLinearPattern } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback } from './downgradeNotice';

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
    // Coerce non-finite params: Math.max(1, Math.round(NaN)) === NaN slips a NaN
    // count through → 0 copies → empty merge → hard throw; a NaN spacing/axis
    // writes NaN coords. Sanitize + cap count so the pattern always builds.
    const axis = Math.min(2, Math.max(0, Math.round(Number.isFinite(params.axis) ? params.axis : 0)));
    const count = Math.max(1, Math.min(500, Math.round(Number.isFinite(params.count) ? params.count : 1)));
    const spacing = Number.isFinite(params.spacing) ? params.spacing : 60;

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
  async applyAsync(geometry, params) {
    if (shouldUseOcctEngine()) {
      const handle = geometry.userData?.occtHandle as string | undefined;
      if (handle) {
        try {
          const axisN = Math.min(2, Math.max(0, Math.round(Number.isFinite(params.axis) ? params.axis : 0)));
          const countN = Math.max(1, Math.min(500, Math.round(Number.isFinite(params.count) ? params.count : 1)));
          const spacingN = Number.isFinite(params.spacing) ? params.spacing : 60;
          const r = occtLinearPattern(handle, axisN, countN, spacingN);
          if (r.handle) { r.geometry.userData.occtHandle = r.handle; return r.geometry; }
        } catch (err) {
          console.warn('[linearPattern] OCCT path failed, falling back to mesh:', err);
        }
      }
    }
    // Mesh fallback after wanting B-rep: surface the downgrade (and the
    // helper drops any stale occtHandle so B-rep and mesh can't diverge).
    return noteMeshFallback(linearPatternFeature.apply(geometry, params), { op: 'Linear Pattern' });
  },
};
