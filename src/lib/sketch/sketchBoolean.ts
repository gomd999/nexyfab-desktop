/**
 * sketchBoolean — 2D boolean operations on closed sketch loops.
 *
 * Phase 1.B of NexyFab Pro own-CAD (ADR-013).
 *
 * Supports union / subtract / intersect on simple closed 2D polygons. Loops
 * are arrays of `{x, y}` vertices in either order (we normalize to CCW
 * internally). The result is one or more loops in CCW order.
 *
 * ─── Algorithm choice (Phase 1) ────────────────────────────────────────────
 *
 * Phase 1 deliberately restricts inputs to *simple* (non-self-intersecting,
 * no-holes) polygons; in practice the most common case is convex profiles
 * (rectangles, regular polygons, the sketch primitives produced by
 * SketchSolver). For convex polygons:
 *
 *   - INTERSECT uses **Sutherland-Hodgman** polygon clipping. With a convex
 *     clip polygon the algorithm is exact and simple (≈30 LOC). When the
 *     subject is also convex the result is also convex and unique.
 *
 *   - UNION / SUBTRACT use a **Greiner-Hormann-lite** edge traversal:
 *     1. Find all edge-edge intersection points between A and B.
 *     2. Splice them into both perimeters as virtual vertices.
 *     3. Walk the perimeters switching at intersections according to the
 *        operation (union = stay outside; subtract = stay outside A ∪ inside B
 *        is removed).
 *
 * For *disjoint* inputs (bbox check), short-circuits:
 *   union(A, B)     → [A, B]
 *   subtract(A, B)  → [A]
 *   intersect(A, B) → []
 *
 * For one-fully-inside-the-other (containment check on a single vertex):
 *   union(A inside B)     → [B]
 *   subtract(A inside B)  → [] (A entirely removed)
 *   subtract(B inside A)  → A with a hole (Phase 1 limitation: hole is
 *                                returned as a separate CW loop; consumers
 *                                need to interpret this as "outer CCW,
 *                                inner CW" the way OpenSCAD's polygon()
 *                                already does — see extrudeProfile.ts).
 *   intersect(A inside B) → [A]
 *
 * ─── Phase 1 limitations (Phase 2 wishlist) ────────────────────────────────
 *
 *   - Non-convex inputs may produce incorrect topology for union/subtract
 *     when intersection traversal doubles back through a concave pocket.
 *     Convex inputs are guaranteed correct; non-convex inputs that don't
 *     induce ambiguous traversal also work in practice.
 *
 *   - Input polygons with holes are not supported. Caller must perform any
 *     hole bookkeeping outside this module.
 *
 *   - Degenerate cases (edge-on-edge overlap, vertex-on-edge touch without
 *     crossing) are detected and short-circuit to a safe fallback (return
 *     untouched copies) rather than producing malformed output.
 *
 *   - Tolerance-based vertex coincidence dedup uses a fixed `eps` (default
 *     1e-6); inputs with sub-tolerance feature size will quantize.
 *
 *   Phase 2 candidates:
 *     - Vendor martinez-polygon-clipping or polygon-clipping for full
 *       non-convex + holes + multi-result support.
 *     - Add IR-level Hole / Outer flag on the result so callers don't have
 *       to inspect orientation.
 *     - Add `unionMany`, `subtractMany` for N-ary inputs (Phase 2 features
 *       in extrudeProfile already imply multi-profile inputs).
 *     - Self-intersection detection + auto-decomposition.
 *
 * ─── Pure functions ────────────────────────────────────────────────────────
 *
 * All exports are pure — no I/O, no global state, no mutation of input
 * arrays. Inputs are `ReadonlyArray`, outputs are fresh arrays.
 */

// ─── public types ─────────────────────────────────────────────────────────

export type Point2 = { readonly x: number; readonly y: number };
export type SketchLoop = ReadonlyArray<Point2>;

export interface BooleanOptions {
  /** Tolerance for vertex coincidence (mm). Default 1e-6. */
  eps?: number;
}

