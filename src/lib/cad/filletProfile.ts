/**
 * filletProfile — Phase 2.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Fillet rounds selected edges of an existing solid body with a constant
 * radius. Mirror of shellProfile.ts: the IR wraps a child ExtrudeFeature
 * and serializes to OpenSCAD source that reproduces the rounded body via
 * a minkowski sum trick (the only kernel-free strategy that works in the
 * vanilla OpenSCAD pipeline NexyFab currently runs against).
 *
 * Implementation strategy (Phase 1 minimal):
 *   - Wrap an existing ExtrudeFeature as the child body.
 *   - SCAD approach: minkowski() of an inset cube with a sphere (or
 *     cylinder, for "vertical"-only edges) of `radius`. Vanilla
 *     OpenSCAD does not expose any face- or edge-level rounding
 *     primitive; BOSL2 provides `edge_round()` but pulls in 4 MB of
 *     library code and depends on a non-standard `include <>` chain
 *     we don't want in the Phase 1 server-side SCAD pipeline. The
 *     minkowski trick reproduces a uniform fillet exactly for
 *     axis-aligned boxes:
 *
 *       all-edge fillet:        minkowski() { cube(box - 2r); sphere(r); }
 *       vertical-edge only:     minkowski() { cube(box - 2r·xy); cylinder(r, h); }
 *       top-edge only:          minkowski() { extruded floor slab; half-sphere }
 *     For top/bottom/vertical we emit a difference-then-union pattern
 *     described inline at filletToScad. This is correct for the rect
 *     extrudes Phase 1 supports; arbitrary planar profiles require the
 *     OCCT pipeline (Phase 2.x).
 *
 *   - Profile must be an axis-aligned rectangle; the pipeline rejects
 *     other profiles upstream.
 *
 * Phase 1 limitations (documented for the UI to surface):
 *   - Rect-extrude profiles only (4 axis-aligned corners).
 *   - Uniform radius only (no variable-radius / hold-line fillets).
 *   - Child must be a single ExtrudeFeature; revolves/sweeps/lofts/
 *     patterns are out of scope until Phase 2.x OCCT fillet lands.
 *   - Edge selection limited to four enums: all, top, bottom, vertical
 *     (top-and-bottom-only) — there is no per-edge picking yet.
 *
 * Out of scope (Phase 2+):
 *   - General edge selection (pick individual edges by id).
 *   - Variable radius / spline curvature.
 *   - Face blends, full-round, three-tangent.
 *   - Fillet of a body produced by revolve/sweep/loft/pattern.
 */

import type { ExtrudeFeature } from './extrudeProfile';
import { isAxisAlignedRect } from './shellProfile';

// ─── IR ───────────────────────────────────────────────────────────────────

/**
 * Which edges of the child body to round.
 *   - 'all': every edge of the box (all 12 edges = 4 top + 4 bottom + 4 vertical).
 *   - 'top': the 4 edges of the top face only.
 *   - 'bottom': the 4 edges of the bottom face only.
 *   - 'vertical': the 4 vertical edges only (the "corner posts").
 */
export type FilletEdgeSelection = 'all' | 'top' | 'bottom' | 'vertical';

export interface FilletFeature {
  kind: 'fillet';
  /** The body to be filleted. Phase 1 supports ExtrudeFeature only. */
  childExtrude: ExtrudeFeature;
  /** Fillet radius (mm). Must be > 0 and < min(profileBBox)/2; for
   *  top/bottom edge selections also < depth/2. */
  radius: number;
  /** Which edges to round. See FilletEdgeSelection enum. */
  edgeSelection: FilletEdgeSelection;
}

export interface FilletOptions {
  radius: number;
  edgeSelection: FilletEdgeSelection;
}

const ALLOWED_EDGE_SELECTIONS: readonly FilletEdgeSelection[] = [
  'all',
  'top',
  'bottom',
  'vertical',
];

function loopBoundingBox(
  loop: ReadonlyArray<{ x: number; y: number }>,
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of loop) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

// ─── builder ──────────────────────────────────────────────────────────────

/**
 * Build a FilletFeature wrapping an ExtrudeFeature.
 *
 * Validation:
 *   - radius must be > 0 and finite
 *   - edgeSelection must be one of the allowed enum values
 *   - radius must be < min(profileWidth, profileHeight) / 2 — otherwise
 *     the inset cube collapses (radius bigger than the half-width)
 *   - radius must be < depth / 2 when edges include top/bottom — otherwise
 *     the rounded crown eats the entire body in the Z direction
 *   - Phase 1 only: child loop must be an axis-aligned rect
 */
export function buildFilletFeature(
  child: ExtrudeFeature,
  radius: number,
  edgeSelection: FilletEdgeSelection,
): FilletFeature {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error(`fillet radius must be a positive number, got: ${radius}`);
  }
  if (!ALLOWED_EDGE_SELECTIONS.includes(edgeSelection)) {
    throw new Error(
      `fillet edgeSelection must be one of ${ALLOWED_EDGE_SELECTIONS.join('|')}, got: ${edgeSelection}`,
    );
  }
  if (!isAxisAlignedRect(child.loop)) {
    throw new Error(
      'fillet Phase 1: child extrude profile must be an axis-aligned rectangle',
    );
  }
  const bb = loopBoundingBox(child.loop);
  const w = bb.maxX - bb.minX;
  const h = bb.maxY - bb.minY;
  const minDim = Math.min(w, h);
  if (radius >= minDim / 2) {
    throw new Error(
      `fillet radius ${radius} must be < min(profile bbox)/2 = ${minDim / 2}`,
    );
  }
  const touchesTopOrBottom =
    edgeSelection === 'all' || edgeSelection === 'top' || edgeSelection === 'bottom';
  if (touchesTopOrBottom && radius >= child.depth / 2) {
    throw new Error(
      `fillet radius ${radius} must be < depth/2 = ${child.depth / 2} when filleting top/bottom edges`,
    );
  }
  return {
    kind: 'fillet',
    childExtrude: child,
    radius,
    edgeSelection,
  };
}

