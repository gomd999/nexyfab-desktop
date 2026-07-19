/**
 * filletProfile — Phase 2.2 + Phase 3 of NexyFab Pro own-CAD (ADR-013).
 *
 * Fillet rounds selected edges of an existing solid body. Phases 1/2 use a
 * uniform radius. Phase 3 adds an alternative variable-radius form where
 * each vertex of the profile gets its own radius (`vertexRadii`) — or, as
 * a sugar form, each edge (`edgeRadii` length = N is auto-converted to
 * a per-vertex array via `r_vertex_i = max(r_edge_{i-1}, r_edge_i)`).
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
 *   - Phase 3 (variable radius) — *axis-aligned rect only*. We synthesize
 *     the body as a `hull()` of corner spheres / circles of varying radius,
 *     positioned at each corner inset by its own r_i. This is mathematically
 *     exact (the convex hull of 8 sphere primitives is a rectangular box
 *     whose corners are rounded by their respective r_i) and requires no
 *     custom 3D arithmetic.
 *
 *         'all':       hull() { 8 spheres, one per (corner × top/bottom-face), each r=r_i }
 *         'vertical':  linear_extrude(depth) hull() { 4 circles, one per corner, each r=r_i }
 *         'top':       union(slab(depth-max_r), hull(4 spheres at top z, each r=r_i))
 *         'bottom':    union(translate-up slab, hull(4 spheres at z=max_r, each r=r_i))
 *
 *     The rect+variable path is "good enough" for visual approximation and
 *     even exact for the rect case (the corner sphere hull = box with
 *     variable rounded corners — provably the offset of a degenerate
 *     center-segment by a varying radius envelope). For N-gon + variable
 *     radius we throw a Phase 4 wishlist error; the polygon-offset solver
 *     for non-uniform vertex offsets requires straight-skeleton math we
 *     intentionally defer until OCCT/Parasolid lands.
 *
 * Phase 2/3 limitations (documented for the UI to surface):
 *   - Uniform radius: convex N-vertex polygon profiles supported.
 *   - Variable radius (vertexRadii / edgeRadii): axis-aligned rect only.
 *     Convex N-gon + variable radius throws a Phase 4 wishlist error.
 *   - Variable radius is an exact CSG for the rect case (hull of corner
 *     spheres). For N-gon this is only a *visual approximation* and is
 *     therefore gated off until OCCT lands.
 *   - Child must be a single ExtrudeFeature; revolves/sweeps/lofts/
 *     patterns are out of scope until Phase 2.x OCCT fillet lands.
 *   - Edge selection limited to four enums: all, top, bottom, vertical
 *     (top-and-bottom-only) — there is no per-edge picking yet.
 *
 * Out of scope (Phase 4+ — OCCT wishlist):
 *   - Concave / arbitrary polygon (needs straight-skeleton or OCCT).
 *   - General edge selection (pick individual edges by id).
 *   - Variable radius on a convex N-gon (needs non-uniform vertex offset
 *     via straight-skeleton or OCCT BRepFilletAPI_MakeFillet).
 *   - Spline-curvature / hold-line fillets.
 *   - Face blends, full-round, three-tangent.
 *   - Fillet of a body produced by revolve/sweep/loft/pattern.
 */

import type { ExtrudeFeature } from './extrudeProfile';
import type { EmitContext } from './featureTree';
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
  /**
   * W2-0 — id of the upstream feature node supplying the body to fillet.
   *
   * When present this is the ONLY authority for the child geometry: the
   * emitter resolves it against the tree being replayed, so editing the
   * upstream extrude's depth flows through to this fillet. `childExtrude`
   * is then a stale build-time snapshot and is never read for emission.
   *
   * When absent, the feature is a legacy embedded-payload fillet and emits
   * from `childExtrude` exactly as before (see docs/design/w2-downstream-regen.md).
   */
  childId?: string;
  /**
   * Build-time snapshot of the body to be filleted. Phase 2 supports any
   * convex polygon ExtrudeFeature.
   *
   * @deprecated as an emission source once `childId` is set. Retained
   * because consumers outside W2-0's file scope still read it
   * (`lib/occt/featurePlan.ts`, `brep-bridge/stepWriteFilletChamfer.ts`,
   * `featureTreeStats.ts`). Call `syncEmbeddedSnapshots(tree)` before
   * handing a ref-mode tree to those consumers.
   */
  childExtrude: ExtrudeFeature;
  /** Fillet radius (mm). Must be > 0 and < min(inscribed-clearance)/2; for
   *  top/bottom edge selections also < depth/2.
   *  When `vertexRadii` is supplied this acts as the *fallback uniform value*
   *  but is not consumed by the SCAD emitter — vertexRadii takes precedence. */
  radius: number;
  /** Phase 3 — variable radius per vertex (mm). When present, must satisfy
   *  `vertexRadii.length === childExtrude.loop.length` and every entry > 0.
   *  Each r_i applies to the corner at loop[i]. Currently rect-only; convex
   *  N-gon + variable radius throws (Phase 4 wishlist). Takes precedence
   *  over `radius` in the SCAD emitter. */
  vertexRadii?: ReadonlyArray<number>;
  /** Which edges to round. See FilletEdgeSelection enum. */
  edgeSelection: FilletEdgeSelection;
}

