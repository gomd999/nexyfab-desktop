/**
 * tab.ts — Sheet-metal Tab feature (OCCT B-rep primary, mesh fallback).
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
 * OCCT mode fuses an exact rectangular B-rep tool to the registered host.
 * Mesh mode keeps the established merged-triangle implementation. If the
 * exact path is unavailable, the fallback is stamped as `approximated`.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition } from './types';
import { noteMeshFallback } from './downgradeNotice';
// Shared attribute/index unification (formerly a tab-local helper — now the
// common layer every merge-based feature uses; see meshMerge.ts).
import { alignForMerge } from './meshMerge';
import {
  hostBoxFromGeometry,
  occtBoxBooleanWithPrimitive,
  resolveBrepHostHandleAsync,
  type OcctBooleanResult,
} from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';

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

export interface TabOcctHostBox {
  w: number;
  h: number;
  d: number;
  cx: number;
  cy: number;
  cz: number;
}

/** Exact rectangular in-plane tab, fused to the current registered B-Rep. */
export function applyTabOcct(
  hostHandle: string | null | undefined,
  hostBox: TabOcctHostBox,
  params: TabParams,
  tessellation: { tolerance?: number; angularTolerance?: number } = {},
): OcctBooleanResult {
  const { width, length, position, edgeIndex } = params;
  if (!(width > 0) || !(length > 0) || !(hostBox.h > 0)) {
    throw new Error('Exact Tab requires positive width, length, and sheet thickness');
  }
  const edgeLen = edgeIndex <= 1 ? hostBox.w : hostBox.d;
  if (![0, 1, 2, 3].includes(edgeIndex)) throw new Error(`Invalid edgeIndex: ${edgeIndex}`);
  const tabWidth = Math.min(width, edgeLen);
  const half = tabWidth / 2;
  const fraction = Math.max(0, Math.min(1, position));
  const along = Math.max(-edgeLen / 2 + half, Math.min(edgeLen / 2 - half, (fraction - 0.5) * edgeLen));
  const overlap = Math.min(0.05, length * 0.1);
  const outwardCenter = (length - overlap) / 2;
  let toolW = tabWidth;
  let toolD = length + overlap;
  let cx = hostBox.cx + along;
  let cz = hostBox.cz;
  if (edgeIndex === 0) cz = hostBox.cz + hostBox.d / 2 + outwardCenter;
  else if (edgeIndex === 1) cz = hostBox.cz - hostBox.d / 2 - outwardCenter;
  else {
    toolW = length + overlap;
    toolD = tabWidth;
    cx = hostBox.cx + (edgeIndex === 2 ? hostBox.w / 2 + outwardCenter : -hostBox.w / 2 - outwardCenter);
    cz = hostBox.cz + along;
  }
  return occtBoxBooleanWithPrimitive('union', hostBox, {
    shape: 'box',
    w: toolW,
    h: hostBox.h,
    d: toolD,
    cx,
    cy: hostBox.cy,
    cz,
    rx: 0,
    ry: 0,
    rz: 0,
  }, tessellation, hostHandle);
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
  async applyAsync(geometry, params, ctx) {
    const tabParams: TabParams = {
      width: params.width,
      length: params.length,
      position: (params.position ?? 50) / 100,
      edgeIndex: Math.round(params.edgeIndex ?? 0),
    };
    if (shouldUseOcctEngine()) {
      try {
        const hostBox = hostBoxFromGeometry(geometry);
        const hostHandle = await resolveBrepHostHandleAsync(geometry);
        const result = applyTabOcct(hostHandle, hostBox, tabParams);
        if (result.handle) {
          result.geometry.userData = { ...(geometry.userData ?? {}), occtHandle: result.handle };
          return result.geometry;
        }
      } catch (err) {
        console.warn('[tab] OCCT path failed, falling back to mesh:', err);
      }
    }
    return noteMeshFallback(applyTab(geometry, tabParams), { op: 'Tab', featureId: ctx?.featureId });
  },
};
