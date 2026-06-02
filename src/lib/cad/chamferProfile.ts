/**
 * chamferProfile — Phase 2.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Chamfer bevels selected edges of an existing solid body by a uniform
 * setback distance (the orthogonal distance the bevel cuts from the
 * original edge). Mirror of filletProfile.ts; differs only in that the
 * minkowski seed shape is a regular tetrahedron / cone-ish primitive
 * instead of a sphere/cylinder.
 *
 * Implementation strategy (Phase 1 minimal):
 *   - Wrap an existing ExtrudeFeature as the child body.
 *   - SCAD approach: vanilla OpenSCAD has no edge_chamfer primitive.
 *     The simplest deterministic chamfer is to minkowski an inset cube
 *     with a small octahedron (8-vertex bipyramid) for 'all', or with
 *     a regular 4-sided pyramid for top/bottom-only / a square prism
 *     rotated 45° (i.e. a thin "diamond" cylinder via $fn=4) for vertical.
 *
 *     We emit:
 *       all-edge chamfer:   minkowski() { cube(box - 2d); octahedron(d); }
 *       vertical-edge:      minkowski() { cube(box - 2d xy); cylinder($fn=4, r=d√2/2, h=eps); }
 *                           (a $fn=4 cylinder is a 45°-rotated square prism;
 *                            its half-diagonal = d, so the chamfer setback
 *                            from the original edge is exactly d.)
 *       top/bottom-edge:    slab + (inset cube minkowski'd with a half-octahedron)
 *
 *     A regular octahedron is built as the convex hull of (±d,0,0), (0,±d,0),
 *     (0,0,±d). We use OpenSCAD's polyhedron() primitive for this — no
 *     external lib required. Document: this gives a flat-faced chamfer
 *     (8 triangular bevel facets) which matches CAD-standard mechanical
 *     drawings ("X mm × 45°" is the most common chamfer callout).
 *
 *   - Profile must be an axis-aligned rectangle; the pipeline rejects
 *     other profiles upstream.
 *
 * Phase 1 limitations (documented for the UI to surface):
 *   - Rect-extrude profiles only (4 axis-aligned corners).
 *   - Uniform 45° chamfer only (no asymmetric distance / angle).
 *   - Child must be a single ExtrudeFeature; revolves/sweeps/lofts/
 *     patterns are out of scope until Phase 2.x OCCT chamfer lands.
 *   - Edge selection limited to four enums: all, top, bottom, vertical.
 *
 * Out of scope (Phase 2+):
 *   - General edge selection (pick individual edges by id).
 *   - Asymmetric chamfer (distance1 ≠ distance2 / angle ≠ 45°).
 *   - Chamfer of a body produced by revolve/sweep/loft/pattern.
 */

import type { ExtrudeFeature } from './extrudeProfile';
import { isAxisAlignedRect } from './shellProfile';

// ─── IR ───────────────────────────────────────────────────────────────────

/**
 * Which edges of the child body to bevel. See filletProfile.FilletEdgeSelection
 * for the geometric meaning of each value — identical here.
 */
export type ChamferEdgeSelection = 'all' | 'top' | 'bottom' | 'vertical';

export interface ChamferFeature {
  kind: 'chamfer';
  /** The body to be chamfered. Phase 1 supports ExtrudeFeature only. */
  childExtrude: ExtrudeFeature;
  /** Chamfer setback distance (mm) — the orthogonal distance the bevel
   *  cuts from the original edge. Must be > 0 and < min(profileBBox)/2;
   *  for top/bottom edge selections also < depth/2. */
  distance: number;
  /** Which edges to bevel. See ChamferEdgeSelection enum. */
  edgeSelection: ChamferEdgeSelection;
}

export interface ChamferOptions {
  distance: number;
  edgeSelection: ChamferEdgeSelection;
}

