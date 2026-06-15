/**
 * reliefCuts.ts — Sheet-metal Bend Relief + Corner Relief geometry ops
 * (mesh mode, three-bvh-csg SUBTRACTION).
 *
 * Bend relief: a press-brake bend that does not span the full sheet
 * width tears the material at the two ends of the bend line. The fix is
 * a small notch cut at each end, sized per ASM Handbook Vol. 14B:
 *   relief width  ≥ T (thickness)
 *   relief depth  ≥ T + R (thickness + inner bend radius)
 * This module cuts a pair of notches (rectangular or obround) at the
 * two ends of a bend line located at `position` (0–1 along the primary
 * axis — same convention as applyBend, so the user lines the relief up
 * with the bend feature that follows it in the stack).
 *
 * Corner relief: where two bends meet at a sheet corner the material is
 * stretched in both directions simultaneously and cracks. The relief is
 * a circular or square cutout centered at the corner (optionally inset
 * inward), removing the doubly-stressed material before bending. Sizing
 * suggestions live in cornerRelief.ts (detectCornerReliefNeeds); this
 * module is the geometric cut that those suggestions feed.
 *
 * Both ops are MESH-ONLY (no OCCT path yet — same status as the rest of
 * the sheet-metal family). When the user's engine intent is B-rep, the
 * result is stamped with an `approximated` downgrade notice via
 * noteMeshFallback so the precision downgrade is never silent.
 */

import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import type { FeatureDefinition } from './types';
import { noteMeshFallback } from './downgradeNotice';
import { stampFaceFeatureIdAll, configureEvaluatorForProvenance, propagateFeatureIdMap } from './faceProvenance';

export type BendReliefShape = 'rectangular' | 'obround';
export type CornerReliefShape = 'circular' | 'square';

export interface BendReliefParams {
  /** Notch width along the primary (bend-position) axis, mm. ≥ T. */
  width: number;
  /** Notch depth inward from each side edge, along the bend line, mm. ≥ T + R. */
  depth: number;
  /** 0–1 fraction along the primary axis where the bend line sits. */
  position: number;
  /** rectangular = square-root notch; obround = round inner end (lower stress). */
  shape: BendReliefShape;
}

export interface CornerReliefParams {
  /** Which sheet corner: 0=(+X,+Z) 1=(+X,-Z) 2=(-X,+Z) 3=(-X,-Z). */
  corner: number;
  /** circular = round punch (low stress riser); square = simple shear cut. */
  shape: CornerReliefShape;
  /** Cut diameter (circular) or side length (square), mm. */
  size: number;
  /** Distance the cut center moves inward from the corner along BOTH axes, mm. */
  inset: number;
}

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

/** Restrict the evaluator's interpolated attributes to those present on
 *  BOTH operands (plus provenance when stamped) — keeps the CSG working
 *  when the base mesh has no uv channel (sketch-extrude / prior CSG). */
function configureEvaluatorAttributes(
  evaluator: Evaluator,
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): void {
  evaluator.attributes = ['position', 'normal', 'uv'].filter(
    k => a.getAttribute(k) && b.getAttribute(k),
  );
  configureEvaluatorForProvenance(evaluator, a, b);
}

/** Subtract `tool` from `base`, carrying face provenance through. */
function csgSubtract(
  base: THREE.BufferGeometry,
  tool: THREE.BufferGeometry,
  featureId?: string,
): THREE.BufferGeometry {
  if (featureId) {
    stampFaceFeatureIdAll(tool, featureId, { avoidIdsFrom: base });
  }
  const evaluator = new Evaluator();
  configureEvaluatorAttributes(evaluator, base, tool);
  const result = evaluator.evaluate(makeBrush(base), makeBrush(tool), SUBTRACTION);
  propagateFeatureIdMap(result.geometry, base, tool);
  if (!result.geometry.attributes.position || result.geometry.attributes.position.count === 0) {
    throw new Error('Relief cut removes all material — reduce its size');
  }
  return result.geometry;
}

/** Build one bend-relief notch tool (axis-aligned) as SEPARATE manifold
 *  solids (box body + optional obround end cylinder) — they overlap, so
 *  merging them into one brush would self-intersect and confuse the CSG
 *  classifier; the caller subtracts them sequentially instead.
 *  `alongX` = bend line runs along X (position axis is Z). `side` = -1
 *  (min edge) | +1 (max edge of the bend-line axis). Tools overshoot the
 *  sheet by `pad` on the open side + thickness axis so the boolean is
 *  clean. */
