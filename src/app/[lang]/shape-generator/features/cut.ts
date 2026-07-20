/**
 * cut.ts — Sheet-metal Cut feature (mesh mode, three-bvh-csg SUBTRACTION).
 *
 * A Cut removes a rectangular slot from the sheet. The tool is a box sized
 * width(X) × length(Z), centred at (posX, posZ) in the sheet's frame; the
 * thickness axis is Y, matching applyTab/applyFlange/applyBendRelief.
 *
 * W5-D end conditions (judgment 260721: the param surface had NO depth at all —
 * every cut was a through-slot; removed=400.0 on a 100×2×50 plate regardless):
 *   - 'through_all' (default = legacy behavior): tool spans the full thickness
 *     plus a pad on both sides, so the cut is a clean through-feature.
 *   - 'blind': tool advances from the TOP face down by `depth` mm only.
 *   - 'up_to_face': depth is derived automatically as (topY − target plane Y),
 *     the target being an existing horizontal face supplied via the standard
 *     faceSelection convention. Face gone / tilted / above top → explicit
 *     rejection with the reason, never a silent guess.
 *
 * Reuses the careful provenance-preserving `csgSubtract` from reliefCuts so a
 * fresh (unstamped) base doesn't crash three-bvh-csg as feature #1.
 */
import * as THREE from 'three';
import type { FeatureDefinition } from './types';
import type { FaceSelectionInfo } from '../editing/selectionInfo';
import { noteMeshFallback } from './downgradeNotice';
import { csgSubtract } from './reliefCuts';
import { appendPatternSeed } from './patternHelpers/featureSeed';

export type CutEndCondition = 'blind' | 'through_all' | 'up_to_face';

/** Numeric enum used in FeatureInstance.params (params are numbers-only). */
export const CUT_END_CONDITION: readonly CutEndCondition[] = ['blind', 'through_all', 'up_to_face'];

export function endConditionFromEnum(n: number | undefined): CutEndCondition {
  const i = Math.round(Number.isFinite(n as number) ? (n as number) : 1);
  return CUT_END_CONDITION[Math.min(2, Math.max(0, i))]!;
}

export interface CutParams {
  /** Cut extent along X (mm). */
  width: number;
  /** Cut extent along Z (mm). */
  length: number;
  /** Cut centre X (mm, sheet frame). */
  posX: number;
  /** Cut centre Z (mm, sheet frame). */
  posZ: number;
  /** End condition — default 'through_all' (exact legacy behavior). */
  endCondition?: CutEndCondition;
  /** Blind depth from the top face (mm). Required finite > 0 for 'blind'. */
  depth?: number;
  /** Resolved target plane Y for 'up_to_face' (mm, world). The feature-def
   *  apply path resolves it from ctx.faceSelections via
   *  resolveUpToFacePlaneY; programmatic callers may pass it directly. */
  upToPlaneY?: number;
}

/** Existence check shared by cut/hole up_to_face: the target plane must still
 *  be present on the CURRENT body (≥3 vertices on the plane within tol) —
 *  otherwise the face the user picked was lost by an upstream edit and we
 *  refuse with the reason instead of cutting to a stale plane. */
export function assertPlaneOnBody(
  geometry: THREE.BufferGeometry,
  planeY: number,
  tol = 1e-3,
): void {
  const pos = geometry.attributes.position;
  let onPlane = 0;
  if (pos) {
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - planeY) <= tol) {
        onPlane++;
        if (onPlane >= 3) return;
      }
    }
  }
  throw new Error(
    `up_to_face rejected: no face found at y=${planeY} on the current body (tol ${tol}) — `
    + 'the selected face no longer exists (likely consumed by an upstream edit); re-select a face',
  );
}

/**
 * Resolve the 'up to face' stop plane from a standard face selection.
 * Throws with an explicit reason on every invalid case (no silent fallback):
 * missing selection, non-horizontal face, plane at/above the top face,
 * plane below the body, or plane no longer present on the body.
 */