const DEFAULT_EPS = 1e-6;

// ─── small geometric helpers ──────────────────────────────────────────────

function eq(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}

function ptEq(a: Point2, b: Point2, eps: number): boolean {
  return eq(a.x, b.x, eps) && eq(a.y, b.y, eps);
}

/**
 * Strip a trailing duplicate vertex (closing point) so internal algorithms
 * see a unique vertex list. Returns a fresh array.
 */
function stripClosing(loop: SketchLoop, eps: number): Point2[] {
  if (loop.length === 0) return [];
  const out: Point2[] = loop.map((p) => ({ x: p.x, y: p.y }));
  while (out.length > 1 && ptEq(out[0]!, out[out.length - 1]!, eps)) {
    out.pop();
  }
  return out;
}

/**
 * Signed area of a polygon (shoelace). Positive = CCW, negative = CW.
 * Works on open loop arrays (no closing vertex required).
 */
function signedArea(verts: ReadonlyArray<Point2>): number {
  const n = verts.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % n]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Bounding box. */
function bbox(verts: ReadonlyArray<Point2>): {
  minX: number; maxX: number; minY: number; maxY: number;
} {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of verts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

/** True if the two bboxes overlap (inclusive of touching edges, within eps). */
function bboxesOverlap(a: ReadonlyArray<Point2>, b: ReadonlyArray<Point2>, eps: number): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const A = bbox(a);
  const B = bbox(b);
  if (A.maxX < B.minX - eps) return false;
  if (B.maxX < A.minX - eps) return false;
  if (A.maxY < B.minY - eps) return false;
  if (B.maxY < A.minY - eps) return false;
  return true;
}

/**
 * Point-in-polygon test (ray casting). `verts` must be the open vertex
 * list (no trailing duplicate). Robust for the polygon interior; vertices
 * lying exactly on the boundary are reported ambiguously per ray casting
 * convention — callers needing certainty should sample an interior point.
 */
