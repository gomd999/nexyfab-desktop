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

// ── Topology-aware offset (handles concave splits / collapses) ──────────────

/** Distance from point p to segment ab. */
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Min distance from p to the polygon's boundary (over all edges as segments). */
function distToBoundary(poly: Pt2[], px: number, py: number): number {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const dd = distToSeg(px, py, a.x, a.y, b.x, b.y);
    if (dd < m) m = dd;
  }
  return m;
}

/** Even-odd point-in-polygon. */
function pointInPoly(poly: Pt2[], px: number, py: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Drop interior points that are collinear with their neighbours. */
function simplifyCollinear(loop: Pt2[], tol = 1e-6): Pt2[] {
  if (loop.length < 3) return loop;
  const out: Pt2[] = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[(i - 1 + n) % n]!, b = loop[i]!, c = loop[(i + 1) % n]!;
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const scale = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y);
    if (Math.abs(cross) > tol * Math.max(scale, 1)) out.push(b);
  }
  return out.length >= 3 ? out : loop;
}

/** Signed distance to the source: +inside, −outside, zero on the boundary. */
function signedDist(poly: Pt2[], px: number, py: number): number {
  const d = distToBoundary(poly, px, py);
  return pointInPoly(poly, px, py) ? d : -d;
}

/** Marching-squares segment table. Corner bits: 1=BL, 2=BR, 4=TR, 8=TL (a
 *  corner bit is set when its field value is ≥ 0). Each entry lists segments as
 *  pairs of cell-edge ids: 0=bottom, 1=right, 2=top, 3=left. Saddles (5,10) are
 *  resolved by the caller using the cell-centre sign. */
const MS_TABLE: number[][][] = [
  [], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [], [[0, 2]], [[3, 2]],
  [[2, 3]], [[2, 0]], [], [[2, 1]], [[1, 3]], [[1, 0]], [[0, 3]], [],
];

/** Extract the closed boundary loops of the region { signedDist ≥ distance }
 *  via marching squares on a regular grid. Robust to any topology — splits,
 *  collapses, multiple components — at the cost of a resolution-limited result. */
function marchingSquaresOffset(poly: Pt2[], distance: number, res: number): Pt2[][] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  // Pad by one cell so the region never touches the grid border (→ closed loops).
  minX -= res; minY -= res; maxX += res; maxY += res;
  const nx = Math.min(2000, Math.max(2, Math.ceil((maxX - minX) / res)));
  const ny = Math.min(2000, Math.max(2, Math.ceil((maxY - minY) / res)));
  const dx = (maxX - minX) / nx, dy = (maxY - minY) / ny;

  // Field f = signedDist − distance, sampled at every grid node.
  const f: number[] = new Array((nx + 1) * (ny + 1));
  const at = (i: number, j: number) => f[j * (nx + 1) + i]!;
  for (let j = 0; j <= ny; j++) {
    const y = minY + j * dy;
    for (let i = 0; i <= nx; i++) {
      f[j * (nx + 1) + i] = signedDist(poly, minX + i * dx, y) - distance;
    }
  }

  // Per cell, emit contour segments where f crosses 0.
  const segs: Array<[Pt2, Pt2]> = [];
  const lerp = (xa: number, ya: number, va: number, xb: number, yb: number, vb: number): Pt2 => {
    const t = va / (va - vb);
    return { x: xa + (xb - xa) * t, y: ya + (yb - ya) * t };
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = minX + i * dx, y0 = minY + j * dy, x1 = x0 + dx, y1 = y0 + dy;
      const v00 = at(i, j), v10 = at(i + 1, j), v11 = at(i + 1, j + 1), v01 = at(i, j + 1);
      let ci = 0;
      if (v00 >= 0) ci |= 1; if (v10 >= 0) ci |= 2; if (v11 >= 0) ci |= 4; if (v01 >= 0) ci |= 8;
      if (ci === 0 || ci === 15) continue;
      // Edge crossing points (only computed when that edge actually flips).
      const edgePt = (e: number): Pt2 => {
        switch (e) {
          case 0: return lerp(x0, y0, v00, x1, y0, v10); // bottom
          case 1: return lerp(x1, y0, v10, x1, y1, v11); // right
          case 2: return lerp(x0, y1, v01, x1, y1, v11); // top
          default: return lerp(x0, y0, v00, x0, y1, v01); // left
        }
      };
      let pairs = MS_TABLE[ci]!;
      if (ci === 5 || ci === 10) {
        const center = (v00 + v10 + v11 + v01) / 4;
        // Connect so the positive region stays consistent across the saddle.
        if (ci === 5) pairs = center >= 0 ? [[3, 2], [1, 0]] : [[3, 0], [1, 2]];
        else pairs = center >= 0 ? [[2, 1], [0, 3]] : [[0, 1], [2, 3]];
      }
      for (const [ea, eb] of pairs) segs.push([edgePt(ea), edgePt(eb)]);
    }
  }
  if (segs.length === 0) return [];

  // Chain the undirected segments into closed loops by endpoint matching.
  const q = Math.max(res * 1e-4, 1e-9);
  const key = (p: Pt2) => `${Math.round(p.x / q)}_${Math.round(p.y / q)}`;
  const adj = new Map<string, Array<{ to: string; pt: Pt2; seg: number }>>();
  const pts = new Map<string, Pt2>();
  segs.forEach(([a, b], s) => {
    const ka = key(a), kb = key(b);
    pts.set(ka, a); pts.set(kb, b);
    (adj.get(ka) ?? adj.set(ka, []).get(ka)!).push({ to: kb, pt: b, seg: s });
    (adj.get(kb) ?? adj.set(kb, []).get(kb)!).push({ to: ka, pt: a, seg: s });
  });
  const usedSeg = new Array(segs.length).fill(false);
  const loops: Pt2[][] = [];
  for (let s = 0; s < segs.length; s++) {
    if (usedSeg[s]) continue;
    const loop: Pt2[] = [];
    let curKey = key(segs[s]![0]);
    const startKey = curKey;
    loop.push(pts.get(curKey)!);
    let guard = 0;
    while (guard++ < segs.length + 5) {
      const nbrs = adj.get(curKey);
      if (!nbrs) break;
      const next = nbrs.find(e => !usedSeg[e.seg]);
      if (!next) break;
      usedSeg[next.seg] = true;
      loop.push(next.pt);
      curKey = next.to;
      if (curKey === startKey) break;
    }
    const simp = simplifyCollinear(ensureCcw(loop));
    if (simp.length >= 3 && signedArea(simp) > res * res) loops.push(simp);
  }
  return loops;
}