// ─── SCAD serializer ──────────────────────────────────────────────────────

function formatNum(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`fillet: non-finite number ${n}`);
  return Math.abs(n) < 1e-10 ? '0' : Number(n.toFixed(4)).toString();
}

/**
 * Convert a FilletFeature to OpenSCAD source. The output is deterministic:
 * same input always yields the same string (suitable for cache keys).
 *
 * Approach per edge selection (rect extrude only — Phase 1):
 *
 *   'all':
 *     minkowski() {
 *       translate([minX+r, minY+r, r]) cube([w-2r, h-2r, depth-2r]);
 *       sphere(r=r, $fn=32);
 *     }
 *     The sphere rounds every face/edge/corner uniformly; the inset cube
 *     compensates so the outer bbox matches the unfilleted body exactly.
 *
 *   'vertical':
 *     minkowski() {
 *       translate([minX+r, minY+r, 0]) cube([w-2r, h-2r, depth]);
 *       cylinder(r=r, h=epsilon, $fn=32);   // h=eps keeps Z unchanged
 *     }
 *     The cylinder swept over the inset cube rounds the 4 vertical edges
 *     and the 8 vertical-to-top/bottom corners, leaving top/bottom faces
 *     flat. (We use a near-zero-height cylinder so the minkowski doesn't
 *     extend the Z bounds.)
 *
 *   'top':
 *     union() {
 *       // bottom slab (un-rounded portion below z=depth-r)
 *       translate([minX, minY, 0]) cube([w, h, depth-r]);
 *       // top crown rounded only above z=depth-r
 *       minkowski() {
 *         translate([minX+r, minY+r, depth-r]) cube([w-2r, h-2r, epsilon]);
 *         sphere(r=r, $fn=32);
 *       }
 *     }
 *     The bottom slab keeps the lower portion flat; the minkowski'd crown
 *     rounds the top face plus the 4 top edges and 4 top corners.
 *     The slab's top z=depth-r meets the crown's lower bound exactly
 *     because the minkowski extends down by r from the eps-thick slab.
 *
 *   'bottom': mirror of 'top' (crown at z=0, slab on top).
 */
export function filletToScad(feature: FilletFeature): string {
  const r = feature.radius;
  const bb = loopBoundingBox(feature.childExtrude.loop);
  const w = bb.maxX - bb.minX;
  const h = bb.maxY - bb.minY;
  const depth = feature.childExtrude.depth;
  const epsilon = 0.001; // sub-mm slab thickness used to seed the minkowski crown
  const header =
    `// NEXYFAB:FILLET radius=${formatNum(r)} edges=${feature.edgeSelection}`;

  if (feature.edgeSelection === 'all') {
    return (
      `${header}\n` +
      `minkowski() {\n` +
      `  translate([${formatNum(bb.minX + r)}, ${formatNum(bb.minY + r)}, ${formatNum(r)}])\n` +
      `    cube([${formatNum(w - 2 * r)}, ${formatNum(h - 2 * r)}, ${formatNum(depth - 2 * r)}]);\n` +
      `  sphere(r=${formatNum(r)}, $fn=32);\n` +
      `}`
    );
  }

  if (feature.edgeSelection === 'vertical') {
    return (
      `${header}\n` +
      `minkowski() {\n` +
      `  translate([${formatNum(bb.minX + r)}, ${formatNum(bb.minY + r)}, 0])\n` +
      `    cube([${formatNum(w - 2 * r)}, ${formatNum(h - 2 * r)}, ${formatNum(depth)}]);\n` +
      `  cylinder(r=${formatNum(r)}, h=${formatNum(epsilon)}, $fn=32);\n` +
      `}`
    );
  }

  // top / bottom: slab + crown union
  if (feature.edgeSelection === 'top') {
    return (
      `${header}\n` +
      `union() {\n` +
      `  translate([${formatNum(bb.minX)}, ${formatNum(bb.minY)}, 0])\n` +
      `    cube([${formatNum(w)}, ${formatNum(h)}, ${formatNum(depth - r)}]);\n` +
      `  minkowski() {\n` +
      `    translate([${formatNum(bb.minX + r)}, ${formatNum(bb.minY + r)}, ${formatNum(depth - r)}])\n` +
      `      cube([${formatNum(w - 2 * r)}, ${formatNum(h - 2 * r)}, ${formatNum(epsilon)}]);\n` +
      `    sphere(r=${formatNum(r)}, $fn=32);\n` +
      `  }\n` +
      `}`
    );
  }

  // 'bottom'
  return (
    `${header}\n` +
    `union() {\n` +
    `  translate([${formatNum(bb.minX)}, ${formatNum(bb.minY)}, ${formatNum(r)}])\n` +
    `    cube([${formatNum(w)}, ${formatNum(h)}, ${formatNum(depth - r)}]);\n` +
    `  minkowski() {\n` +
    `    translate([${formatNum(bb.minX + r)}, ${formatNum(bb.minY + r)}, ${formatNum(r)}])\n` +
    `      cube([${formatNum(w - 2 * r)}, ${formatNum(h - 2 * r)}, ${formatNum(epsilon)}]);\n` +
    `    sphere(r=${formatNum(r)}, $fn=32);\n` +
    `  }\n` +
    `}`
  );
}
