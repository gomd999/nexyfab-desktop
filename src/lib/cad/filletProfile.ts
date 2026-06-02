/**
 * filletProfile — Phase 2.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Fillet rounds selected edges of an existing solid body with a constant
 * radius. Mirror of shellProfile.ts: the IR wraps a child ExtrudeFeature
 * and serializes to OpenSCAD source that reproduces the rounded body via
 * a minkowski sum trick (the only kernel-free strategy that works in the
 * vanilla OpenSCAD pipeline NexyFab currently runs against).
 *
 * Implementation strategy:
 *   - Wrap an existing ExtrudeFeature as the child body.
 *   - SCAD approach: minkowski() of an inset profile (extruded) with a
 *     sphere (or cylinder, for "vertical"-only edges) of `radius`.
 *     Vanilla OpenSCAD does not expose any face- or edge-level rounding
 *     primitive; BOSL2 provides `edge_round()` but pulls in 4 MB of
 *     library code and depends on a non-standard `include <>` chain
 *     we don't want in the server-side SCAD pipeline. The minkowski
 *     trick reproduces a uniform fillet exactly:
 *
 *       rect path (Phase 1 — kept for backwards-compat / fastest output):
 *         all-edge fillet:        minkowski() { cube(box - 2r); sphere(r); }
 *         vertical-edge only:     minkowski() { cube(box - 2r·xy); cylinder(r, h); }
 *
 *       N-vertex convex polygon path (Phase 2):
 *         all-edge fillet:        minkowski() { linear_extrude(d-2r) polygon(inward_offset(loop, r)); sphere(r); }
 *         vertical-edge only:     minkowski() { linear_extrude(d) polygon(inward_offset(loop, r)); cylinder(r, h=eps); }
 *         top/bottom-edge only:   slab(full polygon) + minkowski-crown(inset polygon, thin slab + sphere)
 *
 *     For top/bottom/vertical we emit a difference-then-union pattern
 *     described inline at filletToScad.
 *
 *   - Profile must be a convex polygon. Axis-aligned rects are a 4-vertex
 *     special case and use the original Phase 1 cube-based emission for
 *     determinism (zero regression risk).
 *
 * Phase 2 limitations (documented for the UI to surface):
 *   - Convex N-vertex polygon profiles only. Concave loops throw with a
 *     clear error message; the UI should bounce these before reaching
 *     this layer.
 *   - Uniform radius only (no variable-radius / hold-line fillets).
 *   - Child must be a single ExtrudeFeature; revolves/sweeps/lofts/
 *     patterns are out of scope until Phase 2.x OCCT fillet lands.
 *   - Edge selection limited to four enums: all, top, bottom, vertical
 *     (top-and-bottom-only) — there is no per-edge picking yet.
 *
 * Out of scope (Phase 3+):
 *   - Concave / arbitrary polygon (needs straight-skeleton or OCCT).
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
  /** The body to be filleted. Phase 2 supports any convex polygon ExtrudeFeature. */
  childExtrude: ExtrudeFeature;
  /** Fillet radius (mm). Must be > 0 and < min(inscribed-clearance)/2; for
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

// ─── geometry helpers (Phase 2: convex N-vertex support) ─────────────────

function signedAreaXY(loop: ReadonlyArray<Pt2>): number {
  let s = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % n]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/**
 * Returns true iff the loop is a strictly convex polygon (all interior
 * cross products share the same sign and are non-zero). Allows ≥3 points;
 * a triangle is always convex. Collinear vertices (cross ≈ 0) are rejected
 * as degenerate.
 */
export function isConvexPolygon(loop: ReadonlyArray<Pt2>, tol = 1e-9): boolean {
  const n = loop.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[(i - 1 + n) % n]!;
    const b = loop[i]!;
    const c = loop[(i + 1) % n]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < tol) return false; // degenerate (collinear)
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Compute the shortest perpendicular distance from any vertex of `loop` to
 * any non-adjacent edge — used as a conservative upper bound on the
 * fillet/inset radius. For a convex polygon, twice the inradius gives the
 * "width" along the narrowest dimension; using the minimum vertex-to-edge
 * distance is a tighter bound (and matches the rect-bbox/2 special case
 * exactly for axis-aligned rectangles).
 */
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
    // unit inward normal for CCW polygon: rotate edge vector 90° CCW.
    const nx = -ey / len;
    const ny = ex / len;
    for (let j = 0; j < n; j++) {
      if (j === i || j === (i + 1) % n) continue;
      const v = loop[j]!;
      // signed perpendicular distance from v to the line through a in
      // direction (ex,ey). Positive = inward side for a CCW polygon.
      const d = (v.x - a.x) * nx + (v.y - a.y) * ny;
      if (d > 0 && d < best) best = d;
    }
  }
  return best === Infinity ? 0 : best;
}