function pointInPolygon(p: Point2, verts: ReadonlyArray<Point2>): boolean {
  const n = verts.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = verts[i]!;
    const b = verts[j]!;
    const intersect =
      ((a.y > p.y) !== (b.y > p.y)) &&
      (p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** True if every vertex of `inner` lies inside `outer`. */
function loopInsideLoop(inner: ReadonlyArray<Point2>, outer: ReadonlyArray<Point2>): boolean {
  if (inner.length === 0 || outer.length < 3) return false;
  for (const p of inner) {
    if (!pointInPolygon(p, outer)) return false;
  }
  return true;
}

/**
 * Loose equality test: two loops describe the same polygon up to vertex
 * ordering and starting vertex.
 *
 * Phase 1 covers identical-input fast-paths; for full polygon-equivalence
 * (rotations, reflections, re-parameterized arcs) defer to Phase 2.
 */
function loopsCoincident(a: ReadonlyArray<Point2>, b: ReadonlyArray<Point2>, eps: number): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  const n = a.length;
  // Find b's index that matches a[0], try both rotations and reverse.
  for (let start = 0; start < n; start++) {
    if (!ptEq(a[0]!, b[start]!, eps)) continue;
    let allMatch = true;
    for (let i = 0; i < n; i++) {
      if (!ptEq(a[i]!, b[(start + i) % n]!, eps)) { allMatch = false; break; }
    }
    if (allMatch) return true;
  }
  return false;
}

// ─── public helpers ───────────────────────────────────────────────────────

/**
 * Check whether a loop is closed (last vertex coincides with the first).
 * Empty / single-vertex loops are considered NOT closed.
 */
export function isLoopClosed(loop: SketchLoop, eps: number = DEFAULT_EPS): boolean {
  if (loop.length < 2) return false;
  return ptEq(loop[0]!, loop[loop.length - 1]!, eps);
}

/**
 * Polygon orientation via shoelace signed area. Trailing closing vertex
 * (if present) is ignored.
 */
export function loopOrientation(loop: SketchLoop): 'cw' | 'ccw' | 'degenerate' {
  const verts = stripClosing(loop, DEFAULT_EPS);
  if (verts.length < 3) return 'degenerate';
  const s = signedArea(verts);
  if (Math.abs(s) < DEFAULT_EPS * DEFAULT_EPS) return 'degenerate';
  return s > 0 ? 'ccw' : 'cw';
}

/**
 * Return a fresh loop in CCW orientation. If already CCW returns a copy.
 * Degenerate inputs are returned as a stripped copy unchanged.
 *
 * If the input was closed (had a duplicated closing vertex), the result is
 * also closed (closing vertex appended) — so round-tripping is stable.
 */
export function toCcw(loop: SketchLoop): SketchLoop {
  const wasClosed = isLoopClosed(loop);
  const verts = stripClosing(loop, DEFAULT_EPS);
  const orient = loopOrientation(verts);
  const out = orient === 'cw' ? verts.slice().reverse() : verts.slice();
  if (wasClosed && out.length > 0) {
    out.push({ x: out[0]!.x, y: out[0]!.y });
  }
  return out;
}

// ─── Sutherland-Hodgman polygon clipping ──────────────────────────────────

/**
 * Sutherland-Hodgman: clip `subject` against `clip` (must be convex).
 * Both inputs are open vertex lists in CCW order. Returns the clipped
 * polygon as an open CCW vertex list, or [] if the result is empty.
 *
 * For convex × convex the result is always either empty or a single convex
 * polygon — exactly what intersect() needs for Phase 1.
 */
function sutherlandHodgman(
  subject: ReadonlyArray<Point2>,
  clip: ReadonlyArray<Point2>,
  eps: number,
): Point2[] {
  if (subject.length < 3 || clip.length < 3) return [];
  let output: Point2[] = subject.map((p) => ({ x: p.x, y: p.y }));
  const clipN = clip.length;

  for (let i = 0; i < clipN; i++) {
    if (output.length === 0) break;
    const a = clip[i]!;
    const b = clip[(i + 1) % clipN]!;
    const input = output;
    output = [];
    const inputN = input.length;
    for (let k = 0; k < inputN; k++) {
      const cur = input[k]!;
      const prev = input[(k - 1 + inputN) % inputN]!;
      const curIn = isInsideEdge(cur, a, b, eps);
      const prevIn = isInsideEdge(prev, a, b, eps);
      if (curIn) {
        if (!prevIn) {
          const xs = lineIntersect(prev, cur, a, b);
          if (xs) output.push(xs);
        }
        output.push(cur);
      } else if (prevIn) {
        const xs = lineIntersect(prev, cur, a, b);
        if (xs) output.push(xs);
      }
    }
  }

  return dedupConsecutive(output, eps);
}

/**
 * "Inside" for CCW clip polygon edge a→b: point is on the left of (or on)
 * the directed line a→b. cross > -eps.
 */
function isInsideEdge(p: Point2, a: Point2, b: Point2, eps: number): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return cross > -eps;
}

/**
 * Infinite-line intersection of (p1→p2) with (p3→p4). Returns null when
 * the lines are parallel (no unique intersection).
 */
function lineIntersect(p1: Point2, p2: Point2, p3: Point2, p4: Point2): Point2 | null {
  const x1 = p1.x, y1 = p1.y;
  const x2 = p2.x, y2 = p2.y;
  const x3 = p3.x, y3 = p3.y;
  const x4 = p4.x, y4 = p4.y;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (denom === 0) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

/**
 * Segment-segment intersection. Returns the intersection point (and the
 * parametric position `tA` along segment A) when the two segments cross
 * strictly within their interiors; null otherwise.
 */
function segmentIntersect(
  a1: Point2, a2: Point2, b1: Point2, b2: Point2, eps: number,
): { p: Point2; tA: number; tB: number } | null {
  const rx = a2.x - a1.x, ry = a2.y - a1.y;
  const sx = b2.x - b1.x, sy = b2.y - b1.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < eps * eps) return null; // parallel or collinear
  const dx = b1.x - a1.x, dy = b1.y - a1.y;
  const tA = (dx * sy - dy * sx) / denom;
  const tB = (dx * ry - dy * rx) / denom;
  if (tA < -eps || tA > 1 + eps) return null;
  if (tB < -eps || tB > 1 + eps) return null;
  return {
    p: { x: a1.x + tA * rx, y: a1.y + tA * ry },
    tA: Math.max(0, Math.min(1, tA)),
    tB: Math.max(0, Math.min(1, tB)),
  };
}

