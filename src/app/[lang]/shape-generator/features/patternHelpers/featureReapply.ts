/**
 * featureReapply.ts — re-execute a logged cut/hole seed at a new (posX, posZ).
 *
 * This is the heart of the W5-D feature-unit pattern: each pattern instance is
 * a REAL subtraction re-run against the current body (so end conditions,
 * curved surfaces, and pre-existing geometry are honored per instance), not a
 * mesh copy of the whole body.
 *
 * W2 판정 유지: hole/rib stay leaf features with self-contained tool bodies —
 * re-application goes through the SAME public apply paths (applyCut /
 * holeFeature.apply), so instance geometry is byte-equivalent to authoring the
 * feature at that position by hand.
 */
import type * as THREE from 'three';
import { applyCut, endConditionFromEnum } from '../cut';
import { holeFeature } from '../hole';
import type { PatternSeed } from './featureSeed';

/**
 * Re-apply `seed` on `geometry` at the given position. Throws (with the
 * underlying reason) exactly like the source feature would — the pattern
 * caller surfaces that as a rejection rather than emitting wrong geometry.
 */
export function reapplySeedAt(
  geometry: THREE.BufferGeometry,
  seed: PatternSeed,
  posX: number,
  posZ: number,
  featureId?: string,
  posY?: number,
): THREE.BufferGeometry {
  if (seed.type === 'cut') {
    const p = seed.params;
    return applyCut(
      geometry,
      {
        width: p.width ?? 20,
        length: p.length ?? 10,
        posX,
        posZ,
        endCondition: endConditionFromEnum(p.endCondition),
        ...(Number.isFinite(p.depth) ? { depth: p.depth } : {}),
        ...(Number.isFinite(p.upToPlaneY) ? { upToPlaneY: p.upToPlaneY } : {}),
      },
      featureId,
    );
  }
  // hole — full feature apply with only the position overridden. The seed's
  // params snapshot already carries endCondition / resolved upToPlaneY, so no
  // FeatureApplyContext face selection is needed here.
  return holeFeature.apply(
    geometry,
    { ...seed.params, posX, posZ, ...(Number.isFinite(posY) ? { posY } : {}) },
    featureId ? { featureId } : undefined,
  );
}
