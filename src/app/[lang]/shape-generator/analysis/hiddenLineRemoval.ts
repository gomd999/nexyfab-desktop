/**
 * hiddenLineRemoval.ts — TRUE hidden-line removal for 2D engineering views.
 *
 * The orthographic projector in autoDrawing classifies an edge visible/hidden by
 * its adjacent FACE NORMALS (a silhouette/front-face heuristic). That cannot see
 * occlusion: an edge whose own faces point at the viewer is still hidden if
 * another part of the solid sits in front of it (the back rim of a counterbore,
 * a boss behind a wall, one body shadowing another). This module does the real
 * thing — depth occlusion against the mesh — and splits each edge into the
 * visible and hidden runs.
 *
 * Method (orthographic): build a view basis (u, v across the page, w toward the
 * viewer); project edges and triangles; sample along each edge and mark a sample
 * HIDDEN when some triangle covers its (u, v) location with a strictly greater
 * depth (closer to the viewer) than the sample. Consecutive same-state samples
 * become output segments. A depth epsilon keeps an edge from occluding itself on
 * its own coplanar faces. O(edges · samples · triangles) — fine for on-demand
 * drawings; callers feed only the feature/silhouette edges, not every mesh edge.
 */

export type Vec3 = [number, number, number];
export interface Vec2 { x: number; y: number }

export interface HlrSegment { a: Vec2; b: Vec2 }
export interface HlrResult { visible: HlrSegment[]; hidden: HlrSegment[] }

export interface HlrOptions {
  /** Samples per edge are derived from its projected length / this spacing (mm). */
  sampleSpacing?: number;
  /** Min samples per edge regardless of length. */
  minSamples?: number;
  /** A triangle must be closer than the edge sample by more than this to occlude
   *  it — prevents an edge's own coplanar faces from hiding it. */
  depthEps?: number;
}

const DEFAULT_OPTS: Required<HlrOptions> = { sampleSpacing: 1, minSamples: 8, depthEps: 1e-4 };

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a: Vec3): Vec3 { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

/** Orthonormal view basis: w = unit view direction (toward viewer), u/v span the page. */
export function viewBasis(viewDir: Vec3): { u: Vec3; v: Vec3; w: Vec3 } {
  const w = norm(viewDir);
  // Pick a reference not parallel to w.
  const ref: Vec3 = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(ref, w));
  const v = cross(w, u); // already unit (w,u orthonormal)
  return { u, v, w };
}

interface ProjPt { x: number; y: number; depth: number }
function projectPoint(p: Vec3, basis: { u: Vec3; v: Vec3; w: Vec3 }): ProjPt {
  return { x: dot(p, basis.u), y: dot(p, basis.v), depth: dot(p, basis.w) };
}

/** Pre-projected triangle: 2D vertices + per-vertex depth + 2D bbox for fast reject. */
interface ProjTri {
  ax: number; ay: number; ad: number;
  bx: number; by: number; bd: number;
  cx: number; cy: number; cd: number;
  minX: number; maxX: number; minY: number; maxY: number;
  maxD: number;
}

/** Barycentric cover + depth at (px,py); returns the triangle depth there, or
 *  null when the point is outside the triangle. */
function triDepthAt(t: ProjTri, px: number, py: number): number | null {
  if (px < t.minX || px > t.maxX || py < t.minY || py > t.maxY) return null;
  const v0x = t.bx - t.ax, v0y = t.by - t.ay;
  const v1x = t.cx - t.ax, v1y = t.cy - t.ay;
  const v2x = px - t.ax, v2y = py - t.ay;
  const den = v0x * v1y - v1x * v0y;
  if (Math.abs(den) < 1e-12) return null; // degenerate / edge-on triangle
  const wb = (v2x * v1y - v1x * v2y) / den;
  const wc = (v0x * v2y - v2x * v0y) / den;
  const wa = 1 - wb - wc;
  const e = -1e-9;
  if (wa < e || wb < e || wc < e) return null; // outside
  return wa * t.ad + wb * t.bd + wc * t.cd;
}