/** Remove consecutive duplicates (and final-equals-first wrap). */
function dedupConsecutive(verts: Point2[], eps: number): Point2[] {
  if (verts.length === 0) return verts;
  const out: Point2[] = [verts[0]!];
  for (let i = 1; i < verts.length; i++) {
    if (!ptEq(out[out.length - 1]!, verts[i]!, eps)) out.push(verts[i]!);
  }
  while (out.length > 1 && ptEq(out[0]!, out[out.length - 1]!, eps)) out.pop();
  return out;
}

// ─── Greiner-Hormann-lite traversal for union / subtract ──────────────────

/**
 * A vertex within the merged polygon graph. `original=true` means it was a
 * vertex of the input polygon; `false` means it was inserted at an edge
 * crossing. `partner` is the matching vertex index on the other polygon
 * (only set when !original).
 */
interface GraphNode {
  p: Point2;
  /** True for a vertex from the original input. */
  original: boolean;
  /** Whether this vertex is inside the *other* polygon (only set after computeInsideness). */
  inside: boolean;
  /** Index of the matching node in the other polygon's array (intersections only). */
  partner: number;
  /** Whether traversal already visited this node (mutated during walk). */
  visited: boolean;
  /** Whether this intersection is an actual transition (entry/exit), not a tangent touch. */
  crossing: boolean;
}

/**
 * Insert intersection points into both polygons' vertex chains, linking
 * matching pairs by index. Result preserves polygon traversal order.
 */
