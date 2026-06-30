import * as THREE from 'three';
import type { FeatureDefinition } from './types';
import { occtDraft } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback, clearStaleBrepHandle } from './downgradeNotice';
import { captureKernelFailure } from './kernelCorpus';

function applyDraftMesh(geometry: THREE.BufferGeometry, params: Record<string, number>): THREE.BufferGeometry {
  // Clamp away from ±90°: tan(90°) is Infinity and would write NaN coordinates
  // into every vertex (silent invalid solid). UI bounds are 1–30°, but an
  // AI/programmatic param could pass 90 — or NaN, which slips through Math.min/max
  // (Math.max(-89, Math.min(89, NaN)) === NaN), so coerce non-finite to 0 first.
  const rawAngle = Number.isFinite(params.angle) ? params.angle : 0;
  const angleDeg = Math.max(-89, Math.min(89, rawAngle));
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
  // THREE's clone shares userData by reference — the sheared mesh must not
  // keep advertising the PRE-draft upstream B-rep solid (downstream OCCT
  // features / STEP export would silently operate on the undrafted solid).
  return clearStaleBrepHandle(clone);
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
          const safeAngle = Number.isFinite(params.angle) ? params.angle : 0;
          const r = occtDraft(handle, safeAngle, Math.round(params.direction));
          if (r.handle) {
            r.geometry.userData.occtHandle = r.handle;
            return r.geometry;
          }
        } catch (err) {
          console.warn('[draft] OCCT path failed, falling back to mesh:', err);
          captureKernelFailure({
            op: 'draft',
            params: { angle: params.angle, direction: Math.round(params.direction) },
            geometry,
            error: err,
            resolution: { strategy: 'mesh-fallback', requested: { angle: params.angle } },
          });
        }
      }
    }
    // Wanted B-rep but meshed (no handle / OCCT unavailable / threw) → soft notice.
    return noteMeshFallback(applyDraftMesh(geometry, params), { op: 'Draft' });
  },
};
