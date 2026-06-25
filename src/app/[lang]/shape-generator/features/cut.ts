/**
 * cut.ts — Sheet-metal Cut feature (mesh mode, three-bvh-csg SUBTRACTION).
 *
 * A Cut removes a rectangular through-slot from the sheet — the canonical
 * "punch a window / slot / cutout" operation. The tool is a box sized
 * width(X) × length(Z), spanning the FULL thickness (Y) plus a small pad so
 * the boolean is clean, centred at (posX, posZ) in the sheet's frame. The
 * thickness axis is Y, matching applyTab/applyFlange/applyBendRelief.
 *
 * Reuses the careful provenance-preserving `csgSubtract` from reliefCuts so a
 * fresh (unstamped) base doesn't crash three-bvh-csg as feature #1.
 */
import * as THREE from 'three';
import type { FeatureDefinition } from './types';
import { noteMeshFallback } from './downgradeNotice';
import { csgSubtract } from './reliefCuts';

export interface CutParams {
  /** Cut extent along X (mm). */
  width: number;
  /** Cut extent along Z (mm). */
  length: number;
  /** Cut centre X (mm, sheet frame). */
  posX: number;
  /** Cut centre Z (mm, sheet frame). */
  posZ: number;
}

/** Subtract a rectangular through-slot from the sheet at (posX, posZ). */
export function applyCut(
  geometry: THREE.BufferGeometry,
  params: CutParams,
  featureId?: string,
): THREE.BufferGeometry {
  const width = Math.max(0.1, params.width);
  const length = Math.max(0.1, params.length);
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox ?? new THREE.Box3().set(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, 1, 1),
  );
  const pad = 1;
  const thickness = bb.max.y - bb.min.y;
  const cy = (bb.min.y + bb.max.y) / 2;
  // Tool overshoots the sheet on the thickness axis so the cut is a clean
  // through-feature regardless of where the sheet sits on Y.
  const tool = new THREE.BoxGeometry(width, thickness + 2 * pad, length);
  tool.translate(params.posX, cy, params.posZ);
  return csgSubtract(geometry, tool, featureId);
}

export const cutFeature: FeatureDefinition = {
  type: 'cut',
  icon: '⬚',
  params: [
    { key: 'width', labelKey: 'paramTabWidth', default: 20, min: 0.5, max: 500, step: 1, unit: 'mm' },
    { key: 'length', labelKey: 'paramTabLength', default: 10, min: 0.5, max: 500, step: 1, unit: 'mm' },
    { key: 'posX', labelKey: 'paramHolePosX', default: 0, min: -500, max: 500, step: 1, unit: 'mm' },
    { key: 'posZ', labelKey: 'paramHolePosZ', default: 0, min: -500, max: 500, step: 1, unit: 'mm' },
  ],
  apply(geometry, params, ctx) {
    const out = applyCut(
      geometry,
      {
        width: params.width ?? 20,
        length: params.length ?? 10,
        posX: params.posX ?? 0,
        posZ: params.posZ ?? 0,
      },
      ctx?.featureId,
    );
    return noteMeshFallback(out, { op: 'Cut', featureId: ctx?.featureId });
  },
};