function buildIntersectionGraph(
  a: ReadonlyArray<Point2>,
  b: ReadonlyArray<Point2>,
  eps: number,
): { aNodes: GraphNode[]; bNodes: GraphNode[]; crossings: number } {
  // Each polygon becomes a list of { p, original, ... }. We first build the
  // unaugmented arrays, then per edge of A find all intersections with B,
  // splice them in (sorted by tA), and mirror into B.
  type EdgeIntersection = {
    p: Point2; tA: number; tB: number;
    aEdgeIdx: number; bEdgeIdx: number;
  };
  const xs: EdgeIntersection[] = [];
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j]!;
      const b2 = b[(j + 1) % b.length]!;
      const xi = segmentIntersect(a1, a2, b1, b2, eps);
      if (xi) {
        xs.push({ p: xi.p, tA: xi.tA, tB: xi.tB, aEdgeIdx: i, bEdgeIdx: j });
      }
    }
  }

  // Build a-side chain: walk original a-edges, splicing in sorted intersections.
  const aNodes: GraphNode[] = [];
  // Each a-vertex anchors an output. We also remember each intersection's
  // index in aNodes so we can mirror to bNodes.
  const xsByA = new Map<number, EdgeIntersection[]>();
  for (const x of xs) {
    const arr = xsByA.get(x.aEdgeIdx) ?? [];
    arr.push(x);
    xsByA.set(x.aEdgeIdx, arr);
  }
  for (const arr of xsByA.values()) arr.sort((p, q) => p.tA - q.tA);

  // Record (aEdgeIdx, slotInEdge) → aNodes index for each intersection so
  // we can look it up when building bNodes.
  const xIndexInA = new Map<EdgeIntersection, number>();

  for (let i = 0; i < a.length; i++) {
    aNodes.push({
      p: { x: a[i]!.x, y: a[i]!.y },
      original: true,
      inside: false,
      partner: -1,
      visited: false,
      crossing: false,
    });
    const arr = xsByA.get(i);
    if (arr) {
      for (const x of arr) {
        const idx = aNodes.length;
        // Skip a duplicate intersection that coincides with the previous
        // node (avoids zero-length splices that confuse traversal).
        if (ptEq(aNodes[aNodes.length - 1]!.p, x.p, eps)) {
          xIndexInA.set(x, aNodes.length - 1);
          // Promote the colliding vertex to an intersection link too.
          aNodes[aNodes.length - 1]!.original = aNodes[aNodes.length - 1]!.original; // unchanged
          continue;
        }
        aNodes.push({
          p: x.p,
          original: false,
          inside: false,
          partner: -1,
          visited: false,
          crossing: true,
        });
        xIndexInA.set(x, idx);
      }
    }
  }

  // Build b-side chain similarly, sorting by tB per b-edge.
  const xsByB = new Map<number, EdgeIntersection[]>();
  for (const x of xs) {
    const arr = xsByB.get(x.bEdgeIdx) ?? [];
    arr.push(x);
    xsByB.set(x.bEdgeIdx, arr);
  }
  for (const arr of xsByB.values()) arr.sort((p, q) => p.tB - q.tB);

  const bNodes: GraphNode[] = [];
  for (let j = 0; j < b.length; j++) {
    bNodes.push({
      p: { x: b[j]!.x, y: b[j]!.y },
      original: true,
      inside: false,
      partner: -1,
      visited: false,
      crossing: false,
    });
    const arr = xsByB.get(j);
    if (arr) {
      for (const x of arr) {
        const aIdx = xIndexInA.get(x);
        if (aIdx === undefined) continue;
        if (ptEq(bNodes[bNodes.length - 1]!.p, x.p, eps)) {
          // Collision with previous b-vertex: link partner there.
          bNodes[bNodes.length - 1]!.partner = aIdx;
          aNodes[aIdx]!.partner = bNodes.length - 1;
          continue;
        }
        const bIdx = bNodes.length;
        bNodes.push({
          p: x.p,
          original: false,
          inside: false,
          partner: aIdx,
          visited: false,
          crossing: true,
        });
        aNodes[aIdx]!.partner = bIdx;
      }
    }
  }

  // Mark insideness of every node in aNodes w.r.t. b's polygon (open b
  // vertex list), and vice versa. For intersection nodes we treat them as
  // boundary points — set inside = false (boundary).
  for (const n of aNodes) {
    if (n.original) {
      n.inside = pointInPolygon(n.p, b);
    } else {
      n.inside = false;
    }
  }
  for (const n of bNodes) {
    if (n.original) {
      n.inside = pointInPolygon(n.p, a);
    } else {
      n.inside = false;
    }
  }

  // Count usable crossings (those with valid partners).
  let crossings = 0;
  for (const n of aNodes) if (!n.original && n.partner >= 0) crossings++;

  return { aNodes, bNodes, crossings };
}

/**
 * Generic traversal driver. `mode` selects the boolean operation:
 *
 *   union:     start at an A-vertex outside B; on a crossing, switch to
 *              the other polygon; output the perimeter that's *outside*
 *              the other polygon.
 *   subtract:  output A's perimeter outside B; on a crossing, jump into B
 *              and traverse it **in reverse** to skirt the removed pocket.
 *   intersect: output A's perimeter inside B; on a crossing, switch to B.
 *
 * Returns one or more CCW loops. Each polygon traversal must form a
 * closed cycle — we collect every disjoint cycle by re-seeding from any
 * unvisited starting node.
 */