export interface FilletOptions {
  radius: number;
  edgeSelection: FilletEdgeSelection;
  /** Phase 3 — per-vertex radii. length must equal `loop.length`. */
  vertexRadii?: ReadonlyArray<number>;
  /** Phase 3 — per-edge radii (sugar form). Auto-converted to vertexRadii
   *  via `r_vertex_i = max(r_edge_{i-1}, r_edge_i)` so the corner is rounded
   *  by the larger of its two adjacent edges. length must equal `loop.length`.
   *  vertexRadii takes precedence if both are supplied. */
  edgeRadii?: ReadonlyArray<number>;
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
 * Phase 3 — convert an `edgeRadii` array to the equivalent `vertexRadii`.
 * Each vertex gets the maximum of its two adjacent-edge radii so the
 * corner is rounded by the *larger* of the two edges meeting it. (Picking
 * max — rather than mean — keeps the corner inset bound consistent with
 * each adjacent edge's expectation.)
 *
 * Convention: edgeRadii[i] is the radius applied to the edge from
 * loop[i] → loop[(i+1) % N]. Hence the corner at loop[i] sits between
 * edgeRadii[(i-1+N)%N] (incoming) and edgeRadii[i] (outgoing).
 */
export function edgeRadiiToVertexRadii(
  edgeRadii: ReadonlyArray<number>,
): number[] {
  const n = edgeRadii.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const prev = edgeRadii[(i - 1 + n) % n]!;
    const next = edgeRadii[i]!;
    out[i] = Math.max(prev, next);
  }
  return out;
}

/**
 * Validate a per-vertex radius array against the loop. Throws on any
 * mismatch / non-positive / non-finite entry.
 */
function validateVertexRadii(
  loop: ReadonlyArray<Pt2>,
  vertexRadii: ReadonlyArray<number>,
  label: 'vertexRadii' | 'edgeRadii' = 'vertexRadii',
): void {
  if (vertexRadii.length !== loop.length) {
    throw new Error(
      `fillet ${label} length ${vertexRadii.length} must equal loop length ${loop.length}`,
    );
  }
  for (let i = 0; i < vertexRadii.length; i++) {
    const r = vertexRadii[i]!;
    if (!Number.isFinite(r) || r <= 0) {
      throw new Error(
        `fillet ${label}[${i}] must be a positive finite number, got: ${r}`,
      );
    }
  }
}

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
 *   - Phase 3 (variable radius via `vertexRadii` or `edgeRadii`):
 *       * supported ONLY on axis-aligned rect profiles (Phase 4 wishlist
 *         for convex N-gons — straight-skeleton offsets required).
 *       * length must match loop.length, every entry > 0.
 *       * each r_i must be < min(adjacentEdgeLengths)/2 (so corner
 *         insets do not overlap each other) and < depth/2 when edges
 *         include top/bottom.
 */
export function buildFilletFeature(
  child: ExtrudeFeature,
  radiusOrOptions: number | FilletOptions,
  edgeSelectionArg?: FilletEdgeSelection,
): FilletFeature {
  // Resolve the two call signatures into a single FilletOptions.
  const opts: FilletOptions =
    typeof radiusOrOptions === 'number'
      ? { radius: radiusOrOptions, edgeSelection: edgeSelectionArg ?? 'all' }
      : radiusOrOptions;
  const { radius, edgeSelection } = opts;

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

  // ─── Phase 3 — variable radius path ─────────────────────────────────────
  // Resolve vertexRadii: explicit `vertexRadii` wins; else derive from
  // `edgeRadii` if supplied.
  let vertexRadii: ReadonlyArray<number> | undefined;
  if (opts.vertexRadii !== undefined) {
    validateVertexRadii(loop, opts.vertexRadii, 'vertexRadii');
    vertexRadii = opts.vertexRadii;
  } else if (opts.edgeRadii !== undefined) {
    validateVertexRadii(loop, opts.edgeRadii, 'edgeRadii');
    vertexRadii = edgeRadiiToVertexRadii(opts.edgeRadii);
  }

  if (vertexRadii !== undefined) {
    // Phase 3 limitation: rect-only.
    if (!rectPath) {
      throw new Error(
        'fillet variable radius (vertexRadii/edgeRadii) is Phase 3 rect-only; ' +
          'convex N-gon variable radius is Phase 4 (OCCT) wishlist',
      );
    }
    // Validate each r_i against adjacent edge lengths. For an axis-aligned
    // rect with bbox WxH, every vertex has two adjacent edges of length W
    // and H respectively; the inset point for vertex i lives at
    // (corner ± r_i, corner ± r_i) and must stay inside the half-bbox in
    // both axes — so r_i < min(W, H) / 2 is the tightest universal bound.
    const bb = loopBoundingBox(loop);
    const w = bb.maxX - bb.minX;
    const h = bb.maxY - bb.minY;
    const maxAllowed = Math.min(w, h) / 2;
    for (let i = 0; i < vertexRadii.length; i++) {
      const r_i = vertexRadii[i]!;
      if (r_i >= maxAllowed) {
        throw new Error(
          `fillet vertexRadii[${i}]=${r_i} must be < min(profile bbox)/2 = ${maxAllowed}`,
        );
      }
    }
    const touchesTopOrBottomVar =
      edgeSelection === 'all' || edgeSelection === 'top' || edgeSelection === 'bottom';
    if (touchesTopOrBottomVar) {
      for (let i = 0; i < vertexRadii.length; i++) {
        const r_i = vertexRadii[i]!;
        if (r_i >= child.depth / 2) {
          throw new Error(
            `fillet vertexRadii[${i}]=${r_i} must be < depth/2 = ${child.depth / 2} when filleting top/bottom edges`,
          );
        }
      }
    }
    return {
      kind: 'fillet',
      childExtrude: child,
      radius,
      vertexRadii,
      edgeSelection,
    };
  }

  // ─── Phase 1/2 — uniform radius path (unchanged) ────────────────────────
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

// ─── upstream resolution (W2-0) ───────────────────────────────────────────

/**
 * Resolve the body this fillet operates on.
 *
 * Two modes, chosen by the presence of `childId` — never by heuristics:
 *
 *   ref mode    (`childId` set): the LIVE upstream payload from the tree.
 *                A missing context is a hard error, not a silent fallback
 *                to the stale snapshot — emitting stale geometry is the
 *                exact defect W2-0 exists to remove (ADR-017 D1).
 *   legacy mode (`childId` absent): the embedded `childExtrude` snapshot,
 *                byte-identical to pre-W2-0 behaviour.
 *
 * Wrong-kind and missing-node failures are raised by `EmitContext`; a
 * suppressed upstream never reaches here because `replayTree` cascades
 * suppression to the dependent first.
 */
export function resolveFilletChild(
  feature: FilletFeature,
  ctx?: EmitContext,
  selfId = 'fillet',
): ExtrudeFeature {
  if (feature.childId === undefined) return feature.childExtrude;
  if (!ctx) {
    throw new Error(
      `fillet '${selfId}' references upstream body '${feature.childId}' but was emitted ` +
        `without a tree context. Emit it via replayTree/incrementalReplay, or pass an ` +
        `EmitContext to filletToScad. (Refusing to fall back to the stale childExtrude snapshot.)`,
    );
  }
  return ctx.requirePayload(feature.childId, selfId, 'extrude');
}

/**
 * W2-0 — build a fillet that REFERENCES its upstream body by node id.
 *
 * `childSnapshot` is the upstream extrude as it stands at build time. It is
 * used for validation only (radius bounds are geometry-dependent and must
 * be checked against something concrete), and is stored in `childExtrude`
 * purely for consumers not yet migrated off the embedded field. Emission
 * always re-resolves `childId` against the live tree.
 *
 * Note the deliberate asymmetry: validation is a build-time check against
 * a snapshot, emission is a replay-time read of the live tree. A later
 * upstream edit can therefore invalidate the radius bound (e.g. shrinking
 * depth below 2r). That is caught at emit time by the same bound checks
 * inside the SCAD path, and is the subject of W2-C's regression matrix.
 */
export function buildFilletFeatureRef(
  childId: string,
  childSnapshot: ExtrudeFeature,
  radiusOrOptions: number | FilletOptions,
  edgeSelectionArg?: FilletEdgeSelection,
): FilletFeature {
  if (typeof childId !== 'string' || childId.length === 0) {
    throw new Error(`fillet childId must be a non-empty string, got: ${childId}`);
  }
  const base = buildFilletFeature(childSnapshot, radiusOrOptions, edgeSelectionArg);
  return { ...base, childId };
}

// ─── W2-0 regression: emit-time bound re-check ────────────────────────────

/**
 * Re-run the radius bounds against the body the fillet is ACTUALLY being
 * emitted against.
 *
 * Why this exists (W2-0 regression). Before downstream regeneration,
 * `childExtrude` was a frozen snapshot: a stale fillet, but a geometrically
 * valid one. Now `childId` resolves to the live upstream, so thinning the
 * plate under a fillet feeds a smaller depth into an unchanged radius and
 * the emitters happily print `cube([104, 64, -6])` — a negative-height
 * solid that no downstream consumer can interpret. The build-time gate in
 * `buildFilletFeature` cannot catch this: it ran against the OLD snapshot,
 * before the edit existed. The docstring on `buildFilletFeatureRef` already
 * promised this check; it simply had never been written.
 *
 * The bounds are not invented here — they are the same three the builder
 * applies, quoted from `buildFilletFeature` so the two can be diffed:
 *
 *   1. rect profile:  r < min(bbox W, bbox H) / 2
 *   2. convex N-gon:  r < min(vertex→edge distance) / 2   (offset must exist)
 *   3. top/bottom/all: r < depth / 2   — the minkowski crown consumes r from
 *      each capped face, so 2r must fit inside the depth.
 *
 * Refusal, never a clamp. ADR-017 D1: an invalid parameter combination is
 * reported with the offending numbers so the user reads "radius exceeds half
 * the thickness", not "my fillet quietly changed size" — and definitely not
 * a negative-dimension solid that fails much later, somewhere else.
 *
 * Scoped to ref mode (`childId` set). In legacy mode the emitted body is the
 * same snapshot the builder already validated, so re-checking could only
 * reject payloads that pre-date this rule — a behaviour change unrelated to
 * the regression being fixed.
 */
function assertFilletBoundsAtEmit(
  feature: FilletFeature,
  child: ExtrudeFeature,
  selfId: string,
): void {
  if (feature.childId === undefined) return;

  const where =
    `fillet '${selfId}' is no longer valid against its upstream body ` +
    `'${feature.childId}'`;
  const loop = child.loop;
  const radii =
    feature.vertexRadii !== undefined ? feature.vertexRadii : [feature.radius];
  const label = (i: number): string =>
    feature.vertexRadii !== undefined ? `vertexRadii[${i}]` : 'radius';

  if (!(child.depth > 0) || !Number.isFinite(child.depth)) {
    throw new Error(
      `${where}: upstream depth is ${child.depth} — must be a positive number.`,
    );
  }

  // Bound 1/2 — in-plane. Use the same discriminator the emitter uses so the
  // check and the emission can never disagree about which path applies.
  if (isAxisAlignedRect(loop)) {
    const bb = loopBoundingBox(loop);
    const minDim = Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY);
    for (let i = 0; i < radii.length; i++) {
      const r = radii[i]!;
      if (r >= minDim / 2) {
        throw new Error(
          `${where}: ${label(i)} ${r} must be < min(profile bbox)/2 = ${minDim / 2}. ` +
            `The upstream profile was resized after this fillet was created; ` +
            `reduce the radius or enlarge the profile.`,
        );
      }
    }
  } else {
    const minDist = minVertexToEdgeDistance(loop);
    for (let i = 0; i < radii.length; i++) {
      const r = radii[i]!;
      if (r >= minDist / 2) {
        throw new Error(
          `${where}: ${label(i)} ${r} must be < min(edge_distances)/2 = ${minDist / 2}. ` +
            `The upstream profile was resized after this fillet was created; ` +
            `reduce the radius or enlarge the profile.`,
        );
      }
    }
  }

  // Bound 3 — through-depth. Only the selections that round a cap consume
  // depth; 'vertical' extrudes the full depth and is unaffected.
  const touchesTopOrBottom =
    feature.edgeSelection === 'all' ||
    feature.edgeSelection === 'top' ||
    feature.edgeSelection === 'bottom';
  if (touchesTopOrBottom) {
    for (let i = 0; i < radii.length; i++) {
      const r = radii[i]!;
      if (r >= child.depth / 2) {
        throw new Error(
          `${where}: ${label(i)} ${r} must be < depth/2 = ${child.depth / 2} ` +
            `when filleting ${feature.edgeSelection} edges. ` +
            `The upstream body was thinned to ${child.depth} after this fillet ` +
            `was created; reduce the radius or thicken the body.`,
        );
      }
    }
  }
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
export function filletToScad(
  feature: FilletFeature,
  ctx?: EmitContext,
  selfId = 'fillet',
): string {
  const child = resolveFilletChild(feature, ctx, selfId);
  assertFilletBoundsAtEmit(feature, child, selfId);
  const r = feature.radius;
  const loop = child.loop;
  const depth = child.depth;
  const epsilon = 0.001; // sub-mm slab thickness used to seed the minkowski crown

  // ─── Phase 3 path: variable radius (rect-only — guarded by builder) ───
  if (feature.vertexRadii !== undefined) {
    return filletVariableRadiusToScad(feature, feature.vertexRadii, child);
  }

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

// ─── Phase 3 SCAD: variable radius (rect-only) ────────────────────────────

/**
 * Phase 3 variable-radius SCAD emission for an axis-aligned rect profile.
 *
 * Algorithm — hull() of corner primitives whose radii vary per corner:
 *
 *   'vertical': linear_extrude(depth) hull() { 4 circles, one per corner }
 *     Each circle is positioned at the inset corner (corner_xy ± r_i)
 *     with radius r_i. The 2D convex hull of four positive-radius circles,
 *     each tucked into one of the bbox corners, is exactly the original
 *     rectangle with corner i rounded by r_i.
 *
 *   'all': hull() { 8 spheres = 4 corners × {top,bottom} face }
 *     Each sphere is at (corner_xy ± r_i, r_i_or_(depth-r_i)) with radius
 *     r_i. The 3D convex hull is the full body with all 12 edges of the
 *     box rounded, where the top/bottom corner spheres share a radius
 *     within each column. (We deliberately use the *same* r_i for the
 *     top and bottom sphere of a column — variable radius along Z is not
 *     part of this Phase 3 cut.)
 *
 *   'top': union of (linear_extrude(depth - max_r) hull(4 circles)) +
 *          hull(4 top spheres, each at z = depth - r_i + r_i = depth).
 *     The bottom slab is the full rect at every Z below depth-max_r; the
 *     top "crown" is the hull of 4 spheres giving variable rounding to
 *     the top edges only. Both pieces share the same per-corner inset so
 *     the slab-to-crown seam is C0-continuous (no visible step).
 *
 *   'bottom': mirror of 'top'.
 *
 * Determinism: vertex traversal order follows loop[i], producing
 * identical SCAD for identical inputs (cache-key safe).
 *
 * Phase 3 limitation: For 'all' / 'top' / 'bottom' on a rect where the
 * 4 corner radii differ, the *vertical* edges between two corners with
 * different r_i are a smooth blend (the convex hull of two spheres of
 * different radii is a truncated cone surface). This matches the most
 * common "variable fillet" CAD semantics, but is *not* identical to an
 * OCCT BRepFilletAPI variable-radius blend along an edge — that one
 * follows the loft of a circular cross-section along the edge. The
 * difference is sub-visual for moderate radius variation and is called
 * out here for the Phase 4 wishlist (true edge-following variable
 * radius blends).
 */
function filletVariableRadiusToScad(
  feature: FilletFeature,
  vertexRadii: ReadonlyArray<number>,
  child: ExtrudeFeature,
): string {
  const loop = child.loop;
  const depth = child.depth;
  const edges = feature.edgeSelection;
  const bb = loopBoundingBox(loop);
  const header =
    `// NEXYFAB:FILLET vertexRadii=[${vertexRadii.map((v) => formatNum(v)).join(',')}] edges=${edges}`;

  // Per-corner inset positions: tuck each radius into its corner.
  // For an axis-aligned rect we know each loop vertex sits at one of
  // (minX/maxX) × (minY/maxY). We compute the inset corner as
  // (cornerX + sx*r_i, cornerY + sy*r_i) where sx, sy = ±1 pointing
  // toward the rect center.
  interface Inset {
    cx: number;
    cy: number;
    r: number;
  }
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  const insets: Inset[] = [];
  for (let i = 0; i < loop.length; i++) {
    const v = loop[i]!;
    const r_i = vertexRadii[i]!;
    const sx = v.x < cx ? 1 : -1;
    const sy = v.y < cy ? 1 : -1;
    insets.push({ cx: v.x + sx * r_i, cy: v.y + sy * r_i, r: r_i });
  }
  const maxR = vertexRadii.reduce((a, b) => Math.max(a, b), 0);

  if (edges === 'vertical') {
    const circles = insets
      .map(
        (it) =>
          `    translate([${formatNum(it.cx)}, ${formatNum(it.cy)}])\n` +
          `      circle(r=${formatNum(it.r)}, $fn=32);`,
      )
      .join('\n');
    return (
      `${header}\n` +
      `linear_extrude(height=${formatNum(depth)})\n` +
      `  hull() {\n` +
      `${circles}\n` +
      `  }`
    );
  }

  if (edges === 'all') {
    // 8 spheres = 4 corners × {bottom (z = r_i), top (z = depth - r_i)}
    const spheres: string[] = [];
    for (const it of insets) {
      spheres.push(
        `  translate([${formatNum(it.cx)}, ${formatNum(it.cy)}, ${formatNum(it.r)}])\n` +
          `    sphere(r=${formatNum(it.r)}, $fn=32);`,
      );
      spheres.push(
        `  translate([${formatNum(it.cx)}, ${formatNum(it.cy)}, ${formatNum(depth - it.r)}])\n` +
          `    sphere(r=${formatNum(it.r)}, $fn=32);`,
      );
    }
    return `${header}\n` + `hull() {\n` + spheres.join('\n') + `\n}`;
  }

  // 'top' or 'bottom' — slab + crown.
  // The bottom slab spans the entire rect from z=0 to z=depth-maxR (for
  // 'top') or from z=maxR to z=depth (for 'bottom'). The crown is the
  // hull of 4 spheres at the rounded face, giving variable top/bottom
  // edge rounding without introducing variable vertical-edge blending
  // (the slab edges stay sharp 90°).
  const w = bb.maxX - bb.minX;
  const h = bb.maxY - bb.minY;
  if (edges === 'top') {
    const slab =
      `  translate([${formatNum(bb.minX)}, ${formatNum(bb.minY)}, 0])\n` +
      `    cube([${formatNum(w)}, ${formatNum(h)}, ${formatNum(depth - maxR)}]);`;
    const crownSpheres = insets
      .map(
        (it) =>
          `    translate([${formatNum(it.cx)}, ${formatNum(it.cy)}, ${formatNum(depth - it.r)}])\n` +
          `      sphere(r=${formatNum(it.r)}, $fn=32);`,
      )
      .join('\n');
    return (
      `${header}\n` +
      `union() {\n` +
      `${slab}\n` +
      `  hull() {\n` +
      `${crownSpheres}\n` +
      `  }\n` +
      `}`
    );
  }

  // 'bottom'
  const slab =
    `  translate([${formatNum(bb.minX)}, ${formatNum(bb.minY)}, ${formatNum(maxR)}])\n` +
    `    cube([${formatNum(w)}, ${formatNum(h)}, ${formatNum(depth - maxR)}]);`;
  const crownSpheres = insets
    .map(
      (it) =>
        `    translate([${formatNum(it.cx)}, ${formatNum(it.cy)}, ${formatNum(it.r)}])\n` +
        `      sphere(r=${formatNum(it.r)}, $fn=32);`,
    )
    .join('\n');
  return (
    `${header}\n` +
    `union() {\n` +
    `${slab}\n` +
    `  hull() {\n` +
    `${crownSpheres}\n` +
    `  }\n` +
    `}`
  );
}
