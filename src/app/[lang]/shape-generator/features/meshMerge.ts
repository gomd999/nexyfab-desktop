/**
 * meshMerge.ts — shared attribute/index unification for mesh combining ops.
 *
 * Every merge-based feature (tab, flange, hem, sketch-extrude add) and every
 * three-bvh-csg boolean has the same failure mode: the two bodies disagree on
 * their attribute sets. Geometries arrive from wildly different producers —
 *   • BoxGeometry / primitive bases ........ indexed, position+normal+uv
 *   • ExtrudeGeometry sketch tools ......... non-indexed, position+normal+uv
 *   • OCCT tessellation (shell/fillet) ..... indexed, position+normal, NO uv
 *   • CSG outputs .......................... non-indexed, whatever survived
 *   • pipeline outputs ..................... + per-vertex `nfabFaceFeatureId`
 *     (the face-provenance stamp pipelineManager writes after every feature)
 * — and three's mergeGeometries() hard-fails on ANY attribute-set difference,
 * while three-bvh-csg dereferences `.array` of an attribute it was told to
 * interpolate even when one operand doesn't carry it.
 *
 * Policy (the "full attribute matrix"):
 *   position   required on both — never touched.
 *   normal     synthesized (computeVertexNormals) when missing.
 *   provenance (nfabFaceFeatureId) KEPT whenever either side has it: the
 *              missing side is filled with the 0 sentinel ("unattributed"),
 *              so per-triangle face provenance survives the combine.
 *   uv / everything else  dropped from the side that has it when the peer
 *              doesn't — uv on a CAD body is decorative and cannot be
 *              meaningfully synthesized for the other operand.
 *   index      parity-aligned for merges (both indexed or both non-indexed).
 *
 * `alignForMerge` never mutates its inputs destructively: an input is cloned
 * lazily before its attribute set is changed, so live pipeline geometries
 * (which may be cache entries) are safe to pass directly.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FACE_FEATURE_ID_ATTR } from './faceProvenance';

/** Fill the per-vertex face-provenance attribute with the 0 sentinel
 *  ("unattributed") when absent, so an evaluator/merge told to carry the
 *  attribute never reads `.array` of an absent attribute. Additive-only
 *  mutation — semantically a no-op for provenance lookups. */
export function ensureFaceIdSentinel(geo: THREE.BufferGeometry): void {
  if (geo.getAttribute(FACE_FEATURE_ID_ATTR)) return;
  const vertCount = geo.attributes.position?.count ?? 0;
  geo.setAttribute(FACE_FEATURE_ID_ATTR, new THREE.BufferAttribute(new Uint32Array(vertCount), 1));
}

/**
 * Normalize two geometries so `mergeGeometries([a, b])` succeeds regardless of
 * where each mesh came from. Returns the (possibly replaced) pair; the inputs
 * themselves are never destructively mutated (lazy clone-on-write).
 */
export function alignForMerge(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): [THREE.BufferGeometry, THREE.BufferGeometry] {
  let ax = a;
  let bx = b;
  let ownA = false;
  let ownB = false;
  const mutA = (): THREE.BufferGeometry => {
    if (!ownA) { ax = ax.clone(); ownA = true; }
    return ax;
  };
  const mutB = (): THREE.BufferGeometry => {
    if (!ownB) { bx = bx.clone(); ownB = true; }
    return bx;
  };

  // Normals: synthesize so the shared set always includes them.
  if (!ax.getAttribute('normal')) mutA().computeVertexNormals();
  if (!bx.getAttribute('normal')) mutB().computeVertexNormals();

  // Face provenance: keep where present — sentinel-fill the other side.
  const aProv = !!ax.getAttribute(FACE_FEATURE_ID_ATTR);
  const bProv = !!bx.getAttribute(FACE_FEATURE_ID_ATTR);
  if (aProv && !bProv) ensureFaceIdSentinel(mutB());
  else if (bProv && !aProv) ensureFaceIdSentinel(mutA());

  // Everything else (uv, color, tangent, ...): drop when not shared.
  for (const k of Object.keys(ax.attributes)) {
    if (k !== 'position' && k !== FACE_FEATURE_ID_ATTR && !bx.getAttribute(k)) {
      mutA().deleteAttribute(k);
    }
  }
  for (const k of Object.keys(bx.attributes)) {
    if (k !== 'position' && k !== FACE_FEATURE_ID_ATTR && !ax.getAttribute(k)) {
      mutB().deleteAttribute(k);
    }
  }

  // Index parity: mergeGeometries requires both-indexed or both-non-indexed.
  if (!!ax.index !== !!bx.index) {
    if (ax.index) ax = ax.toNonIndexed();
    if (bx.index) bx = bx.toNonIndexed();
  }
  return [ax, bx];
}

/** Align then merge. Returns null when mergeGeometries itself fails (which,
 *  after alignment, only happens on truly malformed inputs). */
export function mergeAligned(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): THREE.BufferGeometry | null {
  const [ax, bx] = alignForMerge(a, b);
  return mergeGeometries([ax, bx], false);
}

/**
 * Configure a three-bvh-csg Evaluator for two arbitrary operands:
 *   - interpolated attributes = those present on BOTH (position/normal/uv)
 *   - face provenance is preserved whenever EITHER side carries it — the
 *     missing side is sentinel-filled in place (additive-only mutation,
 *     required because the evaluator reads the attribute from both brushes).
 * Replaces the per-callsite `evaluator.attributes` fiddling that left bases
 * unstamped and crashed the boolean (reliefCuts / sketch-cut findings).
 */
export function configureEvaluatorAttributes(
  evaluator: { attributes: string[] },
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): void {
  // Normals are required downstream (shading, offset ops) — compute instead
  // of dropping when an operand arrives without them (K2: welded/derived
  // meshes). uv stays intersection-only: cosmetic on CAD bodies.
  if (!a.getAttribute('normal')) a.computeVertexNormals();
  if (!b.getAttribute('normal')) b.computeVertexNormals();
  const attrs = ['position', 'normal', 'uv'].filter(
    k => a.getAttribute(k) && b.getAttribute(k),
  );
  if (a.getAttribute(FACE_FEATURE_ID_ATTR) || b.getAttribute(FACE_FEATURE_ID_ATTR)) {
    ensureFaceIdSentinel(a);
    ensureFaceIdSentinel(b);
    attrs.push(FACE_FEATURE_ID_ATTR);
  }
  evaluator.attributes = attrs;
}
