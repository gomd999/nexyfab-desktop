import * as THREE from 'three';

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
  // Path A — deep per-triangle attribute. The attribute is per-vertex
  // (three-bvh-csg flattens to non-indexed for the output), so triangle
  // `i` occupies verts `3i, 3i+1, 3i+2`. We read the first vertex.
  const strict = getFaceFeatureIdStrict(geometry, triangleIndex);
  if (strict !== null) return strict;

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

// ─── Deep B1 — per-triangle BufferAttribute path ─────────────────────────────

/**
 * Look up or allocate a stable numeric id for `featureId` inside the
 * geometry's `nfabFeatureIdMap`. Numeric ids are 1-indexed so the default
 * zero-filled BufferAttribute on freshly-cloned geometry decodes to "no
 * feature" instead of accidentally pointing at feature #0.
 *
 * When `avoidIdsFrom` is provided (e.g. the boolean feature passes the base
 * geometry's map when stamping its tool), the allocated id is guaranteed to
 * not collide with any id in that map. This matters because after CSG the
 * two geometries' maps are merged on the output, so both inputs must
 * occupy non-overlapping numeric ranges or the resolution table flattens
 * one of them.
 */
function ensureNumericId(
  geometry: THREE.BufferGeometry,
  featureId: string,
  avoidIdsFrom?: Record<number, string>,
): number {
  const map = (geometry.userData?.nfabFeatureIdMap as
    | Record<number, string>
    | undefined) ?? {};
  for (const [num, id] of Object.entries(map)) {
    if (id === featureId) return Number(num);
  }
  // Choose the next free numeric id. Keys may have gaps if features were
  // deleted between runs; we don't compact — gaps cost one Uint32 worth of
  // memory each, which is irrelevant compared to the position attribute.
  const used = [
    ...Object.keys(map).map(Number),
    ...(avoidIdsFrom ? Object.keys(avoidIdsFrom).map(Number) : []),
  ];
  const nextId = used.length > 0 ? Math.max(...used) + 1 : 1;
  const nextMap = { ...map, [nextId]: featureId };
  geometry.userData = { ...geometry.userData, nfabFeatureIdMap: nextMap };
  return nextId;
}

/**
 * Stamp every triangle in `geometry` with `featureId` via the per-triangle
 * `nfabFaceFeatureId` BufferAttribute. Idempotent — overwrites whatever was
 * there before, which is what a feature applier wants since it owns the
 * whole output.
 *
 * For CSG output where different triangles came from different inputs,
 * callers should use `preserveFaceFeatureAttrThroughCSG()` on the inputs
 * before evaluation instead of stamping after.
 */
export function stampFaceFeatureIdAll(
  geometry: THREE.BufferGeometry,
  featureId: string,
  opts?: { avoidIdsFrom?: THREE.BufferGeometry },
): void {
  const peerMap = opts?.avoidIdsFrom?.userData?.nfabFeatureIdMap as
    | Record<number, string>
    | undefined;
  const numericId = ensureNumericId(geometry, featureId, peerMap);
  const triBased = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
  // BVH-CSG flattens to non-indexed (3 verts per triangle, one attribute
  // entry per vertex). Allocate at vertex-count granularity so the per-
  // vertex copy three-bvh-csg performs lines up with our per-triangle
  // semantics — verts 3i, 3i+1, 3i+2 all share the same feature id.
  const vertCount = geometry.attributes.position.count;
  const arr = new Uint32Array(vertCount);
  arr.fill(numericId);
  geometry.setAttribute(FACE_FEATURE_ID_ATTR, new THREE.BufferAttribute(arr, 1));
  // Coarse `lastFeatureId` stays in sync so consumers that haven't migrated
  // to the per-triangle reader still get correct (coarse) answers.
  geometry.userData = { ...geometry.userData, lastFeatureId: featureId };
  void triBased; // referenced for clarity; vertCount/3 is canonical here.
}

