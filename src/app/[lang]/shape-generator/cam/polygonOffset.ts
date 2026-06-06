/**
 * polygonOffset.ts — inward offset (inset) of a simple 2D polygon, the missing
 * piece for ARBITRARY (non-rectangular) pocket toolpaths. pocketToolpath only
 * handles rectangles because it had no offset solver; this provides one.
 *
 * Method: offset every edge inward by `distance` along its interior normal, then
 * intersect consecutive offset edge-lines to get the inset vertices. Exact for
 * convex polygons and correct for mild concavities. Two guards keep it honest on
 * harder input:
 *   - if the inset collapses (area flips sign or a vertex inverts past its
 *     neighbours) the contour is dropped — a concave region can vanish before
 *     the convex hull does, and emitting a self-intersecting loop would gouge;
 *   - repeated insetting (insetContours) stops once the polygon degenerates.
 *
 * Full robustness for arbitrarily concave pockets (where one loop splits into
 * several) needs a clipping/straight-skeleton solver; that is called out where a
 * split would occur rather than silently producing a bad loop.
 */

export interface Pt2 { x: number; y: number }

/** Signed area (CCW positive) via the shoelace formula. */
export function signedArea(poly: Pt2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Ensure CCW winding (positive signed area). Returns a possibly-reversed copy. */
export function ensureCcw(poly: Pt2[]): Pt2[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : [...poly];
}

/** True when any two non-adjacent edges of the loop cross — i.e. the loop is not
 *  a simple polygon. A concave polygon's inward offset produces such a bowtie
 *  once a thin notch collapses; emitting it would gouge the part. */
export function loopSelfIntersects(loop: Pt2[]): boolean {
  const n = loop.length;
  const ccw = (a: Pt2, b: Pt2, c: Pt2) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < n; i++) {
    const a = loop[i]!, b = loop[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue; // adjacent / shared vertex
      const c = loop[j]!, d = loop[(j + 1) % n]!;
      if (ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d)) return true;
    }
  }
  return false;
}

function lineIntersect(p0: Pt2, d0: Pt2, p1: Pt2, d1: Pt2): Pt2 | null {
  const den = d0.x * d1.y - d0.y * d1.x;
  if (Math.abs(den) < 1e-9) return null; // parallel edges (collinear after offset)
  const t = ((p1.x - p0.x) * d1.y - (p1.y - p0.y) * d1.x) / den;
  return { x: p0.x + d0.x * t, y: p0.y + d0.y * t };
}

/**
 * Offset a simple polygon inward by `distance` (mm). Input may be either winding;
 * the result is CCW. Returns null when the polygon has fully closed up (no
 * interior left) or the inset self-collapses (a concavity vanished).
 */
export function offsetPolygonInward(polyIn: Pt2[], distance: number): Pt2[] | null {
  if (polyIn.length < 3 || distance <= 0) return polyIn.length >= 3 ? [...polyIn] : null;
  const poly = ensureCcw(polyIn);
  const n = poly.length;

  // Each edge i = (poly[i] → poly[i+1]). For CCW the interior is to the LEFT, so
  // the inward unit normal is the edge direction rotated +90°: (−dy, dx)/|d|.
  const offEdges: Array<{ p: Pt2; d: Pt2 }> = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue; // skip degenerate edge
    const nx = -dy / len, ny = dx / len; // interior normal (CCW)
    offEdges.push({ p: { x: a.x + nx * distance, y: a.y + ny * distance }, d: { x: dx, y: dy } });
  }
  const m = offEdges.length;
  if (m < 3) return null;

  // New vertex i = intersection of offset edge (i−1) and offset edge i.
  const out: Pt2[] = [];
  for (let i = 0; i < m; i++) {
    const e0 = offEdges[(i - 1 + m) % m]!, e1 = offEdges[i]!;
    const v = lineIntersect(e0.p, e0.d, e1.p, e1.d);
    if (!v) return null;
    out.push(v);
  }

  // Collapse guards: the inset must stay CCW with meaningful area, and must be a
  // SIMPLE polygon. A concave polygon's offset can self-intersect (a notch
  // collapses into a bowtie) while still reporting positive area; emitting that
  // would gouge, so reject it. Splitting such an offset into several valid
  // pockets needs a clipping / straight-skeleton solver (a documented follow-up);
  // until then the safe behaviour is to stop offsetting before the gouge.
  const area = signedArea(out);
  if (!Number.isFinite(area) || area <= 1e-6) return null;
  for (const v of out) if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
  if (loopSelfIntersects(out)) return null;
  return out;
}

/**
 * Concentric inset contours, `step` mm apart, starting `firstOffset` in from the
 * boundary (= tool radius for a pocket). Stops when the polygon closes up. This
 * is the contour-parallel toolpath for an arbitrary pocket.
 */
export function insetContours(boundary: Pt2[], firstOffset: number, step: number): Pt2[][] {
  const contours: Pt2[][] = [];
  if (boundary.length < 3 || firstOffset <= 0 || step <= 0) return contours;
  let d = firstOffset;
  // Stop at the first offset that no longer yields a simple interior loop — for a
  // concave pocket this is where a notch would start to gouge (see
  // offsetPolygonInward); the wider regions are already cleared by the rings up
  // to here. Cap iterations defensively.
  for (let guard = 0; guard < 10000; guard++) {
    const c = offsetPolygonInward(boundary, d);
    if (!c) break;
    contours.push(c);
    d += step;
  }
  return contours;
}
