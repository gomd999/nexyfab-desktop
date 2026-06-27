/**
 * Generic triangle-mesh → papercraft net unfolding (Pepakura-style).
 *
 * Takes an arbitrary triangle mesh (welded on the fly) and flattens it into a
 * single connected 2D net by walking a BFS spanning tree over the face-adjacency
 * graph and hinging each face into the plane around its shared edge with the
 * parent (isometric unfold — edge lengths are preserved). Emits Seg[] with:
 *   - FOLD  : interior tree edges (faces stay attached → score, don't cut)
 *   - CUT   : boundary edges + non-tree interior edges (seams → cut)
 *   - TAB   : a glue flap on each seam, so cut-apart faces can be re-joined
 *
 * This is a best-effort v1: it does not globally resolve overlaps (child faces
 * are placed on the side away from the parent, which avoids the common local
 * overlap but not all global ones). `overlaps` reports detected face overlaps so
 * the caller can warn. Low-poly meshes (buildings, boxes, simple solids) unfold
 * cleanly; dense/organic meshes may need manual seam editing.
 */
import type { Seg } from './netDxf';

type V2 = [number, number];

export interface UnfoldResult {
  segs: Seg[];
  faceCount: number;
  /** Number of placed faces whose 2D triangle overlaps an earlier one. */
  overlaps: number;
  ok: boolean;
  reason?: string;
}

const hyp3 = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
  Math.hypot(ax - bx, ay - by, az - bz);