/**
 * Read the per-triangle attribute from `triangleIndex` and resolve it back
 * to a string feature id. Returns `null` when no attribute is present or
 * the numeric id is the sentinel zero.
 *
 * Used internally by `getFaceFeatureId`; exposed for tests that want to
 * assert per-triangle attribution without the coarse fallback masking the
 * deep value.
 */
export function getFaceFeatureIdStrict(
  geometry: THREE.BufferGeometry,
  triangleIndex: number,
): string | null {
  const attr = geometry.getAttribute(FACE_FEATURE_ID_ATTR) as
    | THREE.BufferAttribute
    | undefined;
  if (!attr) return null;
  // Each triangle owns 3 consecutive vertices in a non-indexed mesh; the
  // attribute is per-vertex but our writer pins all three of a triangle to
  // the same value, so reading the first vertex is sufficient.
  const vertIndex = triangleIndex * 3;
  if (vertIndex < 0 || vertIndex >= attr.count) return null;
  const numericId = attr.getX(vertIndex);
  if (numericId === 0) return null;
  const map = geometry.userData?.nfabFeatureIdMap as
    | Record<number, string>
    | undefined;
  if (!map) return null;
  return map[numericId] ?? null;
}

/**
 * Merge `nfabFeatureIdMap`s from `sources` onto `target`. three-bvh-csg's
 * Evaluator preserves the per-vertex attribute values when configured but
 * does *not* carry the numeric → string id map across — that's userData
 * and userData lives on the geometry's own object. Every CSG callsite has
 * to do this manual merge so downstream `getFaceFeatureId` lookups still
 * resolve.
 *
 * Idempotent. Later sources override earlier on key collision; collisions
 * are benign when both sides map the same numeric id to the same feature
 * id (e.g. multiple tools tagged with the same feature). Genuine drift —
 * two sources mapping the same numeric id to different features — is
 * prevented by passing `avoidIdsFrom` when stamping tools.
 */
export function propagateFeatureIdMap(
  target: THREE.BufferGeometry,
  ...sources: THREE.BufferGeometry[]
): void {
  const merged: Record<number, string> = {};
  for (const s of sources) {
    const m = s.userData?.nfabFeatureIdMap as Record<number, string> | undefined;
    if (m) Object.assign(merged, m);
  }
  if (Object.keys(merged).length > 0) {
    target.userData = { ...target.userData, nfabFeatureIdMap: merged };
  }
}

/**
 * Configure a three-bvh-csg Evaluator to preserve the `nfabFaceFeatureId`
 * attribute when at least one of the supplied input geometries carries it.
 * Mutates the evaluator in place; safe to call repeatedly (idempotent on
 * the attributes array).
 *
 * Use together with `stampFaceFeatureIdAll` on tools and
 * `propagateFeatureIdMap` on the result to keep the per-triangle id round-
 * trip intact across a boolean op.
 */
/**
 * ⚠ K2 (95% plan): this helper is ADDITIVE-ONLY — it does not remove
 * attributes an operand lacks, so an Evaluator configured only by it still
 * crashes ("Cannot read properties of undefined (reading 'array')") when one
 * side is missing uv/normal (OCCT tessellations, welded meshes). CSG sites
 * should call `meshMerge.configureEvaluatorAttributes` instead, which is a
 * superset: intersection of position/normal/uv on both operands PLUS the
 * provenance sentinel handling below.
 */
export function configureEvaluatorForProvenance(
  evaluator: { attributes: string[] },
  ...inputs: THREE.BufferGeometry[]
): void {
  const anyHasAttr = inputs.some(g => !!g.getAttribute(FACE_FEATURE_ID_ATTR));
  if (!anyHasAttr) return;
  if (!evaluator.attributes.includes(FACE_FEATURE_ID_ATTR)) {
    evaluator.attributes = [...evaluator.attributes, FACE_FEATURE_ID_ATTR];
  }
}