function buildNotchTools(
  bb: THREE.Box3,
  alongX: boolean,
  side: -1 | 1,
  bendLinePos: number,
  width: number,
  depth: number,
  shape: BendReliefShape,
): THREE.BufferGeometry[] {
  const pad = 1;
  const thickness = bb.max.y - bb.min.y;
  const cy = (bb.min.y + bb.max.y) / 2;
  const h = thickness + 2 * pad;
  const r = width / 2;

  // Coordinates along the bend-line axis (where the notch cuts inward
  // from the sheet's side edge).
  const edge = alongX
    ? (side === 1 ? bb.max.x : bb.min.x)
    : (side === 1 ? bb.max.z : bb.min.z);

  const parts: THREE.BufferGeometry[] = [];
  // Rectangular body: spans [edge − side·boxDepth … edge + side·pad].
  // For obround, the box stops r short of full depth; a cylinder caps it.
  const boxDepth = shape === 'obround' ? Math.max(depth - r, 0) : depth;
  if (boxDepth > 0) {
    // Box spans from (edge + side·pad) outside to (edge − side·boxDepth) inside.
    const len = boxDepth + pad;
    const cAlong = edge + (side * pad - side * boxDepth) / 2;
    const box = new THREE.BoxGeometry(
      alongX ? len : width,
      h,
      alongX ? width : len,
    );
    box.translate(
      alongX ? cAlong : bendLinePos,
      cy,
      alongX ? bendLinePos : cAlong,
    );
    parts.push(box);
  }
  if (shape === 'obround') {
    // Round inner end: cylinder (Y axis) centered at the inner end of the box.
    const cyl = new THREE.CylinderGeometry(r, r, h, 32);
    const cAlong = edge - side * Math.max(depth - r, 0);
    cyl.translate(
      alongX ? cAlong : bendLinePos,
      cy,
      alongX ? bendLinePos : cAlong,
    );
    parts.push(cyl);
  }
  return parts;
}

/**
 * Cut a pair of relief notches at both ends of the bend line at
 * `position`. Primary-axis selection matches applyBend (the position
 * fraction runs along the LONGEST horizontal axis; the bend line runs
 * along the other one), so a bendRelief at position p lines up with a
 * bend at the same p added after it.
 */
export function applyBendRelief(
  geometry: THREE.BufferGeometry,
  params: BendReliefParams,
  featureId?: string,
): THREE.BufferGeometry {
  const { width, depth, position, shape } = params;
  if (width <= 0) throw new Error('Bend relief width must be greater than 0');
  if (depth <= 0) throw new Error('Bend relief depth must be greater than 0');

  const geo = geometry.clone();
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const thickness = bb.max.y - bb.min.y;
  if (thickness <= 0) throw new Error('Bend relief requires a sheet body with positive thickness');

  const sizeX = bb.max.x - bb.min.x;
  const sizeZ = bb.max.z - bb.min.z;
  // applyBend: bend line parallel to X when Z is the longest axis.
  const bendAlongX = sizeZ >= sizeX;
  const primarySize = bendAlongX ? sizeZ : sizeX;
  const primaryMin = bendAlongX ? bb.min.z : bb.min.x;
  const bendLinePos = primaryMin + primarySize * Math.max(0, Math.min(1, position));

  let result: THREE.BufferGeometry = geo;
  for (const side of [-1, 1] as const) {
    for (const tool of buildNotchTools(bb, bendAlongX, side, bendLinePos, width, depth, shape)) {
      result = csgSubtract(result, tool, featureId);
    }
  }
  result.computeVertexNormals();
  result.computeBoundingBox();
  // Carry the bend history forward — a relief cut doesn't add a bend.
  // (Source userData first so the CSG result's provenance map wins.)
  result.userData = { ...(geometry.userData ?? {}), ...(result.userData ?? {}) };
  return result;
}

/**
 * Cut a corner relief (circular or square) at one of the four sheet
 * corners. With inset = 0 the cut is centered exactly on the corner —
 * removing a quarter-circle / quarter-square of material, which is the
 * canonical relief for two edge flanges meeting at that corner (their
 * bend lines intersect at the corner in the flat).
 */