/**
 * Split `edges` into visible and hidden 2D segments by depth occlusion against
 * `triangles`, viewed along `viewDir` (pointing toward the viewer).
 */
export function removeHiddenLines(
  edges: Array<[Vec3, Vec3]>,
  triangles: Array<[Vec3, Vec3, Vec3]>,
  viewDir: Vec3,
  options: HlrOptions = {},
): HlrResult {
  const opts = { ...DEFAULT_OPTS, ...options };
  const basis = viewBasis(viewDir);

  // Pre-project the triangles once.
  const tris: ProjTri[] = triangles.map(([a, b, c]) => {
    const pa = projectPoint(a, basis), pb = projectPoint(b, basis), pc = projectPoint(c, basis);
    return {
      ax: pa.x, ay: pa.y, ad: pa.depth,
      bx: pb.x, by: pb.y, bd: pb.depth,
      cx: pc.x, cy: pc.y, cd: pc.depth,
      minX: Math.min(pa.x, pb.x, pc.x), maxX: Math.max(pa.x, pb.x, pc.x),
      minY: Math.min(pa.y, pb.y, pc.y), maxY: Math.max(pa.y, pb.y, pc.y),
      maxD: Math.max(pa.depth, pb.depth, pc.depth),
    };
  });

  const visible: HlrSegment[] = [];
  const hidden: HlrSegment[] = [];

  for (const [a, b] of edges) {
    const pa = projectPoint(a, basis);
    const pb = projectPoint(b, basis);
    const len2d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const samples = Math.max(opts.minSamples, Math.ceil(len2d / opts.sampleSpacing) + 1);

    const isHidden = (s: number): boolean => {
      const x = pa.x + (pb.x - pa.x) * s;
      const y = pa.y + (pb.y - pa.y) * s;
      const d = pa.depth + (pb.depth - pa.depth) * s;
      for (const t of tris) {
        if (t.maxD <= d + opts.depthEps) continue; // triangle not in front anywhere
        const td = triDepthAt(t, x, y);
        if (td !== null && td > d + opts.depthEps) return true;
      }
      return false;
    };

    // Classify each sample, then merge consecutive same-state runs into segments.
    const pt2 = (s: number): Vec2 => ({ x: pa.x + (pb.x - pa.x) * s, y: pa.y + (pb.y - pa.y) * s });
    let runStart = 0;
    let runHidden = isHidden(0);
    for (let i = 1; i <= samples; i++) {
      const s = i / samples;
      const h = i === samples ? runHidden : isHidden(s);
      if (h !== runHidden || i === samples) {
        const seg = { a: pt2(runStart / samples), b: pt2((i === samples ? samples : i) / samples) };
        (runHidden ? hidden : visible).push(seg);
        runStart = i;
        runHidden = h;
      }
    }
  }

  return { visible, hidden };
}

/** Convenience: extract triangles from a flat indexed/non-indexed position array. */
export function trianglesFromArrays(positions: ArrayLike<number>, indices?: ArrayLike<number> | null): Array<[Vec3, Vec3, Vec3]> {
  const out: Array<[Vec3, Vec3, Vec3]> = [];
  const triCount = indices ? indices.length / 3 : positions.length / 9;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices ? indices[t * 3]! : t * 3;
    const i1 = indices ? indices[t * 3 + 1]! : t * 3 + 1;
    const i2 = indices ? indices[t * 3 + 2]! : t * 3 + 2;
    out.push([
      [positions[i0 * 3]!, positions[i0 * 3 + 1]!, positions[i0 * 3 + 2]!],
      [positions[i1 * 3]!, positions[i1 * 3 + 1]!, positions[i1 * 3 + 2]!],
      [positions[i2 * 3]!, positions[i2 * 3 + 1]!, positions[i2 * 3 + 2]!],
    ]);
  }
  return out;
}
