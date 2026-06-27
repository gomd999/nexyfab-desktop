/**
 * Generic triangle-mesh → papercraft net unfolding (Pepakura-style), v2 with
 * overlap resolution + island packing.
 *
 * Walks a BFS spanning tree over the face-adjacency graph and hinges each face
 * into the plane around its shared edge with the parent (isometric unfold —
 * edge lengths preserved). BEFORE committing a fold it tests the candidate face
 * against everything already placed; if it would overlap, the edge is left as a
 * CUT seam instead and the face is grown later as a SEPARATE island. All islands
 * are then packed side-by-side so the final net has no overlaps. Emits Seg[]:
 *   - FOLD : interior tree edges (faces stay attached → score, don't cut)
 *   - CUT  : boundary edges + seams (cut)
 *   - TAB  : a glue flap on each seam, to re-join cut-apart faces
 *
 * Optional `thickness` (material thickness, e.g. foam board / 우드락) grows the
 * glue tabs a little so a thicker board still has a usable bonding flap.
 */
import type { Seg } from './netDxf';

type V2 = [number, number];

export interface UnfoldResult {
  segs: Seg[];
  faceCount: number;
  /** Separate connected pieces in the packed net (overlaps split into islands). */
  pieces: number;
  /** Residual overlaps after resolution (should be ~0). */
  overlaps: number;
  ok: boolean;
  reason?: string;
}

const hyp3 = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
  Math.hypot(ax - bx, ay - by, az - bz);