export function unfoldMesh(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | null,
  opts: { tab?: number; maxFaces?: number } = {},
): UnfoldResult {
  const tabSize = Math.min(Math.max(opts.tab ?? 5, 1), 30);
  const maxFaces = opts.maxFaces ?? 4000;

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
  if (triCount === 0) return { segs: [], faceCount: 0, overlaps: 0, ok: false, reason: 'empty mesh' };
  if (triCount > maxFaces) return { segs: [], faceCount: triCount, overlaps: 0, ok: false, reason: `mesh too dense (${triCount} faces > ${maxFaces}) — simplify first` };
  const faces: Array<[number, number, number]> = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = indices ? indices[t * 3] : t * 3;
    const i1 = indices ? indices[t * 3 + 1] : t * 3 + 1;
    const i2 = indices ? indices[t * 3 + 2] : t * 3 + 2;
    const a = weld(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
    const b = weld(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
    const c = weld(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);
    if (a === b || b === c || a === c) continue; // skip degenerate
    faces.push([a, b, c]);
  }
  const F = faces.length;
  if (F === 0) return { segs: [], faceCount: 0, overlaps: 0, ok: false, reason: 'no valid faces' };

  const d3 = (u: number, w: number) => hyp3(vx[u], vy[u], vz[u], vx[w], vy[w], vz[w]);
  const ekey = (u: number, w: number) => (u < w ? `${u}_${w}` : `${w}_${u}`);

  // 3. edge → incident faces.
  const edgeFaces = new Map<string, number[]>();
  faces.forEach((f, fi) => {
    const es: Array<[number, number]> = [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]];
    for (const [u, w] of es) {
      const k = ekey(u, w);
      const arr = edgeFaces.get(k);
      if (arr) arr.push(fi); else edgeFaces.set(k, [fi]);
    }
  });

  // 4. BFS spanning tree over face adjacency (shared interior edges).
  const placed: Array<Map<number, V2> | null> = new Array(F).fill(null);
  const visited = new Array<boolean>(F).fill(false);
  const treeEdges = new Set<string>(); // edges kept as FOLD

  // Seed placement: lay face fi flat using its own edge lengths.
  const placeSeed = (fi: number, m: Map<number, V2>) => {
    const [a, b, c] = faces[fi];
    const lab = d3(a, b), lac = d3(a, c), lbc = d3(b, c);
    const cx = lab > 1e-9 ? (lac * lac - lbc * lbc + lab * lab) / (2 * lab) : 0;
    const cy = Math.sqrt(Math.max(0, lac * lac - cx * cx));
    m.set(a, [0, 0]); m.set(b, [lab, 0]); m.set(c, [cx, cy]);
  };

  // Place child face fi across shared edge (u,w) already at p_u,p_w, putting the
  // child's third vertex on the side AWAY from the parent's third vertex.
  const placeChild = (fi: number, u: number, w: number, pu: V2, pw: V2, parentThird: V2) => {
    const f = faces[fi];
    const t = f[0] !== u && f[0] !== w ? f[0] : f[1] !== u && f[1] !== w ? f[1] : f[2];
    const luw = d3(u, w), lut = d3(u, t), lwt = d3(w, t);
    if (luw < 1e-9) return null;
    const dx = (pw[0] - pu[0]) / luw, dy = (pw[1] - pu[1]) / luw; // unit u→w
    const nx = -dy, ny = dx; // left normal
    const px = (lut * lut - lwt * lwt + luw * luw) / (2 * luw);
    const py = Math.sqrt(Math.max(0, lut * lut - px * px));
    // Parent's third vertex side relative to the u→w line:
    const side = (parentThird[0] - pu[0]) * nx + (parentThird[1] - pu[1]) * ny;
    const sign = side > 0 ? -1 : 1; // opposite side from parent
    const tp: V2 = [pu[0] + dx * px + nx * py * sign, pu[1] + dy * px + ny * py * sign];
    const m = new Map<number, V2>();
    m.set(u, pu); m.set(w, pw); m.set(t, tp);
    return m;
  };

  const queue: number[] = [];
  // Unfold each connected component (start a fresh seed when a new island is hit).
  for (let start = 0; start < F; start++) {
    if (visited[start]) continue;
    const seed = new Map<number, V2>();
    placeSeed(start, seed);
    placed[start] = seed; visited[start] = true; queue.push(start);
    while (queue.length) {
      const fi = queue.shift()!;
      const pm = placed[fi]!;
      const f = faces[fi];
      const es: Array<[number, number]> = [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]];
      for (const [u, w] of es) {
        const k = ekey(u, w);
        const inc = edgeFaces.get(k) ?? [];
        const other = inc.find(x => x !== fi && !visited[x]);
        if (other === undefined) continue;
        const pu = pm.get(u)!, pw = pm.get(w)!;
        const third = f.find(x => x !== u && x !== w)!;
        const m = placeChild(other, u, w, pu, pw, pm.get(third)!);
        if (!m) continue;
        placed[other] = m; visited[other] = true; treeEdges.add(k); queue.push(other);
      }
    }
  }

  // 5. Overlap detection (cheap centroid-in-triangle test across placed faces).
  const tris: Array<[V2, V2, V2]> = [];
  for (let fi = 0; fi < F; fi++) {
    const m = placed[fi]; if (!m) continue;
    const f = faces[fi];
    tris.push([m.get(f[0])!, m.get(f[1])!, m.get(f[2])!]);
  }
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inTri = (p: V2, t: [V2, V2, V2]) => {
    const d1 = cross(p, t[0], t[1]), d2 = cross(p, t[1], t[2]), d3c = cross(p, t[2], t[0]);
    const neg = d1 < 0 || d2 < 0 || d3c < 0, pos = d1 > 0 || d2 > 0 || d3c > 0;
    return !(neg && pos);
  };
  let overlaps = 0;
  for (let i = 0; i < tris.length; i++) {
    const c: V2 = [(tris[i][0][0] + tris[i][1][0] + tris[i][2][0]) / 3, (tris[i][0][1] + tris[i][1][1] + tris[i][2][1]) / 3];
    for (let j = 0; j < tris.length; j++) {
      if (i === j) continue;
      if (inTri(c, tris[j])) { overlaps++; break; }
    }
  }

  // 6. Emit segments. Each interior edge appears in two faces; emit it ONCE.
  const segs: Seg[] = [];
  const emitted = new Set<string>();
  for (let fi = 0; fi < F; fi++) {
    const m = placed[fi]; if (!m) continue;
    const f = faces[fi];
    const es: Array<[number, number]> = [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]];
    for (const [u, w] of es) {
      const k = ekey(u, w);
      if (emitted.has(k)) continue;
      const inc = edgeFaces.get(k) ?? [];
      const interior = inc.length >= 2;
      const a = m.get(u)!, b = m.get(w)!;
      if (interior && treeEdges.has(k)) {
        segs.push({ a, b, layer: 'FOLD' });
        emitted.add(k);
      } else {
        // boundary edge OR seam (interior but cut): a cut line + a glue tab.
        segs.push({ a, b, layer: 'CUT' });
        segs.push(...edgeTab(a, b, tabSize));
        // For a seam (interior cut) the edge belongs to two faces placed apart;
        // we still emit once here and let the matching face draw its own copy.
        if (!interior) emitted.add(k);
      }
    }
  }

  return { segs, faceCount: F, overlaps, ok: true };
}

/** Trapezoidal glue tab along edge a→b, offset outward (left normal) by t. */
function edgeTab(a: V2, b: V2, t: number): Seg[] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len; // left normal
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