const ALLOWED_EDGE_SELECTIONS: readonly ChamferEdgeSelection[] = [
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
 * Build a ChamferFeature wrapping an ExtrudeFeature.
 *
 * Validation:
 *   - distance must be > 0 and finite
 *   - edgeSelection must be one of the allowed enum values
 *   - distance must be < min(profileWidth, profileHeight) / 2
 *   - distance must be < depth / 2 when edges include top/bottom
 *   - Phase 1 only: child loop must be an axis-aligned rect
 */
export function buildChamferFeature(
  child: ExtrudeFeature,
  distance: number,
  edgeSelection: ChamferEdgeSelection,
): ChamferFeature {
  if (!Number.isFinite(distance) || distance <= 0) {
    throw new Error(`chamfer distance must be a positive number, got: ${distance}`);
  }
  if (!ALLOWED_EDGE_SELECTIONS.includes(edgeSelection)) {
    throw new Error(
      `chamfer edgeSelection must be one of ${ALLOWED_EDGE_SELECTIONS.join('|')}, got: ${edgeSelection}`,
    );
  }
  if (!isAxisAlignedRect(child.loop)) {
    throw new Error(
      'chamfer Phase 1: child extrude profile must be an axis-aligned rectangle',
    );
  }
  const bb = loopBoundingBox(child.loop);
  const w = bb.maxX - bb.minX;
  const h = bb.maxY - bb.minY;
  const minDim = Math.min(w, h);
  if (distance >= minDim / 2) {
    throw new Error(
      `chamfer distance ${distance} must be < min(profile bbox)/2 = ${minDim / 2}`,
    );
  }
  const touchesTopOrBottom =
    edgeSelection === 'all' || edgeSelection === 'top' || edgeSelection === 'bottom';
  if (touchesTopOrBottom && distance >= child.depth / 2) {
    throw new Error(
      `chamfer distance ${distance} must be < depth/2 = ${child.depth / 2} when chamfering top/bottom edges`,
    );
  }
  return {
    kind: 'chamfer',
    childExtrude: child,
    distance,
    edgeSelection,
  };
}

// ─── SCAD serializer ──────────────────────────────────────────────────────

function formatNum(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`chamfer: non-finite number ${n}`);
  return Math.abs(n) < 1e-10 ? '0' : Number(n.toFixed(4)).toString();
}

/**
 * Emit OpenSCAD source for a regular octahedron of "radius" d
 * (vertices at ±d on each axis). 6 vertices, 8 triangular faces.
 * Triangle winding follows the OpenSCAD right-hand convention so the
 * outward normal points away from the centroid.
 */
function octahedronScad(d: number): string {
  const v = formatNum(d);
  const neg = formatNum(-d);
  const verts =
    `[[${v},0,0],[${neg},0,0],[0,${v},0],[0,${neg},0],[0,0,${v}],[0,0,${neg}]]`;
  // 0=+x, 1=-x, 2=+y, 3=-y, 4=+z, 5=-z
  // Top half (apex 4): (0,2,4),(2,1,4),(1,3,4),(3,0,4)
  // Bot half (apex 5): (2,0,5),(1,2,5),(3,1,5),(0,3,5)
  const faces = `[[0,2,4],[2,1,4],[1,3,4],[3,0,4],[2,0,5],[1,2,5],[3,1,5],[0,3,5]]`;
  return `polyhedron(points=${verts}, faces=${faces});`;
}