const EPS = 1e-4;
const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Strict interior test — points on an edge/vertex are NOT inside (so faces that
 *  merely share an edge don't read as overlapping). */
function strictlyInside(p: V2, t: [V2, V2, V2]): boolean {
  const d1 = cross(p, t[0], t[1]), d2 = cross(p, t[1], t[2]), d3 = cross(p, t[2], t[0]);
  const allPos = d1 > EPS && d2 > EPS && d3 > EPS;
  const allNeg = d1 < -EPS && d2 < -EPS && d3 < -EPS;
  return allPos || allNeg;
}
const centroid = (t: [V2, V2, V2]): V2 => [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];

/** Conservative area-overlap test between two 2D triangles (edge contact OK). */
function trisOverlap(a: [V2, V2, V2], b: [V2, V2, V2]): boolean {
  for (const v of a) if (strictlyInside(v, b)) return true;
  for (const v of b) if (strictlyInside(v, a)) return true;
  if (strictlyInside(centroid(a), b)) return true;
  if (strictlyInside(centroid(b), a)) return true;
  return false;
}

export function unfoldMesh(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | null,
  opts: { tab?: number; maxFaces?: number; thickness?: number } = {},
): UnfoldResult {
  const thickness = Math.min(Math.max(opts.thickness ?? 0, 0), 30);
  const tabSize = Math.min(Math.max((opts.tab ?? 5) + thickness * 0.5, 1), 40);
  const maxFaces = opts.maxFaces ?? 3000;

  // 1. Weld vertices so shared edges are detected (STL duplicates them).
  const vx: number[] = [], vy: number[] = [], vz: number[] = [];
  const key2id = new Map<string, number>();
  const q = (n: number) => Math.round(n * 1e4) / 1e4;
  const weld = (x: number, y: number, z: number): number => {
    const k = `${q(x)},${q(y)},${q(z)}`;
    let id = key2id.get(k);
    if (id === undefined) { id = vx.length; vx.push(x); vy.push(y); vz.push(z); key2id.set(k, id); }
    return id;
  };

  // 2. Build welded faces.
  const triCount = indices ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9);
  if (triCount === 0) return { segs: [], faceCount: 0, pieces: 0, overlaps: 0, ok: false, reason: 'empty mesh' };
  if (triCount > maxFaces) return { segs: [], faceCount: triCount, pieces: 0, overlaps: 0, ok: false, reason: `mesh too dense (${triCount} faces > ${maxFaces}) — simplify first` };
  const faces: Array<[number, number, number]> = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = indices ? indices[t * 3] : t * 3;
    const i1 = indices ? indices[t * 3 + 1] : t * 3 + 1;
    const i2 = indices ? indices[t * 3 + 2] : t * 3 + 2;
    const a = weld(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
    const b = weld(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
    const c = weld(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);
    if (a === b || b === c || a === c) continue;
    faces.push([a, b, c]);
  }
  const F = faces.length;
  if (F === 0) return { segs: [], faceCount: 0, pieces: 0, overlaps: 0, ok: false, reason: 'no valid faces' };

  const d3 = (u: number, w: number) => hyp3(vx[u], vy[u], vz[u], vx[w], vy[w], vz[w]);
  const ekey = (u: number, w: number) => (u < w ? `${u}_${w}` : `${w}_${u}`);

  // 3. edge → incident faces.
  const edgeFaces = new Map<string, number[]>();
  faces.forEach((f, fi) => {
    for (const [u, w] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]] as Array<[number, number]>) {
      const k = ekey(u, w); const arr = edgeFaces.get(k); if (arr) arr.push(fi); else edgeFaces.set(k, [fi]);
    }
  });

  // 4. Unfold with overlap-aware BFS. placed[fi] holds 2D coords of its 3 verts.
  const placed: Array<Map<number, V2> | null> = new Array(F).fill(null);
  const island: Int32Array = new Int32Array(F).fill(-1);
  const treeEdges = new Set<string>();
  const placedTris: Array<{ tri: [V2, V2, V2]; fi: number }> = [];

  const triOf = (fi: number, m: Map<number, V2>): [V2, V2, V2] => {
    const f = faces[fi]; return [m.get(f[0])!, m.get(f[1])!, m.get(f[2])!];
  };
  const wouldOverlap = (tri: [V2, V2, V2]): boolean => {
    for (const p of placedTris) if (trisOverlap(tri, p.tri)) return true;
    return false;
  };

  const placeSeed = (fi: number): Map<number, V2> => {
    const [a, b, c] = faces[fi];
    const lab = d3(a, b), lac = d3(a, c), lbc = d3(b, c);
    const cx = lab > 1e-9 ? (lac * lac - lbc * lbc + lab * lab) / (2 * lab) : 0;
    const cy = Math.sqrt(Math.max(0, lac * lac - cx * cx));
    const m = new Map<number, V2>(); m.set(a, [0, 0]); m.set(b, [lab, 0]); m.set(c, [cx, cy]);
    return m;
  };
  const tryPlaceChild = (fi: number, u: number, w: number, pu: V2, pw: V2, parentThird: V2): Map<number, V2> | null => {
    const f = faces[fi];
    const tv = f[0] !== u && f[0] !== w ? f[0] : f[1] !== u && f[1] !== w ? f[1] : f[2];
    const luw = d3(u, w), lut = d3(u, tv), lwt = d3(w, tv);
    if (luw < 1e-9) return null;
    const dx = (pw[0] - pu[0]) / luw, dy = (pw[1] - pu[1]) / luw;
    const nx = -dy, ny = dx;
    const px = (lut * lut - lwt * lwt + luw * luw) / (2 * luw);
    const py = Math.sqrt(Math.max(0, lut * lut - px * px));
    const side = (parentThird[0] - pu[0]) * nx + (parentThird[1] - pu[1]) * ny;
    const sign = side > 0 ? -1 : 1;
    const tp: V2 = [pu[0] + dx * px + nx * py * sign, pu[1] + dy * px + ny * py * sign];
    const m = new Map<number, V2>(); m.set(u, pu); m.set(w, pw); m.set(tv, tp);
    return m;
  };

  let islandCount = 0;
  const queue: number[] = [];
  for (let start = 0; start < F; start++) {
    if (placed[start]) continue;
    const seed = placeSeed(start);
    placed[start] = seed; island[start] = islandCount;
    placedTris.push({ tri: triOf(start, seed), fi: start });
    queue.push(start);
    while (queue.length) {
      const fi = queue.shift()!;
      const pm = placed[fi]!;
      const f = faces[fi];
      for (const [u, w] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]] as Array<[number, number]>) {
        const k = ekey(u, w);
        const inc = edgeFaces.get(k) ?? [];
        const other = inc.find(x => x !== fi && !placed[x]);
        if (other === undefined) continue;
        const third = f.find(x => x !== u && x !== w)!;
        const m = tryPlaceChild(other, u, w, pm.get(u)!, pm.get(w)!, pm.get(third)!);
        if (!m) continue;
        // Overlap resolution: only fold the child in if it doesn't collide.
        if (wouldOverlap(triOf(other, m))) continue; // leave as seam; grown later as a new island
        placed[other] = m; island[other] = islandCount;
        placedTris.push({ tri: triOf(other, m), fi: other });
        treeEdges.add(k); queue.push(other);
      }
    }
    islandCount++;
  }

  // 5. Pack islands left-to-right so pieces don't overlap in the layout.
  const MARGIN = Math.max(8, tabSize * 1.5);
  const bbox = Array.from({ length: islandCount }, () => ({ minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity }));
  for (let fi = 0; fi < F; fi++) {
    const m = placed[fi]; if (!m) continue; const isl = island[fi]; const bb = bbox[isl];
    for (const p of m.values()) { bb.minx = Math.min(bb.minx, p[0]); bb.miny = Math.min(bb.miny, p[1]); bb.maxx = Math.max(bb.maxx, p[0]); bb.maxy = Math.max(bb.maxy, p[1]); }
  }
  const offset: V2[] = []; let cursorX = 0;
  for (let i = 0; i < islandCount; i++) {
    const bb = bbox[i];
    if (!isFinite(bb.minx)) { offset.push([0, 0]); continue; }
    offset.push([cursorX - bb.minx, -bb.miny]);
    cursorX += (bb.maxx - bb.minx) + MARGIN;
  }
  const off = (fi: number, p: V2): V2 => [p[0] + offset[island[fi]][0], p[1] + offset[island[fi]][1]];

  // 6. Emit segments (each interior edge once), with island offsets applied.
  const segs: Seg[] = [];
  const emitted = new Set<string>();
  let residual = 0;
  for (let fi = 0; fi < F; fi++) {
    const m = placed[fi]; if (!m) continue;
    const f = faces[fi];
    for (const [u, w] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]] as Array<[number, number]>) {
      const k = ekey(u, w);
      const inc = edgeFaces.get(k) ?? [];
      const interior = inc.length >= 2;
      const a = off(fi, m.get(u)!), b = off(fi, m.get(w)!);
      if (interior && treeEdges.has(k)) {
        if (emitted.has(k)) continue;
        segs.push({ a, b, layer: 'FOLD' }); emitted.add(k);
      } else {
        segs.push({ a, b, layer: 'CUT' });
        segs.push(...edgeTab(a, b, tabSize));
        if (!interior) emitted.add(k);
      }
    }
  }
  // residual overlap report (across the packed layout — should be ~0).
  const packedTris: [V2, V2, V2][] = [];
  for (let fi = 0; fi < F; fi++) { const m = placed[fi]; if (!m) continue; const f = faces[fi]; packedTris.push([off(fi, m.get(f[0])!), off(fi, m.get(f[1])!), off(fi, m.get(f[2])!)]); }
  for (let i = 0; i < packedTris.length; i++) {
    const c = centroid(packedTris[i]);
    for (let j = 0; j < packedTris.length; j++) { if (i !== j && strictlyInside(c, packedTris[j])) { residual++; break; } }
  }

  return { segs, faceCount: F, pieces: islandCount, overlaps: residual, ok: true };
}

/** Trapezoidal glue tab along edge a→b, offset outward (left normal) by t. */
function edgeTab(a: V2, b: V2, t: number): Seg[] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const inset = Math.min(t, len / 3);
  const ux = dx / len, uy = dy / len;
  const p1: V2 = [a[0] + ux * inset + nx * t, a[1] + uy * inset + ny * t];
  const p2: V2 = [b[0] - ux * inset + nx * t, b[1] - uy * inset + ny * t];
  return [
    { a, b: p1, layer: 'TAB' },
    { a: p1, b: p2, layer: 'TAB' },
    { a: p2, b, layer: 'TAB' },
  ];
}
