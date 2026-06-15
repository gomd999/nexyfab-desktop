/**
 * chamferProfile — Phase 2.2 + Phase 3 of NexyFab Pro own-CAD (ADR-013).
 *
 * Chamfer bevels selected edges of an existing solid body by a setback
 * distance (the orthogonal distance the bevel cuts from the original edge).
 * Phases 1/2 use a uniform distance. Phase 3 adds variable-distance via
 * per-vertex (`vertexDistances`) or per-edge (`edgeDistances`) arrays —
 * see filletProfile.ts for the symmetric vertexRadii/edgeRadii pattern;
 * the chamfer fields use 'Distances' rather than 'Radii' to match the
 * existing scalar field name `distance`. Mirror of filletProfile.ts;
 * differs only in that the minkowski seed shape is a regular octahedron /
 * rotated square prism instead of a sphere/cylinder, and the Phase 3
 * hull primitives are octahedra rather than spheres.
 *
 * Implementation strategy:
 *   - Wrap an existing ExtrudeFeature as the child body.
 *   - SCAD approach: vanilla OpenSCAD has no edge_chamfer primitive.
 *     The simplest deterministic chamfer is to minkowski an inset cube
 *     (rect path) or inset polygon (N-vertex path) with a small
 *     octahedron (8-vertex bipyramid) for 'all', or with a $fn=4 cylinder
 *     rotated 45° (a thin square prism, half-diagonal = d) for vertical.
 *
 *     Rect (Phase 1, kept verbatim):
 *       all-edge:        minkowski() { cube(box - 2d); octahedron(d); }
 *       vertical:        minkowski() { cube(box - 2d xy); cylinder($fn=4, r=d√2/2, h=eps); }
 *       top/bottom:      slab + (cube minkowski'd with octahedron)
 *
 *     N-vertex convex polygon (Phase 2):
 *       all-edge:        minkowski() { linear_extrude(d-2d') polygon(inset); octahedron(d); }
 *       vertical:        minkowski() { linear_extrude(depth) polygon(inset); rot45 $fn=4 cyl }
 *       top/bottom:      slab(full polygon) + (linear_extrude(eps) polygon(inset) minkowski'd with octahedron)
 *
 *     A regular octahedron is built as the convex hull of (±d,0,0), (0,±d,0),
 *     (0,0,±d). We use OpenSCAD's polyhedron() primitive for this — no
 *     external lib required. Document: this gives a flat-faced chamfer
 *     (8 triangular bevel facets) which matches CAD-standard mechanical
 *     drawings ("X mm × 45°" is the most common chamfer callout).
 *
 *   - Profile must be a convex polygon. Axis-aligned rects use the Phase 1
 *     cube-based emission for zero-regression determinism.
 *
 * Phase 2 limitations (documented for the UI to surface):
 *   - Convex N-vertex polygon profiles only. Concave loops throw.
 *   - Uniform 45° chamfer only (no asymmetric distance / angle).
 *   - Child must be a single ExtrudeFeature; revolves/sweeps/lofts/
 *     patterns are out of scope until Phase 2.x OCCT chamfer lands.
 *   - Edge selection limited to four enums: all, top, bottom, vertical.
 *
 * Out of scope (Phase 3+):
 *   - Concave / arbitrary polygon (needs straight-skeleton or OCCT).
 *   - General edge selection (pick individual edges by id).
 *   - Asymmetric chamfer (distance1 ≠ distance2 / angle ≠ 45°).
 *   - Chamfer of a body produced by revolve/sweep/loft/pattern.
 */

import type { ExtrudeFeature } from './extrudeProfile';
import { isAxisAlignedRect } from './shellProfile';
import { isConvexPolygon, offsetPolygonInward } from './filletProfile';

// ─── IR ───────────────────────────────────────────────────────────────────

/**
 * Which edges of the child body to bevel. See filletProfile.FilletEdgeSelection
 * for the geometric meaning of each value — identical here.
 */
export type ChamferEdgeSelection = 'all' | 'top' | 'bottom' | 'vertical';