/**
 * Convert a ChamferFeature to OpenSCAD source. Deterministic for identical
 * input (suitable for cache keys).
 *
 * Approach per edge selection (rect extrude only — Phase 1):
 *
 *   'all':
 *     minkowski() {
 *       translate([minX+d, minY+d, d]) cube([w-2d, h-2d, depth-2d]);
 *       <octahedron of radius d>;
 *     }
 *     The octahedron rounds every edge with a 45° flat bevel; the inset
 *     cube compensates so the outer bbox matches the unfilleted body
 *     exactly.
 *
 *   'vertical':
 *     minkowski() {
 *       translate([minX+d, minY+d, 0]) cube([w-2d, h-2d, depth]);
 *       rotate([0,0,45]) cylinder(r=d*sqrt(2)/2, h=epsilon, $fn=4);
 *     }
 *     A $fn=4 cylinder is a square prism; rotated 45° so its diagonal aligns
 *     with the cube. The half-diagonal = d → 45° bevel of setback d on the
 *     4 vertical edges. (Near-zero height keeps Z unchanged.)
 *
 *   'top':
 *     union() {
 *       translate([minX, minY, 0]) cube([w, h, depth-d]);
 *       minkowski() {
 *         translate([minX+d, minY+d, depth-d]) cube([w-2d, h-2d, epsilon]);
 *         <octahedron of radius d>;
 *       }
 *     }
 *     Lower slab keeps the bottom portion flat; the minkowski'd crown
 *     bevels the top face's 4 edges + 4 corners.
 *
 *   'bottom': mirror of 'top'.
 */
export function chamferToScad(feature: ChamferFeature): string {
  const d = feature.distance;
  const bb = loopBoundingBox(feature.childExtrude.loop);
  const w = bb.maxX - bb.minX;
  const h = bb.maxY - bb.minY;
  const depth = feature.childExtrude.depth;
  const epsilon = 0.001;
  const halfDiag = (d * Math.SQRT2) / 2;
  const header =
    `// NEXYFAB:CHAMFER distance=${formatNum(d)} edges=${feature.edgeSelection}`;

  if (feature.edgeSelection === 'all') {
    return (
      `${header}\n` +
      `minkowski() {\n` +
      `  translate([${formatNum(bb.minX + d)}, ${formatNum(bb.minY + d)}, ${formatNum(d)}])\n` +
      `    cube([${formatNum(w - 2 * d)}, ${formatNum(h - 2 * d)}, ${formatNum(depth - 2 * d)}]);\n` +
      `  ${octahedronScad(d)}\n` +
      `}`
    );
  }

  if (feature.edgeSelection === 'vertical') {
    return (
      `${header}\n` +
      `minkowski() {\n` +
      `  translate([${formatNum(bb.minX + d)}, ${formatNum(bb.minY + d)}, 0])\n` +
      `    cube([${formatNum(w - 2 * d)}, ${formatNum(h - 2 * d)}, ${formatNum(depth)}]);\n` +
      `  rotate([0, 0, 45]) cylinder(r=${formatNum(halfDiag)}, h=${formatNum(epsilon)}, $fn=4);\n` +
      `}`
    );
  }

  if (feature.edgeSelection === 'top') {
    return (
      `${header}\n` +
      `union() {\n` +
      `  translate([${formatNum(bb.minX)}, ${formatNum(bb.minY)}, 0])\n` +
      `    cube([${formatNum(w)}, ${formatNum(h)}, ${formatNum(depth - d)}]);\n` +
      `  minkowski() {\n` +
      `    translate([${formatNum(bb.minX + d)}, ${formatNum(bb.minY + d)}, ${formatNum(depth - d)}])\n` +
      `      cube([${formatNum(w - 2 * d)}, ${formatNum(h - 2 * d)}, ${formatNum(epsilon)}]);\n` +
      `    ${octahedronScad(d)}\n` +
      `  }\n` +
      `}`
    );
  }

  // 'bottom'
  return (
    `${header}\n` +
    `union() {\n` +
    `  translate([${formatNum(bb.minX)}, ${formatNum(bb.minY)}, ${formatNum(d)}])\n` +
    `    cube([${formatNum(w)}, ${formatNum(h)}, ${formatNum(depth - d)}]);\n` +
    `  minkowski() {\n` +
    `    translate([${formatNum(bb.minX + d)}, ${formatNum(bb.minY + d)}, ${formatNum(d)}])\n` +
    `      cube([${formatNum(w - 2 * d)}, ${formatNum(h - 2 * d)}, ${formatNum(epsilon)}]);\n` +
    `    ${octahedronScad(d)}\n` +
    `  }\n` +
    `}`
  );
}
