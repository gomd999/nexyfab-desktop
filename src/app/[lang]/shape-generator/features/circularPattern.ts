import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition } from './types';
import { occtCircularPattern } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback } from './downgradeNotice';

export const circularPatternFeature: FeatureDefinition = {
  type: 'circularPattern',
  icon: '🔄',
  params: [
    { key: 'axis', labelKey: 'paramPatternAxis', default: 1, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'axisX' },
        { value: 1, labelKey: 'axisY' },
        { value: 2, labelKey: 'axisZ' },
      ] },
    { key: 'count', labelKey: 'paramPatternCount', default: 6, min: 2, max: 36, step: 1, unit: '' },
    { key: 'totalAngle', labelKey: 'paramPatternTotalAngle', default: 360, min: 10, max: 360, step: 5, unit: '°' },
  ],
  apply(geometry, params) {
    const axis = Math.round(params.axis);
    const count = Math.max(2, Math.round(params.count));
    const totalAngleDeg = Math.max(1, params.totalAngle); // prevent 0° producing overlapping copies
    const totalAngle = (totalAngleDeg * Math.PI) / 180;
    const step = totalAngle / count;

    const axisVec = new THREE.Vector3();
    if (axis === 0) axisVec.set(1, 0, 0);
    else if (axis === 1) axisVec.set(0, 1, 0);
    else axisVec.set(0, 0, 1);

    const copies: THREE.BufferGeometry[] = [];
    for (let i = 0; i < count; i++) {
      const clone = geometry.clone();
      const mat = new THREE.Matrix4().makeRotationAxis(axisVec, i * step);
      clone.applyMatrix4(mat);
      copies.push(clone);
    }

    const merged = mergeGeometries(copies);
    if (!merged) throw new Error('Circular pattern merge failed');
    return merged;
  },
  async applyAsync(geometry, params) {
    if (shouldUseOcctEngine()) {
      const handle = geometry.userData?.occtHandle as string | undefined;
      if (handle) {
        try {
          const r = occtCircularPattern(handle, Math.round(params.axis), Math.round(params.count), Math.max(1, params.totalAngle));
          if (r.handle) { r.geometry.userData.occtHandle = r.handle; return r.geometry; }
        } catch (err) {
          console.warn('[circularPattern] OCCT path failed, falling back to mesh:', err);
        }
      }
    }
    // Mesh fallback after wanting B-rep: surface the downgrade (and the
    // helper drops any stale occtHandle so B-rep and mesh can't diverge).
    return noteMeshFallback(circularPatternFeature.apply(geometry, params), { op: 'Circular Pattern' });
  },
};
