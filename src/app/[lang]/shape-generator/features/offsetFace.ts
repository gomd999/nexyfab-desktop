/**
 * offsetFace — direct editing Phase 1 (SolidWorks-parity roadmap).
 *
 * Moves the selected PLANAR face along its normal by `distance` (±). Two paths:
 *
 *   OCCT (primary, occtOffsetFace): prism rebuild — the B-rep face is extruded
 *   along its normal and fused (outward) / cut (inward). Push/pull semantics:
 *   for the dominant case of perpendicular neighbour walls this is exactly
 *   SolidWorks Move Face (Offset); slanted neighbours gain a prism side wall
 *   instead of being extended (honest scope, documented on the param).
 *
 *   Mesh fallback: every vertex lying on the selected face's plane (matched by
 *   the stored normal + plane offset, position-deduped so duplicated corner
 *   vertices of adjacent walls follow) is translated by distance × normal. For
 *   a planar face with straight walls this is the same geometry as the prism
 *   rebuild minus B-rep exactness — stamped as an 'approximated' downgrade.
 *   Slanted neighbours TILT rather than extend; curved faces are refused.
 *
 * Imported bodies without an upstream handle are bridged through
 * meshToSimplifiedBrepHandle (importSTL + UnifySameDomain) like deleteFace.
 */
import * as THREE from 'three';
import type { FeatureDefinition } from './types';
import type { FaceSelectionInfo } from '../editing/selectionInfo';
import {
  occtOffsetFace,
  meshToSimplifiedBrepHandle,
  isOcctReady,
} from './occtEngine';
import { noteMeshFallback } from './downgradeNotice';

/** Plane membership tolerance (mm) for re-finding the face on the current mesh. */
const PLANE_TOL = 0.01;
/** Triangle-normal alignment threshold for face membership (cos ~2.5°). */
const ALIGN_TOL = 0.999;

