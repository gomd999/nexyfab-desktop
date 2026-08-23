/**
 * linearPattern.ts — linear pattern with two targets (W5-D):
 *
 *   patternTarget=0 "body" (legacy default): duplicate the WHOLE body mesh
 *     count times along the axis and merge. Judgment 260721: this is a merge,
 *     not a union — overlapping copies double-count volume (3.0000× signed
 *     volume at spacing<width) and the bbox stretches by (count−1)×spacing.
 *     Kept verbatim for backward compatibility (multi-body layouts, exports).
 *
 *   patternTarget=1 "feature": reference the SOURCE FEATURE (the most recent
 *     cut/hole logged on the body via the pattern-seed log, `seedBack` steps
 *     back) and RE-APPLY the actual subtraction at each instance position.
 *     One body out, N real cuts — correct on curved surfaces and wherever
 *     instances land on pre-existing geometry.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition, FeatureApplyContext } from './types';
import { occtLinearPattern } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback } from './downgradeNotice';
import { readPatternSeeds, setPatternSeeds } from './patternHelpers/featureSeed';
import { reapplySeedAt } from './patternHelpers/featureReapply';

function sanitizeLinear(params: Record<string, number>): { axis: number; count: number; spacing: number } {
  // Coerce non-finite params: Math.max(1, Math.round(NaN)) === NaN slips a NaN
  // count through → 0 copies → empty merge → hard throw; a NaN spacing/axis
  // writes NaN coords. Sanitize + cap count so the pattern always builds.
  const axis = Math.min(2, Math.max(0, Math.round(Number.isFinite(params.axis) ? params.axis : 0)));
  const count = Math.max(1, Math.min(500, Math.round(Number.isFinite(params.count) ? params.count : 1)));
  const spacing = Number.isFinite(params.spacing) ? params.spacing : 60;
  return { axis, count, spacing };
}

/** Feature-mode: re-apply the seed cut/hole at each instance offset. */
function applyFeatureModeLinear(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
  ctx?: FeatureApplyContext,
): THREE.BufferGeometry {
  const { axis, count, spacing } = sanitizeLinear(params);
  const seeds = readPatternSeeds(geometry);
  if (seeds.length === 0) {
    throw new Error(
      'Feature-mode pattern rejected: no patternable source feature (cut/hole) found on this body — '
      + 'the seed log only survives features that preserve it, so place the pattern right after its cut/hole; '
      + 'body mode (patternTarget=0) remains available',
    );
  }
  const back = Math.min(
    seeds.length - 1,
    Math.max(0, Math.round(Number.isFinite(params.seedBack) ? params.seedBack : 0)),
  );
  const seed = seeds[seeds.length - 1 - back]!;
  const holeAxis = seed.type === 'hole'
    ? Math.min(2, Math.max(0, Math.round(Number.isFinite(seed.params.axis) ? seed.params.axis : 1)))
    : 1;
  if (axis === holeAxis) {
    throw new Error(
      'Feature-mode linear pattern rejected: pattern direction is the hole drill axis and cannot create distinct '
      + 'instances; Y-axis pattern cannot re-place a legacy Y-axis hole; choose an in-plane direction',
    );
  }
  const baseX = Number.isFinite(seed.params.posX) ? seed.params.posX : 0;
  const baseY = Number.isFinite(seed.params.posY) ? seed.params.posY : 0;
  const baseZ = Number.isFinite(seed.params.posZ) ? seed.params.posZ : 0;

  // Instance 0 is the seed itself (already on the body); re-apply 1..count-1.
  let geo = geometry;
  for (let i = 1; i < count; i++) {
    const px = baseX + (axis === 0 ? i * spacing : 0);
    const pz = baseZ + (axis === 2 ? i * spacing : 0);
    const py = baseY + (axis === 1 ? i * spacing : 0);
    geo = reapplySeedAt(geo, seed, px, pz, ctx?.featureId, py);
  }
  // The instance re-applications appended themselves to the seed log; restore
  // the incoming log so a later pattern's seedBack indexing is unaffected.
  setPatternSeeds(geo, seeds);
  return geo;
}

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
    { key: 'patternTarget', labelKey: 'paramPatternTarget', default: 0, min: 0, max: 1, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'patternTargetBody' },
        { value: 1, labelKey: 'patternTargetFeature' },
      ] },
    { key: 'seedBack', labelKey: 'paramPatternSeedBack', default: 0, min: 0, max: 15, step: 1, unit: '' },
  ],
  apply(geometry, params, ctx) {
    if (Math.round(params.patternTarget ?? 0) === 1) {
      return applyFeatureModeLinear(geometry, params, ctx);
    }
    const { axis, count, spacing } = sanitizeLinear(params);

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
  async applyAsync(geometry, params, ctx) {
    // Feature mode: re-application dispatches through the seed feature's own
    // apply (which makes its own engine choice) — no whole-body OCCT copy.
    if (Math.round(params.patternTarget ?? 0) === 1) {
      return applyFeatureModeLinear(geometry, params, ctx);
    }
    if (shouldUseOcctEngine()) {
      const handle = geometry.userData?.occtHandle as string | undefined;
      if (handle) {
        try {
          const { axis: axisN, count: countN, spacing: spacingN } = sanitizeLinear(params);
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