function traverse(
  aNodes: GraphNode[],
  bNodes: GraphNode[],
  mode: 'union' | 'subtract' | 'intersect',
  eps: number,
): Point2[][] {
  const results: Point2[][] = [];

  // Helper: starting condition per mode.
  //   union     → start at an A-original vertex that is OUTSIDE b
  //   intersect → start at an A-original vertex that is INSIDE b
  //   subtract  → start at an A-original vertex that is OUTSIDE b
  const wantInside = mode === 'intersect';

  // Build a quick lookup of starting candidates among A-original vertices.
  const seedNeeded = (n: GraphNode): boolean =>
    n.original && !n.visited && n.inside === wantInside;

  // Walk one cycle starting at aNodes[startIdx].
  const walkCycle = (startIdx: number): Point2[] => {
    const out: Point2[] = [];
    let onA = true;
    let idx = startIdx;
    let safety = (aNodes.length + bNodes.length) * 2 + 4;
    while (safety-- > 0) {
      const cur = onA ? aNodes[idx]! : bNodes[idx]!;
      if (cur.visited) break;
      cur.visited = true;
      // Mirror visited bit onto the partner so we don't revisit the same
      // crossing twice when arriving from the other polygon.
      if (cur.partner >= 0) {
        const partner = onA ? bNodes[cur.partner]! : aNodes[cur.partner]!;
        partner.visited = true;
      }
      if (out.length === 0 || !ptEq(out[out.length - 1]!, cur.p, eps)) {
        out.push(cur.p);
      }
      // Should we switch polygon? Only when we hit an intersection node
      // with a valid partner (crossing transition).
      const shouldSwitch = !cur.original && cur.partner >= 0 && cur.crossing;
      if (shouldSwitch) {
        const nextIdx = cur.partner;
        const nextArr = onA ? bNodes : aNodes;
        // For subtract: traverse B in REVERSE so we carve out a pocket.
        // Implement reverse by advancing index by -1 instead of +1.
        onA = !onA;
        idx = nextIdx;
        const dir = mode === 'subtract' && !onA ? -1 : +1;
        idx = (idx + dir + nextArr.length) % nextArr.length;
      } else {
        const arr = onA ? aNodes : bNodes;
        // For subtract while on B (we were carved through), traverse in reverse.
        const dir = mode === 'subtract' && !onA ? -1 : +1;
        idx = (idx + dir + arr.length) % arr.length;
      }
      // Detect cycle close.
      const seed = onA ? aNodes[idx] : bNodes[idx];
      if (seed && seed.visited && out.length > 0 && ptEq(out[0]!, seed.p, eps)) {
        break;
      }
    }
    return dedupConsecutive(out, eps);
  };

  for (let i = 0; i < aNodes.length; i++) {
    if (seedNeeded(aNodes[i]!)) {
      const cycle = walkCycle(i);
      if (cycle.length >= 3) results.push(cycle);
    }
  }
  return results;
}

// ─── public boolean operations ────────────────────────────────────────────

/**
 * Polygon union: A ∪ B. Returns one combined loop when the inputs overlap,
 * or `[A, B]` when they are disjoint. Inputs and outputs are CCW.
 */
export function unionLoops(
  a: SketchLoop,
  b: SketchLoop,
  opts: BooleanOptions = {},
): SketchLoop[] {
  const eps = opts.eps ?? DEFAULT_EPS;
  const A = stripClosing(toCcw(a), eps);
  const B = stripClosing(toCcw(b), eps);
  if (A.length < 3 || B.length < 3) {
    return [A, B].filter((l) => l.length >= 3);
  }
  if (!bboxesOverlap(A, B, eps)) {
    return [A, B];
  }
  // Identical-loop fast path.
  if (loopsCoincident(A, B, eps)) return [A];
  // Containment short-circuits.
  if (loopInsideLoop(A, B)) return [B];
  if (loopInsideLoop(B, A)) return [A];

  const { aNodes, bNodes, crossings } = buildIntersectionGraph(A, B, eps);
  if (crossings === 0) {
    // Bboxes overlapped but no true edge crossings (e.g. only touched at a
    // single vertex). Treat as disjoint.
    return [A, B];
  }
  const loops = traverse(aNodes, bNodes, 'union', eps);
  if (loops.length === 0) {
    // Fallback: return inputs untouched rather than producing a corrupt result.
    return [A, B];
  }
  // Ensure CCW (traversal preserves CCW for convex inputs but be safe).
  return loops.map((l) => stripClosing(toCcw(l), eps));
}