/**
 * Topology-aware inward offset. Where `offsetPolygonInward` rejects any
 * self-intersecting result, this resolves the topology so the hard concave
 * cases come out correct instead of dropped:
 *   - a thin neck pinches off  → the pocket splits into SEVERAL valid loops;
 *   - a notch collapses inward → the over-run middle vanishes and the
 *                                salvageable side regions are each kept.
 *
 * Method: contour the region { distance-to-boundary ≥ `distance`, inside } with
 * marching squares on a distance-field grid (cell ≈ `opts.resolution`, default
 * `distance/10`). That is topology-exact (any number of resulting pockets,
 * including a clean pinch-off) but geometrically resolution-limited — the
 * boundary is piecewise-linear at grid scale, not an analytic straight skeleton.
 * Returns every offset pocket as a CCW loop.
 */
export function offsetPolygonInwardMulti(
  polyIn: Pt2[], distance: number, opts: { resolution?: number } = {},
): Pt2[][] {
  if (polyIn.length < 3) return [];
  if (distance <= 0) return [ensureCcw(polyIn)];
  const poly = ensureCcw(polyIn);
  const res = Math.max(opts.resolution ?? distance / 10, 1e-3);
  return marchingSquaresOffset(poly, distance, res);
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

/**
 * Topology-aware concentric inset. Like `insetContours` but uses
 * `offsetPolygonInwardMulti`, so a concave pocket that pinches into separate
 * regions keeps being cleared on both sides instead of stopping at the pinch.
 * Each entry is one CCW loop; a single depth can contribute several. Stops once
 * a depth produces no loops at all.
 */
export function insetContoursMulti(boundary: Pt2[], firstOffset: number, step: number): Pt2[][] {
  const contours: Pt2[][] = [];
  if (boundary.length < 3 || firstOffset <= 0 || step <= 0) return contours;
  let d = firstOffset;
  for (let guard = 0; guard < 10000; guard++) {
    const loops = offsetPolygonInwardMulti(boundary, d);
    if (loops.length === 0) break;
    for (const l of loops) contours.push(l);
    d += step;
  }
  return contours;
}
