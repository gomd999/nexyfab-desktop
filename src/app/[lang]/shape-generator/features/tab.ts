/**
 * tab.ts — Sheet-metal Tab feature (mesh mode).
 *
 * A tab is a rectangular IN-PLANE protrusion extending outward from a
 * selected edge of the sheet body — unlike a flange it is not bent: the
 * tab stays coplanar with the base sheet, taking its thickness from the
 * sheet itself. Tabs are the canonical mating half of a tab/slot pair
 * (see sheetMetalExtended.generateTabSlot for the DFM-side analysis);
 * this module is the geometry op that actually grows the blank.
 *
 * Edge model matches applyFlange/applyHem: edgeIndex 0=+Z, 1=-Z, 2=+X,
 * 3=-X on the sheet's bounding box, with Y as the thickness axis. The
 * tab is positioned by a 0–1 fraction along the selected edge (its
 * CENTER), clamped so the tab never overhangs the edge ends.
 *
 * Mesh-only: the result is a merged triangle mesh (same approach as
 * applyFlange). When the user's engine intent is B-rep (OCCT global
 * mode), the mesh fallback is stamped as an `approximated` downgrade
 * notice via noteMeshFallback — same honesty contract as shell/hole.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition } from './types';
import { noteMeshFallback } from './downgradeNotice';
// Shared attribute/index unification (formerly a tab-local helper — now the
// common layer every merge-based feature uses; see meshMerge.ts).
import { alignForMerge } from './meshMerge';

export interface TabParams {
  /** Tab width along the selected edge, mm. Clamped to the edge length. */
  width: number;
  /** Protrusion distance outward from the edge, mm. */
  length: number;
  /** 0–1 fraction along the edge where the tab CENTER sits. */
  position: number;
  /** Edge to attach to — same indexing as FlangeParams (0=+Z,1=-Z,2=+X,3=-X). */
  edgeIndex: number;
}

/**
 * Grow a rectangular tab out of the selected edge. The tab is a thin box
 * (width × sheetThickness × length) flush with the sheet's Y extent,
 * slightly overlapped into the base (0.05 mm) so the merged mesh has no
 * coplanar-crack rendering artifacts.
 */
export function applyTab(
  geometry: THREE.BufferGeometry,
  params: TabParams,
): THREE.BufferGeometry {
  const { width, length, position, edgeIndex } = params;
  if (width <= 0) throw new Error('Tab width must be greater than 0');
  if (length <= 0) throw new Error('Tab length must be greater than 0');

  const geo = geometry.clone();
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const sizeX = bb.max.x - bb.min.x;
  const sizeZ = bb.max.z - bb.min.z;
  const thickness = bb.max.y - bb.min.y;
  if (thickness <= 0) throw new Error('Tab requires a sheet body with positive thickness');

  // Edge frame: edgeDir runs along the edge, outDir points away from the sheet.
  let edgeLen: number;
  let edgeMid: THREE.Vector3;
  let edgeDir: THREE.Vector3;
  let outDir: THREE.Vector3;
  const cy = (bb.min.y + bb.max.y) / 2;
  switch (edgeIndex) {
    case 0: // +Z
      edgeLen = sizeX;
      edgeMid = new THREE.Vector3((bb.min.x + bb.max.x) / 2, cy, bb.max.z);
      edgeDir = new THREE.Vector3(1, 0, 0);
      outDir = new THREE.Vector3(0, 0, 1);
      break;
    case 1: // -Z
      edgeLen = sizeX;
      edgeMid = new THREE.Vector3((bb.min.x + bb.max.x) / 2, cy, bb.min.z);
      edgeDir = new THREE.Vector3(1, 0, 0);
      outDir = new THREE.Vector3(0, 0, -1);
      break;
    case 2: // +X
      edgeLen = sizeZ;
      edgeMid = new THREE.Vector3(bb.max.x, cy, (bb.min.z + bb.max.z) / 2);
      edgeDir = new THREE.Vector3(0, 0, 1);
      outDir = new THREE.Vector3(1, 0, 0);
      break;
    case 3: // -X
      edgeLen = sizeZ;
      edgeMid = new THREE.Vector3(bb.min.x, cy, (bb.min.z + bb.max.z) / 2);
      edgeDir = new THREE.Vector3(0, 0, 1);
      outDir = new THREE.Vector3(-1, 0, 0);
      break;
    default:
      throw new Error(`Invalid edgeIndex: ${edgeIndex}`);
  }

  // Clamp width to the edge, then clamp the center so the tab stays on it.
  const w = Math.min(width, edgeLen);
  const half = w / 2;
  const frac = Math.max(0, Math.min(1, position));
  const along = Math.max(
    -edgeLen / 2 + half,
    Math.min(edgeLen / 2 - half, (frac - 0.5) * edgeLen),
  );

  // Tiny inward overlap so the tab and base share volume, not just a plane.
  const overlap = Math.min(0.05, length * 0.1);
  const tabBox = new THREE.BoxGeometry(1, 1, 1);
  // Scale axes: edgeDir → w, Y → thickness, outDir → length + overlap.
  // Build in a canonical frame then position by vector math (axis-aligned
  // edges only, so no rotation matrix needed).
  const alongEdge = edgeDir.clone().multiplyScalar(along);
  const outward = outDir.clone().multiplyScalar((length + overlap) / 2 - overlap);
  const center = edgeMid.clone().add(alongEdge).add(outward);
  const sx = Math.abs(edgeDir.x) * w + Math.abs(outDir.x) * (length + overlap) || 1;
  const sz = Math.abs(edgeDir.z) * w + Math.abs(outDir.z) * (length + overlap) || 1;
  tabBox.scale(sx, thickness, sz);
  tabBox.translate(center.x, center.y, center.z);
  tabBox.computeVertexNormals();

  const [baseAligned, tabAligned] = alignForMerge(geo, tabBox);
  const merged = mergeGeometries([baseAligned, tabAligned]);
  if (!merged) throw new Error('Failed to merge tab geometry');
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  // Preserve the bend history (tab is flat — it extends the blank without
  // adding a bend, so the history rides through unchanged).
  merged.userData = { ...(geometry.userData ?? {}) };
  return merged;
}

export const tabFeature: FeatureDefinition = {
  type: 'tab',
  icon: '⎍',
  params: [
    { key: 'width', labelKey: 'paramTabWidth', default: 20, min: 1, max: 200, step: 1, unit: 'mm' },
    { key: 'length', labelKey: 'paramTabLength', default: 10, min: 1, max: 200, step: 1, unit: 'mm' },
    { key: 'position', labelKey: 'paramTabPosition', default: 50, min: 1, max: 99, step: 1, unit: '%' },
    {
      key: 'edgeIndex', labelKey: 'paramFlangeEdge', default: 0, min: 0, max: 3, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'featureOpt_edgePlusZ' },
        { value: 1, labelKey: 'featureOpt_edgeMinusZ' },
        { value: 2, labelKey: 'featureOpt_edgePlusX' },
        { value: 3, labelKey: 'featureOpt_edgeMinusX' },
      ],
    },
  ],
  apply(geometry, params, ctx) {
    const out = applyTab(geometry, {
      width: params.width,
      length: params.length,
      position: (params.position ?? 50) / 100,
      edgeIndex: Math.round(params.edgeIndex ?? 0),
    });
    return noteMeshFallback(out, { op: 'Tab', featureId: ctx?.featureId });
  },
};