/**
 * Polygon subtract: A − B. Returns A with B's overlap removed. When B is
 * fully inside A the result is one outer CCW loop plus the carved hole as
 * a CW loop (caller decides how to consume holes — see module preamble).
 */
export function subtractLoops(
  a: SketchLoop,
  b: SketchLoop,
  opts: BooleanOptions = {},
): SketchLoop[] {
  const eps = opts.eps ?? DEFAULT_EPS;
  const A = stripClosing(toCcw(a), eps);
  const B = stripClosing(toCcw(b), eps);
  if (A.length < 3) return [];
  if (B.length < 3) return [A];
  if (!bboxesOverlap(A, B, eps)) {
    return [A];
  }
  // Identical loops → A − A = ∅.
  if (loopsCoincident(A, B, eps)) return [];
  // A fully inside B → A is entirely removed.
  if (loopInsideLoop(A, B)) return [];
  // B fully inside A → A with hole. Return [A_ccw, B_reversed_as_cw_hole].
  if (loopInsideLoop(B, A)) {
    return [A, B.slice().reverse()];
  }

  const { aNodes, bNodes, crossings } = buildIntersectionGraph(A, B, eps);
  if (crossings === 0) {
    return [A];
  }
  const loops = traverse(aNodes, bNodes, 'subtract', eps);
  if (loops.length === 0) {
    return [A];
  }
  return loops.map((l) => stripClosing(toCcw(l), eps));
}

/**
 * Polygon intersection: A ∩ B. Empty when disjoint. Uses Sutherland-Hodgman
 * directly when B is convex (Phase 1's common case); otherwise falls back
 * to the same intersection-graph traversal.
 */
export function intersectLoops(
  a: SketchLoop,
  b: SketchLoop,
  opts: BooleanOptions = {},
): SketchLoop[] {
  const eps = opts.eps ?? DEFAULT_EPS;
  const A = stripClosing(toCcw(a), eps);
  const B = stripClosing(toCcw(b), eps);
  if (A.length < 3 || B.length < 3) return [];
  if (!bboxesOverlap(A, B, eps)) return [];
  if (loopsCoincident(A, B, eps)) return [A];
  if (loopInsideLoop(A, B)) return [A];
  if (loopInsideLoop(B, A)) return [B];

  // Sutherland-Hodgman path (works whenever the clip — B — is convex).
  if (isConvex(B, eps)) {
    const clipped = sutherlandHodgman(A, B, eps);
    if (clipped.length >= 3) return [clipped];
    return [];
  }
  // Non-convex fallback: try clipping in the reverse direction.
  if (isConvex(A, eps)) {
    const clipped = sutherlandHodgman(B, A, eps);
    if (clipped.length >= 3) return [clipped];
    return [];
  }
  // Phase 1 limitation: non-convex × non-convex intersect. Use traversal.
  const { aNodes, bNodes, crossings } = buildIntersectionGraph(A, B, eps);
  if (crossings === 0) return [];
  const loops = traverse(aNodes, bNodes, 'intersect', eps);
  return loops.map((l) => stripClosing(toCcw(l), eps));
}

/**
 * True if the polygon is convex (all consecutive cross-products have the
 * same sign). Assumes `verts` is the open vertex list with no closing
 * vertex.
 */
function isConvex(verts: ReadonlyArray<Point2>, eps: number): boolean {
  const n = verts.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % n]!;
    const c = verts[(i + 2) % n]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < eps) continue; // collinear vertex, skip
    if (sign === 0) sign = cross > 0 ? 1 : -1;
    else if ((cross > 0 ? 1 : -1) !== sign) return false;
  }
  return true;
}