export function applyCornerRelief(
  geometry: THREE.BufferGeometry,
  params: CornerReliefParams,
  featureId?: string,
): THREE.BufferGeometry {
  const { corner, shape, size, inset } = params;
  if (size <= 0) throw new Error('Corner relief size must be greater than 0');
  if (corner < 0 || corner > 3) throw new Error(`Invalid corner index: ${corner}`);

  const geo = geometry.clone();
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const thickness = bb.max.y - bb.min.y;
  if (thickness <= 0) throw new Error('Corner relief requires a sheet body with positive thickness');

  const signX = corner === 0 || corner === 1 ? 1 : -1;
  const signZ = corner === 0 || corner === 2 ? 1 : -1;
  const cornerX = signX === 1 ? bb.max.x : bb.min.x;
  const cornerZ = signZ === 1 ? bb.max.z : bb.min.z;
  const cx = cornerX - signX * inset;
  const cz = cornerZ - signZ * inset;

  const pad = 1;
  const h = thickness + 2 * pad;
  const cy = (bb.min.y + bb.max.y) / 2;
  const tool =
    shape === 'circular'
      ? new THREE.CylinderGeometry(size / 2, size / 2, h, 32)
      : new THREE.BoxGeometry(size, h, size);
  tool.translate(cx, cy, cz);

  const result = csgSubtract(geo, tool, featureId);
  result.computeVertexNormals();
  result.computeBoundingBox();
  result.userData = { ...(geometry.userData ?? {}), ...(result.userData ?? {}) };
  return result;
}

// ─── Feature Definitions ───────────────────────────────────────────────────────

export const bendReliefFeature: FeatureDefinition = {
  type: 'bendRelief',
  icon: '⊓',
  params: [
    { key: 'width', labelKey: 'paramReliefWidth', default: 3, min: 0.5, max: 50, step: 0.5, unit: 'mm' },
    { key: 'depth', labelKey: 'paramReliefDepth', default: 5, min: 0.5, max: 100, step: 0.5, unit: 'mm' },
    { key: 'position', labelKey: 'paramBendPosition', default: 50, min: 1, max: 99, step: 1, unit: '%' },
    {
      key: 'shape', labelKey: 'paramReliefShape', default: 0, min: 0, max: 1, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'featureOpt_reliefRect' },
        { value: 1, labelKey: 'featureOpt_reliefObround' },
      ],
    },
  ],
  apply(geometry, params, ctx) {
    const out = applyBendRelief(
      geometry,
      {
        width: params.width,
        depth: params.depth,
        position: (params.position ?? 50) / 100,
        shape: Math.round(params.shape ?? 0) === 1 ? 'obround' : 'rectangular',
      },
      ctx?.featureId,
    );
    return noteMeshFallback(out, { op: 'Bend Relief', featureId: ctx?.featureId });
  },
};

export const cornerReliefFeature: FeatureDefinition = {
  type: 'cornerRelief',
  icon: '◔',
  params: [
    {
      key: 'corner', labelKey: 'paramCornerIndex', default: 0, min: 0, max: 3, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'featureOpt_cornerPXPZ' },
        { value: 1, labelKey: 'featureOpt_cornerPXMZ' },
        { value: 2, labelKey: 'featureOpt_cornerMXPZ' },
        { value: 3, labelKey: 'featureOpt_cornerMXMZ' },
      ],
    },
    {
      key: 'shape', labelKey: 'paramReliefShape', default: 0, min: 0, max: 1, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'featureOpt_reliefCircular' },
        { value: 1, labelKey: 'featureOpt_reliefSquare' },
      ],
    },
    { key: 'size', labelKey: 'paramReliefSize', default: 4, min: 0.5, max: 50, step: 0.5, unit: 'mm' },
    { key: 'inset', labelKey: 'paramCornerInset', default: 0, min: 0, max: 50, step: 0.5, unit: 'mm' },
  ],
  apply(geometry, params, ctx) {
    const out = applyCornerRelief(
      geometry,
      {
        corner: Math.round(params.corner ?? 0),
        shape: Math.round(params.shape ?? 0) === 1 ? 'square' : 'circular',
        size: params.size,
        inset: params.inset ?? 0,
      },
      ctx?.featureId,
    );
    return noteMeshFallback(out, { op: 'Corner Relief', featureId: ctx?.featureId });
  },
};