export function resolveUpToFacePlaneY(
  geometry: THREE.BufferGeometry,
  faceSelections: FaceSelectionInfo[] | undefined,
): number {
  const sel = faceSelections?.[0];
  if (!sel) {
    throw new Error(
      "up_to_face rejected: no target face selected — pick the stop face (faceSelection), or use 'blind'/'through_all'",
    );
  }
  const [nx, ny, nz] = sel.normal;
  if (!(Math.abs(ny) > Math.abs(nx) && Math.abs(ny) > Math.abs(nz))) {
    throw new Error(
      `up_to_face rejected: target face normal [${nx.toFixed(3)}, ${ny.toFixed(3)}, ${nz.toFixed(3)}] `
      + 'is not a horizontal plane — the tool advances along −Y, so the stop face must face ±Y',
    );
  }
  const planeY = sel.position[1];
  if (!Number.isFinite(planeY)) {
    throw new Error('up_to_face rejected: face selection has a non-finite position');
  }
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  if (planeY >= bb.max.y - 1e-6) {
    throw new Error(
      `up_to_face rejected: target plane y=${planeY} is at/above the top face y=${bb.max.y} — derived depth would be ≤ 0`,
    );
  }
  if (planeY < bb.min.y - 1e-6) {
    throw new Error(
      `up_to_face rejected: target plane y=${planeY} lies below the body (bottom y=${bb.min.y})`,
    );
  }
  assertPlaneOnBody(geometry, planeY);
  return planeY;
}

/** Subtract a rectangular slot from the sheet at (posX, posZ) honoring the
 *  end condition (default through_all = legacy). */
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
  const topY = bb.max.y;
  const bottomY = bb.min.y;
  const ec = params.endCondition ?? 'through_all';

  // Tool Y-span per end condition. through_all overshoots BOTH faces by `pad`
  // (byte-identical to the legacy full-thickness tool); blind/up_to_face
  // overshoot only the entry (top) face and stop exactly at the target depth.
  let toolMinY: number;
  let toolMaxY: number;
  if (ec === 'blind') {
    const depth = params.depth;
    if (!Number.isFinite(depth) || (depth as number) <= 0) {
      throw new Error('Blind cut rejected: depth must be a positive number of mm (got ' + String(depth) + ')');
    }
    toolMinY = topY - (depth as number);
    toolMaxY = topY + pad;
  } else if (ec === 'up_to_face') {
    const planeY = params.upToPlaneY;
    if (!Number.isFinite(planeY)) {
      throw new Error(
        'up_to_face rejected: stop plane not resolved — the feature path resolves it from the face selection '
        + '(resolveUpToFacePlaneY); pass upToPlaneY when calling applyCut directly',
      );
    }
    if ((planeY as number) >= topY - 1e-6) {
      throw new Error(
        `up_to_face rejected: target plane y=${planeY} is at/above the top face y=${topY} — derived depth would be ≤ 0`,
      );
    }
    assertPlaneOnBody(geometry, planeY as number);
    toolMinY = planeY as number;
    toolMaxY = topY + pad;
  } else {
    toolMinY = bottomY - pad;
    toolMaxY = topY + pad;
  }

  const tool = new THREE.BoxGeometry(width, toolMaxY - toolMinY, length);
  tool.translate(params.posX, (toolMinY + toolMaxY) / 2, params.posZ);
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
    { key: 'endCondition', labelKey: 'paramEndCondition', default: 1, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'endConditionBlind' },
        { value: 1, labelKey: 'endConditionThroughAll' },
        { value: 2, labelKey: 'endConditionUpToFace' },
      ] },
    { key: 'depth', labelKey: 'paramHoleDepth', default: 5, min: 0.1, max: 500, step: 0.5, unit: 'mm' },
  ],
  apply(geometry, params, ctx) {
    const endCondition = endConditionFromEnum(params.endCondition);
    const upToPlaneY = endCondition === 'up_to_face'
      ? resolveUpToFacePlaneY(geometry, ctx?.faceSelections)
      : undefined;
    const cutParams: CutParams = {
      width: params.width ?? 20,
      length: params.length ?? 10,
      posX: params.posX ?? 0,
      posZ: params.posZ ?? 0,
      endCondition,
      depth: params.depth,
      ...(upToPlaneY != null ? { upToPlaneY } : {}),
    };
    const out = applyCut(geometry, cutParams, ctx?.featureId);
    // W5-D feature-unit pattern: log this cut's spec so a downstream pattern
    // in feature mode can re-apply the actual subtraction per instance.
    // up_to_face carries the RESOLVED plane so re-application needs no
    // face-selection object (the plane is re-checked against the body there).
    appendPatternSeed(out, geometry, {
      featureId: ctx?.featureId ?? null,
      type: 'cut',
      params: {
        width: cutParams.width,
        length: cutParams.length,
        posX: cutParams.posX,
        posZ: cutParams.posZ,
        endCondition: CUT_END_CONDITION.indexOf(endCondition),
        ...(Number.isFinite(params.depth) ? { depth: params.depth } : {}),
        ...(upToPlaneY != null ? { upToPlaneY } : {}),
      },
    });
    return noteMeshFallback(out, { op: 'Cut', featureId: ctx?.featureId });
  },
};