export interface ChamferFeature {
  kind: 'chamfer';
  /** The body to be chamfered. Phase 2 supports any convex polygon ExtrudeFeature. */
  childExtrude: ExtrudeFeature;
  /** Chamfer setback distance (mm) — the orthogonal distance the bevel
   *  cuts from the original edge. Must be > 0 and < min(inscribed-clearance)/2;
   *  for top/bottom edge selections also < depth/2.
   *  When `vertexDistances` is supplied this acts as a fallback uniform
   *  value but is not consumed by the SCAD emitter — vertexDistances wins. */
  distance: number;
  /** Phase 3 — variable distance per vertex (mm). When present, must satisfy
   *  `vertexDistances.length === childExtrude.loop.length` and every entry
   *  > 0. Rect-only (convex N-gon + variable distance is Phase 4 wishlist). */
  vertexDistances?: ReadonlyArray<number>;
  /** Which edges to bevel. See ChamferEdgeSelection enum. */
  edgeSelection: ChamferEdgeSelection;
}

export interface ChamferOptions {
  distance: number;
  edgeSelection: ChamferEdgeSelection;
  /** Phase 3 — per-vertex chamfer distances. length must equal `loop.length`. */
  vertexDistances?: ReadonlyArray<number>;
  /** Phase 3 — per-edge chamfer distances (sugar form). Auto-converted to
   *  vertexDistances via `d_vertex_i = max(d_edge_{i-1}, d_edge_i)`. */
  edgeDistances?: ReadonlyArray<number>;
}

const ALLOWED_EDGE_SELECTIONS: readonly ChamferEdgeSelection[] = [
  'all',
  'top',
  'bottom',
  'vertical',
];

interface Pt2 {
  x: number;
  y: number;
}

function loopBoundingBox(
  loop: ReadonlyArray<Pt2>,
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

function minVertexToEdgeDistance(loop: ReadonlyArray<Pt2>): number {
  const n = loop.length;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % n]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-12) continue;
    const nx = -ey / len;
    const ny = ex / len;
    for (let j = 0; j < n; j++) {
      if (j === i || j === (i + 1) % n) continue;
      const v = loop[j]!;
      const d = (v.x - a.x) * nx + (v.y - a.y) * ny;
      if (d > 0 && d < best) best = d;
    }
  }
  return best === Infinity ? 0 : best;
}

// ─── builder ──────────────────────────────────────────────────────────────

/**
 * Phase 3 sugar: convert edgeDistances to per-vertex distances using
 * `d_vertex_i = max(d_edge_{i-1}, d_edge_i)`. Mirror of
 * filletProfile.edgeRadiiToVertexRadii.
 */
export function edgeDistancesToVertexDistances(
  edgeDistances: ReadonlyArray<number>,
): number[] {
  const n = edgeDistances.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const prev = edgeDistances[(i - 1 + n) % n]!;
    const next = edgeDistances[i]!;
    out[i] = Math.max(prev, next);
  }
  return out;
}

function validateVertexDistances(
  loop: ReadonlyArray<Pt2>,
  vertexDistances: ReadonlyArray<number>,
  label: 'vertexDistances' | 'edgeDistances' = 'vertexDistances',
): void {
  if (vertexDistances.length !== loop.length) {
    throw new Error(
      `chamfer ${label} length ${vertexDistances.length} must equal loop length ${loop.length}`,
    );
  }
  for (let i = 0; i < vertexDistances.length; i++) {
    const d = vertexDistances[i]!;
    if (!Number.isFinite(d) || d <= 0) {
      throw new Error(
        `chamfer ${label}[${i}] must be a positive finite number, got: ${d}`,
      );
    }
  }
}

/**
 * Build a ChamferFeature wrapping an ExtrudeFeature.
 *
 * Validation:
 *   - distance must be > 0 and finite
 *   - edgeSelection must be one of the allowed enum values
 *   - Phase 1 rect path: distance < min(profileWidth, profileHeight)/2
 *   - Phase 2 N-vertex path: profile must be convex; distance < (shortest
 *     vertex-to-edge perpendicular distance)/2.
 *   - distance must be < depth / 2 when edges include top/bottom
 *   - Phase 3 (variable distance via vertexDistances or edgeDistances):
 *       * supported ONLY on axis-aligned rect profiles
 *       * length must match loop.length, every entry > 0
 *       * each d_i must be < min(bbox)/2 and < depth/2 when edges touch top/bottom
 */