function quantKey(x: number, y: number, z: number): string {
  return `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
}

/**
 * Mesh-mode planar offset: translate every vertex on the selected face's plane
 * (within the face's same-normal triangle set) by `distance` along the normal.
 * Adjacent wall vertices at identical positions follow via position matching,
 * so the result stays watertight. Throws structured errors for unfound faces
 * and offsets that would invert the body.
 */
export function applyOffsetFaceMesh(
  geometry: THREE.BufferGeometry,
  sel: Pick<FaceSelectionInfo, 'position' | 'normal'>,
  distance: number,
): THREE.BufferGeometry {
  const nLen = Math.hypot(sel.normal[0], sel.normal[1], sel.normal[2]);
  if (nLen < 1e-9) throw new Error('Offset Face: the stored face selection has a degenerate normal');
  const n: [number, number, number] = [sel.normal[0] / nLen, sel.normal[1] / nLen, sel.normal[2] / nLen];
  const planeD = n[0] * sel.position[0] + n[1] * sel.position[1] + n[2] * sel.position[2];

  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count < 3) throw new Error('Offset Face: geometry has no triangles');
  const idx = geometry.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;

  if (Math.abs(distance) < 1e-9) return geometry.clone();

  // Self-intersection guard: an inward pull deeper than the body's extent
  // along the normal would turn the solid inside out.
  if (distance < 0) {
    let minProj = Infinity;
    let maxProj = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const p = pos.getX(i) * n[0] + pos.getY(i) * n[1] + pos.getZ(i) * n[2];
      if (p < minProj) minProj = p;
      if (p > maxProj) maxProj = p;
    }
    if (-distance >= maxProj - minProj) {
      throw new Error('Offset Face: the inward offset exceeds the body extent along the face normal — reduce the distance');
    }
  }

  // Find the face's triangles on the CURRENT mesh: triangle normal aligned with
  // the stored normal AND all three vertices on the stored plane.
  const faceVertKeys = new Set<string>();
  let matchedTris = 0;
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const tn = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const ia = idx ? idx.getX(t * 3) : t * 3;
    const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    va.fromBufferAttribute(pos, ia);
    vb.fromBufferAttribute(pos, ib);
    vc.fromBufferAttribute(pos, ic);
    const da = va.x * n[0] + va.y * n[1] + va.z * n[2] - planeD;
    const db = vb.x * n[0] + vb.y * n[1] + vb.z * n[2] - planeD;
    const dc = vc.x * n[0] + vc.y * n[1] + vc.z * n[2] - planeD;
    if (Math.abs(da) > PLANE_TOL || Math.abs(db) > PLANE_TOL || Math.abs(dc) > PLANE_TOL) continue;
    ab.subVectors(vb, va);
    ac.subVectors(vc, va);
    tn.crossVectors(ab, ac);
    const tl = tn.length();
    if (tl < 1e-12) continue;
    if ((tn.x * n[0] + tn.y * n[1] + tn.z * n[2]) / tl < ALIGN_TOL) continue;
    matchedTris++;
    faceVertKeys.add(quantKey(va.x, va.y, va.z));
    faceVertKeys.add(quantKey(vb.x, vb.y, vb.z));
    faceVertKeys.add(quantKey(vc.x, vc.y, vc.z));
  }
  if (matchedTris === 0) {
    throw new Error('Offset Face: the selected planar face was not found on the current body (it may have been consumed by a later feature, or it is not planar)');
  }

  // Translate every vertex sharing a face-vertex position (this is what drags
  // the duplicated boundary vertices of the adjacent walls along).
  const out = geometry.clone();
  const outPos = out.getAttribute('position') as THREE.BufferAttribute;
  const dx = n[0] * distance;
  const dy = n[1] * distance;
  const dz = n[2] * distance;
  for (let i = 0; i < outPos.count; i++) {
    const x = outPos.getX(i);
    const y = outPos.getY(i);
    const z = outPos.getZ(i);
    if (faceVertKeys.has(quantKey(x, y, z))) {
      outPos.setXYZ(i, x + dx, y + dy, z + dz);
    }
  }
  outPos.needsUpdate = true;
  out.computeVertexNormals();
  return out;
}

export const offsetFaceFeature: FeatureDefinition = {
  type: 'offsetFace',
  icon: '↕️',
  params: [
    // Planar faces only; prism (push/pull) semantics — see module docblock.
    { key: 'distance', labelKey: 'paramOffsetFaceDistance', default: 1, min: -100, max: 100, step: 0.5, unit: 'mm' },
  ],
  apply(geometry, params, ctx) {
    const sel = ctx?.faceSelections?.[0];
    if (!sel) {
      throw new Error('Offset Face: no face selected — pick a planar face, then add the feature.');
    }
    return noteMeshFallback(
      applyOffsetFaceMesh(geometry, sel, params.distance ?? 0),
      { op: 'Offset Face', featureId: ctx?.featureId },
    );
  },
  async applyAsync(geometry, params, ctx) {
    const sel = ctx?.faceSelections?.[0];
    if (!sel) {
      throw new Error('Offset Face: no face selected — pick a planar face, then add the feature.');
    }
    const distance = params.distance ?? 0;
    if (isOcctReady()) {
      try {
        let handle = (geometry.userData?.occtHandle as string | undefined) ?? null;
        if (!handle) handle = await meshToSimplifiedBrepHandle(geometry);
        if (handle) {
          const result = occtOffsetFace(handle, { position: sel.position, normal: sel.normal }, distance);
          if (result.handle) {
            result.geometry.userData.occtHandle = result.handle;
            return result.geometry;
          }
        }
      } catch (err) {
        console.warn('[offsetFace] OCCT path failed, falling back to planar mesh offset:', err);
      }
    }
    // Mesh fallback — sound for planar faces (see module docblock); stamped as
    // an approximation when the user wanted B-rep.
    return noteMeshFallback(
      applyOffsetFaceMesh(geometry, sel, distance),
      { op: 'Offset Face', featureId: ctx?.featureId },
    );
  },
};
