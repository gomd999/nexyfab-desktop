/**
 * applyFaceOps.ts — viewport-side dispatchers for FaceContextPanel.
 *
 * Two operations, both reusing existing infrastructure:
 *
 *   - **offsetFace(geo, face, deltaMm)** — translates every vertex on the
 *     selected face along its averaged normal. Identical semantics to
 *     `useFaceEditing.pushPullFace`, but operates on a *new* BufferGeometry
 *     so the panel can apply via the existing `onGeometryApply` host callback
 *     (instead of mutating the FaceScene's internal edit-geometry ref).
 *
 *   - **shellWhole(geo, thicknessMm, openFace?)** — delegates to the existing
 *     `shellFeature.apply` (mesh path) or `shellFeature.applyAsync` (OCCT
 *     path when the upstream `geometry.userData.occtHandle` is set). No new
 *     shell math here — the deterministic OCCT/CSG implementation already
 *     lives in `features/shell.ts`.
 *
 * Both functions return a fresh `BufferGeometry` and never mutate the input.
 * Errors are thrown so the caller can map them to status codes.
 *
 * Why not call `useFaceEditing.pushPullFace` from the panel? That mutates a
 * ref *inside* FaceScene and bumps an internal revision. The panel lives
 * outside FaceScene, so going through `onGeometryApply` is the same path
 * EdgeContextPanel uses for fillet/chamfer — consistent dispatch shape.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { UniqueFace } from './useFaceEditing';

/** Re-extract face's unique buffer-vertex indices on a non-indexed geometry
 *  (the FaceScene's edit geometry is always converted to non-indexed). */
function uniqueVertexIndices(face: UniqueFace): number[] {
  const seen = new Set<number>();
  for (const ti of face.triangleIndices) {
    seen.add(ti * 3);
    seen.add(ti * 3 + 1);
    seen.add(ti * 3 + 2);
  }
  return Array.from(seen);
}

/**
 * Translate every vertex of `face` along its normal by `deltaMm`. Returns a
 * cloned non-indexed BufferGeometry suitable for `onGeometryApply`. Throws if
 * `deltaMm` is not finite or the geometry lacks a position attribute.
 *
 * Note: this is the deterministic "Face Offset" referenced by the
 * SelectionInfoBadge label `t.faceOffset`. Up to now that chip routed the
 * request through AI chat with a hint string; this helper makes it a
 * one-click viewport operation.
 */
export function offsetFace(
  source: THREE.BufferGeometry,
  face: UniqueFace,
  deltaMm: number,
): THREE.BufferGeometry {
  if (!Number.isFinite(deltaMm)) {
    throw new Error('OFFSET_INVALID');
  }
  const posAttr = source.attributes.position;
  if (!posAttr) {
    throw new Error('NO_GEOMETRY');
  }

  // Always operate on a non-indexed clone so the per-face vertex indices
  // returned by `extractFaces` (which run on non-indexed geometry inside
  // FaceScene) line up with our buffer indexing.
  let working: THREE.BufferGeometry = source.clone();
  if (working.index) {
    working = working.toNonIndexed();
  }

  const workPos = working.attributes.position as THREE.BufferAttribute;
  const [nx, ny, nz] = face.normal;
  const dx = nx * deltaMm;
  const dy = ny * deltaMm;
  const dz = nz * deltaMm;

  for (const idx of uniqueVertexIndices(face)) {
    if (idx >= workPos.count) continue;
    workPos.setXYZ(
      idx,
      workPos.getX(idx) + dx,
      workPos.getY(idx) + dy,
      workPos.getZ(idx) + dz,
    );
  }
  workPos.needsUpdate = true;
  working.computeVertexNormals();
  working.computeBoundingBox();
  working.computeBoundingSphere();
  return working;
}

export type ShellOpenFace = 0 | 1 | 2;

/**
 * Hollow the whole solid by `thicknessMm` (uniform wall). Delegates to the
 * existing parametric `shellFeature` so OCCT + three-bvh-csg fallback both
 * stay in one code path. Returns a fresh BufferGeometry.
 *
 * `openFace`:
 *   0 = closed shell (no opening),
 *   1 = open top (+Y),
 *   2 = open bottom (-Y).
 *
 * Async — `shellFeature.applyAsync` does the OCCT face-finder round-trip
 * when an upstream B-rep handle is attached to `geometry.userData.occtHandle`.
 */
export async function shellWhole(
  source: THREE.BufferGeometry,
  thicknessMm: number,
  openFace: ShellOpenFace = 0,
): Promise<THREE.BufferGeometry> {
  if (!(thicknessMm > 0) || !Number.isFinite(thicknessMm)) {
    throw new Error('THICKNESS_INVALID');
  }
  if (!source.attributes.position || source.attributes.position.count < 4) {
    throw new Error('NO_GEOMETRY');
  }

  // shell.ts (mesh-CSG path) needs an INDEXED, welded mesh. Imported STLs and
  // FaceScene edit geometry are non-indexed (triangle soup), so weld them first
  // — otherwise shell silently failed on every imported/edited part.
  let working: THREE.BufferGeometry = source;
  if (!working.index) {
    try {
      working = mergeVertices(source);
    } catch {
      // mergeVertices can throw on degenerate input — fall back to a trivial
      // index so downstream code still sees an indexed geometry.
      const n = source.attributes.position.count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      working = source.clone();
      working.setIndex(new THREE.BufferAttribute(idx, 1));
    }
  }
  if (!working.index || working.attributes.position.count < 4) {
    throw new Error('NO_GEOMETRY');
  }

  const { shellFeature } = await import('../features/shell');
  const params = {
    wallThickness: thicknessMm,
    openFace,
    engine: 1, // prefer OCCT when ready; shell.ts falls back to mesh-CSG on failure.
  };
  const ctx = { featureId: 'face-context-shell' };

  if (shellFeature.applyAsync) {
    return shellFeature.applyAsync(working, params, ctx);
  }
  return shellFeature.apply(working, params, ctx);
}