export function buildChamferFeature(
  child: ExtrudeFeature,
  distanceOrOptions: number | ChamferOptions,
  edgeSelectionArg?: ChamferEdgeSelection,
): ChamferFeature {
  const opts: ChamferOptions =
    typeof distanceOrOptions === 'number'
      ? { distance: distanceOrOptions, edgeSelection: edgeSelectionArg ?? 'all' }
      : distanceOrOptions;
  const { distance, edgeSelection } = opts;

  if (!Number.isFinite(distance) || distance <= 0) {
    throw new Error(`chamfer distance must be a positive number, got: ${distance}`);
  }
  if (!ALLOWED_EDGE_SELECTIONS.includes(edgeSelection)) {
    throw new Error(
      `chamfer edgeSelection must be one of ${ALLOWED_EDGE_SELECTIONS.join('|')}, got: ${edgeSelection}`,
    );
  }

  const loop = child.loop;
  const rectPath = isAxisAlignedRect(loop);

  // ─── Phase 3 — variable distance path ─────────────────────────────────
  let vertexDistances: ReadonlyArray<number> | undefined;
  if (opts.vertexDistances !== undefined) {
    validateVertexDistances(loop, opts.vertexDistances, 'vertexDistances');
    vertexDistances = opts.vertexDistances;
  } else if (opts.edgeDistances !== undefined) {
    validateVertexDistances(loop, opts.edgeDistances, 'edgeDistances');
    vertexDistances = edgeDistancesToVertexDistances(opts.edgeDistances);
  }

  if (vertexDistances !== undefined) {
    if (!rectPath) {
      throw new Error(
        'chamfer variable distance (vertexDistances/edgeDistances) is Phase 3 rect-only; ' +
          'convex N-gon variable distance is Phase 4 (OCCT) wishlist',
      );
    }
    const bb = loopBoundingBox(loop);
    const w = bb.maxX - bb.minX;
    const h = bb.maxY - bb.minY;
    const maxAllowed = Math.min(w, h) / 2;
    for (let i = 0; i < vertexDistances.length; i++) {
      const d_i = vertexDistances[i]!;
      if (d_i >= maxAllowed) {
        throw new Error(
          `chamfer vertexDistances[${i}]=${d_i} must be < min(profile bbox)/2 = ${maxAllowed}`,
        );
      }
    }
    const touchesTopOrBottomVar =
      edgeSelection === 'all' || edgeSelection === 'top' || edgeSelection === 'bottom';
    if (touchesTopOrBottomVar) {
      for (let i = 0; i < vertexDistances.length; i++) {
        const d_i = vertexDistances[i]!;
        if (d_i >= child.depth / 2) {
          throw new Error(
            `chamfer vertexDistances[${i}]=${d_i} must be < depth/2 = ${child.depth / 2} when chamfering top/bottom edges`,
          );
        }
      }
    }
    return {
      kind: 'chamfer',
      childExtrude: child,
      distance,
      vertexDistances,
      edgeSelection,
    };
  }

  // ─── Phase 1/2 — uniform distance path (unchanged) ─────────────────────
  if (rectPath) {
    const bb = loopBoundingBox(loop);
    const w = bb.maxX - bb.minX;
    const h = bb.maxY - bb.minY;
    const minDim = Math.min(w, h);
    if (distance >= minDim / 2) {
      throw new Error(
        `chamfer distance ${distance} must be < min(profile bbox)/2 = ${minDim / 2}`,
      );
    }
  } else {
    if (!isConvexPolygon(loop)) {
      throw new Error('chamfer requires convex profile');
    }
    const minDist = minVertexToEdgeDistance(loop);
    if (distance >= minDist / 2) {
      throw new Error(
        `chamfer distance too large for polygon (distance ${distance} must be < min(edge_distances)/2 = ${minDist / 2})`,
      );
    }
    // Probe the inward offset so self-intersection bubbles up with a clear
    // message rather than silently producing broken SCAD.
    try {
      offsetPolygonInward(loop, distance);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Translate "fillet ..." → "chamfer ..." in the user-facing message.
      throw new Error(msg.replace(/^fillet /, 'chamfer '));
    }
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

function polygonPointsScad(pts: ReadonlyArray<Pt2>): string {
  return pts.map((p) => `[${formatNum(p.x)}, ${formatNum(p.y)}]`).join(', ');
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
 * Two emission strategies:
 *
 * (A) Axis-aligned rectangle (Phase 1, kept verbatim):
 *   - 'all': minkowski(cube(box-2d), octahedron(d))
 *   - 'vertical': minkowski(cube(box-2d xy with full depth), rot45 $fn=4 cylinder)
 *   - 'top':  union(bottom-slab cube, minkowski(crown cube + octahedron))
 *   - 'bottom': mirror of 'top'.
 *
 * (B) Convex N-vertex polygon (Phase 2):
 *   - 'all': minkowski(linear_extrude(depth-2d) polygon(offset), octahedron(d))
 *   - 'vertical': minkowski(linear_extrude(depth) polygon(offset), rot45 cyl)
 *   - 'top':  union(linear_extrude(depth-d) polygon(loop),
 *                   minkowski(linear_extrude(eps) polygon(offset) translated, octahedron(d)))
 *   - 'bottom': mirror of 'top'.
 */
export function chamferToScad(feature: ChamferFeature): string {
  const d = feature.distance;
  const loop = feature.childExtrude.loop;
  const depth = feature.childExtrude.depth;
  const epsilon = 0.001;
  const halfDiag = (d * Math.SQRT2) / 2;

  // ─── Phase 3 path: variable distance (rect-only — guarded by builder) ─
  if (feature.vertexDistances !== undefined) {
    return chamferVariableDistanceToScad(feature, feature.vertexDistances);
  }

  const header =
    `// NEXYFAB:CHAMFER distance=${formatNum(d)} edges=${feature.edgeSelection}`;

  // ─── Phase 1 path: axis-aligned rect → cube-based emission ────────────
  if (isAxisAlignedRect(loop)) {
    const bb = loopBoundingBox(loop);
    const w = bb.maxX - bb.minX;
    const h = bb.maxY - bb.minY;

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

  // ─── Phase 2 path: convex N-vertex polygon ────────────────────────────
  const offset = offsetPolygonInward(loop, d);
  const offsetPts = polygonPointsScad(offset);
  const fullPts = polygonPointsScad(loop);

  if (feature.edgeSelection === 'all') {
    return (
      `${header}\n` +
      `minkowski() {\n` +
      `  translate([0, 0, ${formatNum(d)}])\n` +
      `    linear_extrude(height=${formatNum(depth - 2 * d)})\n` +
      `      polygon([${offsetPts}]);\n` +
      `  ${octahedronScad(d)}\n` +
      `}`
    );
  }
  if (feature.edgeSelection === 'vertical') {
    return (
      `${header}\n` +
      `minkowski() {\n` +
      `  linear_extrude(height=${formatNum(depth)})\n` +
      `    polygon([${offsetPts}]);\n` +
      `  rotate([0, 0, 45]) cylinder(r=${formatNum(halfDiag)}, h=${formatNum(epsilon)}, $fn=4);\n` +
      `}`
    );
  }
  if (feature.edgeSelection === 'top') {
    return (
      `${header}\n` +
      `union() {\n` +
      `  linear_extrude(height=${formatNum(depth - d)})\n` +
      `    polygon([${fullPts}]);\n` +
      `  minkowski() {\n` +
      `    translate([0, 0, ${formatNum(depth - d)}])\n` +
      `      linear_extrude(height=${formatNum(epsilon)})\n` +
      `        polygon([${offsetPts}]);\n` +
      `    ${octahedronScad(d)}\n` +
      `  }\n` +
      `}`
    );
  }
  // 'bottom'
  return (
    `${header}\n` +
    `union() {\n` +
    `  translate([0, 0, ${formatNum(d)}])\n` +
    `    linear_extrude(height=${formatNum(depth - d)})\n` +
    `      polygon([${fullPts}]);\n` +
    `  minkowski() {\n` +
    `    translate([0, 0, ${formatNum(d)}])\n` +
    `      linear_extrude(height=${formatNum(epsilon)})\n` +
    `        polygon([${offsetPts}]);\n` +
    `    ${octahedronScad(d)}\n` +
    `  }\n` +
    `}`
  );
}

// ─── Phase 3 SCAD: variable distance (rect-only) ──────────────────────────

/**
 * Phase 3 variable-distance SCAD emission for an axis-aligned rect.
 *
 * Algorithm — hull() of per-corner octahedra (3D) or squares (2D) with
 * varying setback:
 *
 *   'vertical': linear_extrude(depth) hull() { 4 rotated squares, one per corner }
 *     Each square (technically a circle with $fn=4 rotated 45°) has
 *     half-diagonal = d_i, positioned at the inset corner.
 *   'all':      hull() { 8 octahedra, one per (corner × top/bottom-face) }
 *   'top':      union(slab, hull(4 top octahedra))
 *   'bottom':   mirror of 'top'.
 *
 * The convex hull of per-corner octahedra produces flat-faceted chamfers
 * with variable setback — exactly matching the chamfer drawing callout
 * convention "d_i × 45°" at each corner. Variable-distance vertical
 * edges between corners with different d_i are linearly blended (a
 * trapezoidal facet rather than a clean 45° bevel); this is the
 * documented Phase 3 trade-off, consistent with the filletProfile
 * variable-radius approach. Phase 4 (OCCT) restores per-edge consistent
 * chamfer cross-sections.
 */
function chamferVariableDistanceToScad(
  feature: ChamferFeature,
  vertexDistances: ReadonlyArray<number>,
): string {
  const loop = feature.childExtrude.loop;
  const depth = feature.childExtrude.depth;
  const edges = feature.edgeSelection;
  const bb = loopBoundingBox(loop);
  const header =
    `// NEXYFAB:CHAMFER vertexDistances=[${vertexDistances.map((v) => formatNum(v)).join(',')}] edges=${edges}`;

  interface Inset {
    cx: number;
    cy: number;
    d: number;
  }
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  const insets: Inset[] = [];
  for (let i = 0; i < loop.length; i++) {
    const v = loop[i]!;
    const d_i = vertexDistances[i]!;
    const sx = v.x < cx ? 1 : -1;
    const sy = v.y < cy ? 1 : -1;
    insets.push({ cx: v.x + sx * d_i, cy: v.y + sy * d_i, d: d_i });
  }
  const maxD = vertexDistances.reduce((a, b) => Math.max(a, b), 0);

  if (edges === 'vertical') {
    const squares = insets
      .map(
        (it) =>
          `    translate([${formatNum(it.cx)}, ${formatNum(it.cy)}])\n` +
          `      rotate([0, 0, 45]) circle(r=${formatNum((it.d * Math.SQRT2) / 2)}, $fn=4);`,
      )
      .join('\n');
    return (
      `${header}\n` +
      `linear_extrude(height=${formatNum(depth)})\n` +
      `  hull() {\n` +
      `${squares}\n` +
      `  }`
    );
  }

  if (edges === 'all') {
    const polys: string[] = [];
    for (const it of insets) {
      polys.push(
        `  translate([${formatNum(it.cx)}, ${formatNum(it.cy)}, ${formatNum(it.d)}])\n` +
          `    ${octahedronScad(it.d)}`,
      );
      polys.push(
        `  translate([${formatNum(it.cx)}, ${formatNum(it.cy)}, ${formatNum(depth - it.d)}])\n` +
          `    ${octahedronScad(it.d)}`,
      );
    }
    return `${header}\n` + `hull() {\n` + polys.join('\n') + `\n}`;
  }

  const w = bb.maxX - bb.minX;
  const h = bb.maxY - bb.minY;
  if (edges === 'top') {
    const slab =
      `  translate([${formatNum(bb.minX)}, ${formatNum(bb.minY)}, 0])\n` +
      `    cube([${formatNum(w)}, ${formatNum(h)}, ${formatNum(depth - maxD)}]);`;
    const crownPolys = insets
      .map(
        (it) =>
          `    translate([${formatNum(it.cx)}, ${formatNum(it.cy)}, ${formatNum(depth - it.d)}])\n` +
          `      ${octahedronScad(it.d)}`,
      )
      .join('\n');
    return (
      `${header}\n` +
      `union() {\n` +
      `${slab}\n` +
      `  hull() {\n` +
      `${crownPolys}\n` +
      `  }\n` +
      `}`
    );
  }

  // 'bottom'
  const slab =
    `  translate([${formatNum(bb.minX)}, ${formatNum(bb.minY)}, ${formatNum(maxD)}])\n` +
    `    cube([${formatNum(w)}, ${formatNum(h)}, ${formatNum(depth - maxD)}]);`;
  const crownPolys = insets
    .map(
      (it) =>
        `    translate([${formatNum(it.cx)}, ${formatNum(it.cy)}, ${formatNum(it.d)}])\n` +
        `      ${octahedronScad(it.d)}`,
    )
    .join('\n');
  return (
    `${header}\n` +
    `union() {\n` +
    `${slab}\n` +
    `  hull() {\n` +
    `${crownPolys}\n` +
    `  }\n` +
    `}`
  );
}
