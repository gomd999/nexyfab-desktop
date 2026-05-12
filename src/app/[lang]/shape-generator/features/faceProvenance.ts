import type * as THREE from 'three';

/**
 * Coarse-to-deep transition layer for face provenance (B1).
 *
 * Today: pipelineManager tags every output geometry with
 * `userData.lastFeatureId`. DFM consumers read that value directly. The deep
 * implementation (per-triangle feature id stored in a `Uint32Array`
 * BufferAttribute, propagated through CSG / fillet / OCCT) is documented in
 * `docs/strategy/b1-face-provenance.md` and gated behind that work.
 *
 * This helper is the single read entry point everyone *should* use so the
 * eventual swap from "coarse lastFeatureId" to "per-triangle attribute"
 * happens in one place rather than at every call site.
 */

/** Hidden BufferAttribute name reserved for the deep B1 per-face mapping. */
export const FACE_FEATURE_ID_ATTR = 'nfabFaceFeatureId';

/**
 * Resolve the feature id responsible for the face containing `triangleIndex`.
 *
 * Order of preference:
 *   1. Per-triangle `nfabFaceFeatureId` BufferAttribute (deep B1 — does
 *      not exist yet, but consumers should be ready for it).
 *   2. `userData.lastFeatureId` (current coarse implementation).
 *
 * Returns `null` if neither source carries provenance — caller can degrade
 * gracefully (e.g. surface the issue without a target feature link).
 */
export function getFaceFeatureId(
  geometry: THREE.BufferGeometry,
  triangleIndex: number,
): string | null {
  // Path A — deep per-triangle attribute. The BufferAttribute stores numeric
  // ids that map back to feature ids via `nfabFeatureIdMap` on userData.
  // Behavior matches the documented deep-impl plan, so consumers written
  // against this API today keep working once the attribute lands.
  const attr = geometry.getAttribute(FACE_FEATURE_ID_ATTR) as
    | THREE.BufferAttribute
    | undefined;
  if (attr && triangleIndex >= 0 && triangleIndex < attr.count) {
    const numericId = attr.getX(triangleIndex);
    const map = geometry.userData?.nfabFeatureIdMap as
      | Record<number, string>
      | undefined;
    if (map && map[numericId]) return map[numericId];
  }

  // Path B — coarse fallback. Every triangle on the output of a feature
  // shares the same `lastFeatureId`. Always correct, just not granular.
  const coarse = geometry.userData?.lastFeatureId;
  return typeof coarse === 'string' ? coarse : null;
}

/**
 * Coarse setter — write `lastFeatureId` only. Use when a feature emits
 * a single output and per-triangle tagging is out of scope.
 *
 * The pipelineManager has historically written directly to `userData`;
 * this helper exists so the call site can be searched for via grep when
 * the deep-impl phase wants to swap it for a granular tagger.
 */
export function tagWholeGeometryFeature(
  geometry: THREE.BufferGeometry,
  featureId: string,
): void {
  geometry.userData = { ...geometry.userData, lastFeatureId: featureId };
}