/**
 * Offset each vertex of `loop` inward by `r` along the angle bisector of
 * its two adjacent edges (the "miter offset"). For a convex CCW polygon
 * with all interior angles < 180°, the offset is well-defined and the
 * result is a smaller, similar-ish convex polygon whose Minkowski sum
 * with a disk of radius r reproduces the original profile exactly.
 *
 * Formula derivation (per vertex i with edges e_prev, e_next):
 *   Let n_prev, n_next be unit inward normals (rotate each edge vector
 *   90° CCW: (-dy/|e|, dx/|e|)).
 *   We want offset point p such that (p - v[i]) · n_prev = r and
 *   (p - v[i]) · n_next = r. Let p - v[i] = t·(n_prev + n_next). Then
 *   t · (1 + cos γ) = r  where γ = ∠(n_prev, n_next),
 *   so   t = r / (1 + n_prev · n_next).
 *   When 1 + cos γ → 0 (180° vertex / cusp) the offset blows up; for
 *   convex polygons γ < 180° so 1 + cos γ > 0 always.
 *
 * Throws if:
 *   - `loop` is not strictly convex (caller's responsibility but we
 *     re-check for safety).
 *   - radius is large enough that the resulting offset polygon
 *     self-intersects (detected by signedArea sign-flip or any offset
 *     edge running opposite to its corresponding original edge).
 */
export function offsetPolygonInward(loop: ReadonlyArray<Pt2>, r: number): Pt2[] {
  if (!Number.isFinite(r) || r <= 0) {
    throw new Error(`offsetPolygonInward: r must be a positive finite number, got ${r}`);
  }
  if (!isConvexPolygon(loop)) {
    throw new Error('fillet requires convex profile');
  }
  const n = loop.length;
  // Ensure CCW orientation. signedAreaXY > 0 means CCW.
  const orientedLoop = signedAreaXY(loop) >= 0 ? loop : [...loop].slice().reverse();

  const offset: Pt2[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = orientedLoop[(i - 1 + n) % n]!;
    const curr = orientedLoop[i]!;
    const next = orientedLoop[(i + 1) % n]!;
    const ePrevX = curr.x - prev.x;
    const ePrevY = curr.y - prev.y;
    const eNextX = next.x - curr.x;
    const eNextY = next.y - curr.y;
    const lenPrev = Math.hypot(ePrevX, ePrevY);
    const lenNext = Math.hypot(eNextX, eNextY);
    if (lenPrev < 1e-12 || lenNext < 1e-12) {
      throw new Error('fillet requires convex profile'); // zero-length edge
    }
    // Unit inward normals (CCW polygon → interior on the left of each edge):
    const nPx = -ePrevY / lenPrev;
    const nPy = ePrevX / lenPrev;
    const nNx = -eNextY / lenNext;
    const nNy = eNextX / lenNext;
    const dot = nPx * nNx + nPy * nNy;
    const denom = 1 + dot;
    if (denom < 1e-9) {
      // Effectively a 180° corner (cusp). Already rejected by isConvexPolygon
      // for collinear vertices, but guard against acute back-folds.
      throw new Error('fillet radius too large for polygon (vertex offset diverges)');
    }
    const t = r / denom;
    offset[i] = {
      x: curr.x + t * (nPx + nNx),
      y: curr.y + t * (nPy + nNy),
    };
  }

  // Validate the offset polygon is still simple and CCW with the same
  // orientation. The cheapest correct test: signedArea > 0 AND each new
  // edge points in roughly the same direction as the corresponding
  // original edge (dot product > 0). If either fails, r was too large.
  const newArea = signedAreaXY(offset);
  if (newArea <= 1e-9) {
    throw new Error('fillet radius too large for polygon (offset collapses)');
  }
  for (let i = 0; i < n; i++) {
    const oa = orientedLoop[i]!;
    const ob = orientedLoop[(i + 1) % n]!;
    const na = offset[i]!;
    const nb = offset[(i + 1) % n]!;
    const odx = ob.x - oa.x;
    const ody = ob.y - oa.y;
    const ndx = nb.x - na.x;
    const ndy = nb.y - na.y;
    if (odx * ndx + ody * ndy <= 0) {
      throw new Error('fillet radius too large for polygon (offset edge flipped)');
    }
  }
  return offset;
}

// ─── builder ──────────────────────────────────────────────────────────────

