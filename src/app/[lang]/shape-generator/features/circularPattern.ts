/**
 * circularPattern.ts — circular pattern with two targets (W5-D):
 *
 *   patternTarget=0 "body" (legacy default): rotate WHOLE-body mesh copies
 *     about the axis and merge (a merge, not a union — see linearPattern.ts).
 *
 *   patternTarget=1 "feature": re-apply the seed HOLE at positions rotated
 *     about the Y axis. Restricted deliberately:
 *       - axis must be Y — cut/hole advance along −Y, rotating about X/Z
 *         would tilt the drill direction, which the tools can't express;
 *       - seed must be a hole — its cylindrical tool is rotationally
 *         symmetric, so rotating the POSITION alone is exact. A cut's
 *         rectangular tool would additionally need an orientation, which
 *         CutParams doesn't carry yet → explicit rejection, not a wrong body.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition, FeatureApplyContext } from './types';
import { occtCircularPattern } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback } from './downgradeNotice';
import { readPatternSeeds, setPatternSeeds } from './patternHelpers/featureSeed';
import { reapplySeedAt } from './patternHelpers/featureReapply';

function sanitizeCircular(params: Record<string, number>): { axis: number; count: number; totalAngleDeg: number } {
  // Coerce non-finite params (Math.max(2, Math.round(NaN)) === NaN → 0 copies →
  // empty merge → hard throw; NaN angle → NaN rotation). Sanitize + cap count.
  const axis = Math.round(Number.isFinite(params.axis) ? params.axis : 1);
  const count = Math.max(2, Math.min(500, Math.round(Number.isFinite(params.count) ? params.count : 2)));
  const totalAngleDeg = Math.max(1, Number.isFinite(params.totalAngle) ? params.totalAngle : 360); // prevent 0°/NaN producing overlapping copies
  return { axis, count, totalAngleDeg };
}

/** Feature-mode: re-drill the seed hole at Y-rotated positions. */
function applyFeatureModeCircular(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
  ctx?: FeatureApplyContext,
): THREE.BufferGeometry {
  const { axis, count, totalAngleDeg } = sanitizeCircular(params);
  if (axis !== 1) {
    throw new Error(
      'Feature-mode circular pattern rejected: rotation must be about the Y axis — cut/hole advance along −Y, '
      + 'and rotating about X/Z would tilt the drill direction; use axis=Y or body mode (patternTarget=0)',
    );
  }
  const seeds = readPatternSeeds(geometry);
  if (seeds.length === 0) {
    throw new Error(
      'Feature-mode pattern rejected: no patternable source feature (cut/hole) found on this body — '
      + 'place the pattern right after its cut/hole; body mode (patternTarget=0) remains available',
    );
  }
  const back = Math.min(
    seeds.length - 1,
    Math.max(0, Math.round(Number.isFinite(params.seedBack) ? params.seedBack : 0)),
  );
  const seed = seeds[seeds.length - 1 - back]!;
  if (seed.type !== 'hole') {
    throw new Error(
      "Feature-mode circular pattern rejected: the seed is a 'cut' — its rectangular tool has an orientation "
      + 'that rotation would change, and CutParams carries no rotation yet; use a hole seed, a linear pattern, or body mode',
    );
  }
  const baseX = Number.isFinite(seed.params.posX) ? seed.params.posX : 0;
  const baseZ = Number.isFinite(seed.params.posZ) ? seed.params.posZ : 0;
  const step = (totalAngleDeg * Math.PI) / 180 / count;

  // Instance 0 = the seed itself. Positions follow THREE's rotation-about-Y
  // convention (Matrix4.makeRotationY): x' = x·cosθ + z·sinθ, z' = −x·sinθ + z·cosθ.
  let geo = geometry;
  for (let i = 1; i < count; i++) {
    const th = i * step;
    const px = baseX * Math.cos(th) + baseZ * Math.sin(th);
    const pz = -baseX * Math.sin(th) + baseZ * Math.cos(th);
    geo = reapplySeedAt(geo, seed, px, pz, ctx?.featureId);
  }
  // Restore the incoming seed log (instance re-drills appended themselves).
  setPatternSeeds(geo, seeds);
  return geo;
}

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
    { key: 'patternTarget', labelKey: 'paramPatternTarget', default: 0, min: 0, max: 1, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'patternTargetBody' },
        { value: 1, labelKey: 'patternTargetFeature' },
      ] },
    { key: 'seedBack', labelKey: 'paramPatternSeedBack', default: 0, min: 0, max: 15, step: 1, unit: '' },
  ],
  apply(geometry, params, ctx) {
    if (Math.round(params.patternTarget ?? 0) === 1) {
      return applyFeatureModeCircular(geometry, params, ctx);
    }
    const { axis, count, totalAngleDeg } = sanitizeCircular(params);
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
  async applyAsync(geometry, params, ctx) {
    // Feature mode: per-instance re-drill through the hole's own apply — no
    // whole-body OCCT copy (see linearPattern.applyAsync note).
    if (Math.round(params.patternTarget ?? 0) === 1) {
      return applyFeatureModeCircular(geometry, params, ctx);
    }
    if (shouldUseOcctEngine()) {
      const handle = geometry.userData?.occtHandle as string | undefined;
      if (handle) {
        try {
          const { axis: axisN, count: countN, totalAngleDeg: angleN } = sanitizeCircular(params);
          const r = occtCircularPattern(handle, axisN, countN, angleN);
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