/**
 * Build a FilletFeature wrapping an ExtrudeFeature.
 *
 * Validation:
 *   - radius must be > 0 and finite
 *   - edgeSelection must be one of the allowed enum values
 *   - Phase 1 rect path: radius < min(profileWidth, profileHeight)/2
 *   - Phase 2 N-vertex path: profile must be convex; radius < (shortest
 *     vertex-to-edge perpendicular distance)/2 (a tight upper bound that
 *     reduces to the bbox/2 rule for axis-aligned rectangles).
 *   - radius must be < depth/2 when edges include top/bottom — otherwise
 *     the rounded crown eats the entire body in the Z direction
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

  const loop = child.loop;
  const rectPath = isAxisAlignedRect(loop);
  if (rectPath) {
    // Phase 1 path — keep the existing bbox-based check verbatim for zero
    // regression. The minkowski-with-cube emission is the same.
    const bb = loopBoundingBox(loop);
    const w = bb.maxX - bb.minX;
    const h = bb.maxY - bb.minY;
    const minDim = Math.min(w, h);
    if (radius >= minDim / 2) {
      throw new Error(
        `fillet radius ${radius} must be < min(profile bbox)/2 = ${minDim / 2}`,
      );
    }
  } else {
    // Phase 2 path — N-vertex convex polygon.
    if (!isConvexPolygon(loop)) {
      throw new Error('fillet requires convex profile');
    }
    const minDist = minVertexToEdgeDistance(loop);
    if (radius >= minDist / 2) {
      throw new Error(
        `fillet radius too large for polygon (radius ${radius} must be < min(edge_distances)/2 = ${minDist / 2})`,
      );
    }
    // Also probe the offset itself so radii that pass the bbox-style
    // bound but still self-intersect throw the documented message.
    offsetPolygonInward(loop, radius);
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

function polygonPointsScad(pts: ReadonlyArray<Pt2>): string {
  return pts.map((p) => `[${formatNum(p.x)}, ${formatNum(p.y)}]`).join(', ');
}

/**
 * Convert a FilletFeature to OpenSCAD source. The output is deterministic:
 * same input always yields the same string (suitable for cache keys).
 *
 * Two emission strategies:
 *
 * (A) Axis-aligned rectangle (Phase 1, kept verbatim):
 *     - 'all': minkowski(cube(box-2r), sphere(r))
 *     - 'vertical': minkowski(cube(box-2r·xy with full depth), cylinder(r, eps))
 *     - 'top':  union(bottom-slab cube, minkowski(crown-slab cube + sphere))
 *     - 'bottom': mirror of 'top'
 *
 * (B) Convex N-vertex polygon (Phase 2):
 *     The 2D polygon is offset inward by r (offsetPolygonInward) before
 *     extrusion so the Minkowski sum with a sphere/cylinder/octahedron of
 *     radius r grows back out to the original silhouette while rounding
 *     every external edge.
 *
 *     - 'all': minkowski(linear_extrude(depth-2r) polygon(offset), sphere(r))
 *     - 'vertical': minkowski(linear_extrude(depth) polygon(offset), cylinder(r, h=eps))
 *     - 'top':  union(linear_extrude(depth-r) polygon(loop),
 *                     minkowski(linear_extrude(eps) polygon(offset) translated to z=depth-r, sphere(r)))
 *     - 'bottom': mirror of 'top'.
 */
export function filletToScad(feature: FilletFeature): string {
  const r = feature.radius;
  const loop = feature.childExtrude.loop;
  const depth = feature.childExtrude.depth;
  const epsilon = 0.001; // sub-mm slab thickness used to seed the minkowski crown
  const header =
    `// NEXYFAB:FILLET radius=${formatNum(r)} edges=${feature.edgeSelection}`;

  // ─── Phase 1 path: axis-aligned rect → cube-based emission ────────────
  if (isAxisAlignedRect(loop)) {
    const bb = loopBoundingBox(loop);
    const w = bb.maxX - bb.minX;
    const h = bb.maxY - bb.minY;

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

  // ─── Phase 2 path: convex N-vertex polygon ────────────────────────────
  const offset = offsetPolygonInward(loop, r);
  const offsetPts = polygonPointsScad(offset);
  const fullPts = polygonPointsScad(loop);

  if (feature.edgeSelection === 'all') {
    return (
      `${header}\n` +
      `minkowski() {\n` +
      `  translate([0, 0, ${formatNum(r)}])\n` +
      `    linear_extrude(height=${formatNum(depth - 2 * r)})\n` +
      `      polygon([${offsetPts}]);\n` +
      `  sphere(r=${formatNum(r)}, $fn=32);\n` +
      `}`
    );
  }
  if (feature.edgeSelection === 'vertical') {
    return (
      `${header}\n` +
      `minkowski() {\n` +
      `  linear_extrude(height=${formatNum(depth)})\n` +
      `    polygon([${offsetPts}]);\n` +
      `  cylinder(r=${formatNum(r)}, h=${formatNum(epsilon)}, $fn=32);\n` +
      `}`
    );
  }
  if (feature.edgeSelection === 'top') {
    return (
      `${header}\n` +
      `union() {\n` +
      `  linear_extrude(height=${formatNum(depth - r)})\n` +
      `    polygon([${fullPts}]);\n` +
      `  minkowski() {\n` +
      `    translate([0, 0, ${formatNum(depth - r)}])\n` +
      `      linear_extrude(height=${formatNum(epsilon)})\n` +
      `        polygon([${offsetPts}]);\n` +
      `    sphere(r=${formatNum(r)}, $fn=32);\n` +
      `  }\n` +
      `}`
    );
  }
  // 'bottom'
  return (
    `${header}\n` +
    `union() {\n` +
    `  translate([0, 0, ${formatNum(r)}])\n` +
    `    linear_extrude(height=${formatNum(depth - r)})\n` +
    `      polygon([${fullPts}]);\n` +
    `  minkowski() {\n` +
    `    translate([0, 0, ${formatNum(r)}])\n` +
    `      linear_extrude(height=${formatNum(epsilon)})\n` +
    `        polygon([${offsetPts}]);\n` +
    `    sphere(r=${formatNum(r)}, $fn=32);\n` +
    `  }\n` +
    `}`
  );
}
