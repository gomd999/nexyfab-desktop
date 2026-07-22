/**
 * femRefine.ts — graded, boundary-CONFORMING tetrahedral refinement for the 3D
 * FEM solver, so peak stress at a CURVED stress-raiser (e.g. a plate-with-hole
 * bore, the Kirsch Kt=3 benchmark A5) can be recovered to engineering grade.
 *
 * WHY: `femSolver.ts::generateTetMesh` builds a UNIFORM structured voxel grid and
 * keeps cells whose centre is inside the solid. That staircases any curved hole
 * (no node lands on the true bore where the Kirsch peak lives) and, at any node
 * budget the in-browser PCG can converge on, grossly under-resolves an r=10 bore
 * (~1 cell across the radius). Measured Kt = 1.07 vs 3.0 — 64 % low.
 *
 * WHAT this module adds, without any external mesher or new dependency:
 *   1. GRADED refinement — start from the uniform coarse grid, then repeatedly
 *      bisect the LONGEST EDGE of tets near the curved feature until the near-bore
 *      cells reach a small target size (~O(10) cells across the hole radius),
 *      leaving the bulk coarse.
 *   2. BOUNDARY CONFORMANCE — snap the boundary-adjacent nodes onto the TRUE
 *      surface triangulation (three-mesh-bvh closest-point), so nodes land ON the
 *      real bore. Every snap is quality-guarded: it is rejected if it would invert
 *      or sliver ANY incident tet (a bad snap is worse than none).
 *
 * ── HOW THE MESH STAYS CONFORMING ACROSS REFINEMENT LEVELS (the correctness
 *    point) ──────────────────────────────────────────────────────────────────
 * Refinement is pure EDGE BISECTION with full incident-tet closure. To refine an
 * edge (a,b) we create its midpoint m ONCE (cached, shared) and split EVERY tet
 * incident to that edge — {a,b,c,d} -> {a,m,c,d} + {m,b,c,d}. Because every tet
 * sharing (a,b) is split by the SAME shared node m, the two faces that touch the
 * edge, (a,b,c) and (a,b,d), are replaced identically in all neighbours, and every
 * face NOT containing (a,b) is inherited unchanged by exactly one child. Hence
 * there is never a T-junction: m is a real shared node, NOT a hanging node. This
 * is the classic conforming bisection scheme — no octree hanging-node constraints,
 * no 2:1 transition templates. Vertex-replacement keeps element orientation, so no
 * bisected child is ever inverted (each child is exactly half the parent volume,
 * same sign). Snapping only MOVES existing shared nodes — it changes geometry,
 * never topology — so it cannot create a hanging node either; it is guarded solely
 * for element quality (positive Jacobian). The result is provably conforming at
 * every stage, which the linear-field patch test in the unit suite confirms.
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { pointInsideSurface, type Tet } from './femSolver';

/** cos(~8deg): a triangle whose unit normal has a component above this is treated
 *  as axis-aligned (a flat prismatic face), i.e. NOT part of a curved raiser. */
const AXIS_TOL = 0.990;

export interface RefineDiagnostics {
  coarseNodes: number;
  refinedNodes: number;
  refinedTets: number;
  passes: number;
  trimmed: number;
  snapped: number;
  snapRejected: number;
  snapMaxDev: number;   // max |p - closestSurfacePoint| actually applied (mm)
  targetSize: number;
  featRadius: number;
  minSignedVol: number; // smallest signed tet volume after refine+snap (>0 => no inversion)
  negativeVols: number; // count of non-positive volumes (must be 0)
}

export interface RefineResult {
  nodes: Float32Array;
  tets: Tet[];
  diag: RefineDiagnostics;
}

/** Pull the CURVED (non axis-aligned) surface triangles out of the soup and count
 *  how many DISTINCT normal directions they span. A real curved raiser (bore,
 *  fillet) spans many normals; a single angled flat face spans one. */
function extractCurved(pos: THREE.BufferAttribute): { verts: number[]; distinctNormals: number } {
  const nTri = pos.count / 3;
  const verts: number[] = [];
  const bins = new Set<string>();
  for (let t = 0; t < nTri; t++) {
    const i0 = t * 3, i1 = t * 3 + 1, i2 = t * 3 + 2;
    const ax0 = pos.getX(i0), ay0 = pos.getY(i0), az0 = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
    const e1x = bx - ax0, e1y = by - ay0, e1z = bz - az0;
    const e2x = cx - ax0, e2y = cy - ay0, e2z = cz - az0;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;
    nx /= len; ny /= len; nz /= len;
    const maxc = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
    if (maxc > AXIS_TOL) continue; // axis-aligned flat face
    verts.push(ax0, ay0, az0, bx, by, bz, cx, cy, cz);
    bins.add(`${Math.round(nx * 6)},${Math.round(ny * 6)},${Math.round(nz * 6)}`);
  }
  return { verts, distinctNormals: bins.size };
}

/** True when the surface carries a curved stress-raiser (bore/fillet) worth the
 *  graded refine+snap path. A prismatic box (A1-A4) has NO curved triangles =>
 *  false => the caller keeps the byte-identical uniform-grid + Jacobi path. */
export function hasCurvedStressRaiser(pos: THREE.BufferAttribute): boolean {
  const { verts, distinctNormals } = extractCurved(pos);
  return verts.length / 9 >= 8 && distinctNormals >= 6;
}

/** Build a three-mesh-bvh over just the CURVED surface triangles (the true bore /
 *  fillet). Exposed so tests can verify the snapped boundary nodes lie ON the true
 *  surface. Returns bvh=null when the surface has no curved feature. */
export function buildCurvedBVH(
  pos: THREE.BufferAttribute,
): { bvh: MeshBVH | null; geom: THREE.BufferGeometry | null; distinctNormals: number; triCount: number } {
  const { verts, distinctNormals } = extractCurved(pos);
  const triCount = verts.length / 9;
  if (triCount === 0) return { bvh: null, geom: null, distinctNormals, triCount: 0 };
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return { bvh: new MeshBVH(geom), geom, distinctNormals, triCount };
}

/** signed volume x 6 of tet (p0,p1,p2,p3) in `coords`; sign encodes orientation. */
function sv6(coords: number[] | Float64Array, a: number, b: number, c: number, d: number): number {
  const ax = coords[a * 3], ay = coords[a * 3 + 1], az = coords[a * 3 + 2];
  const b1 = coords[b * 3] - ax, b2 = coords[b * 3 + 1] - ay, b3 = coords[b * 3 + 2] - az;
  const c1 = coords[c * 3] - ax, c2 = coords[c * 3 + 1] - ay, c3 = coords[c * 3 + 2] - az;
  const d1 = coords[d * 3] - ax, d2 = coords[d * 3 + 1] - ay, d3 = coords[d * 3 + 2] - az;
  return b1 * (c2 * d3 - c3 * d2) - b2 * (c1 * d3 - c3 * d1) + b3 * (c1 * d2 - c2 * d1);
}

/** signed volume x 6 but with node `rep` relocated to (qx,qy,qz) — for snap guard. */
function sv6Moved(
  coords: number[], a: number, b: number, c: number, d: number,
  rep: number, qx: number, qy: number, qz: number,
): number {
  const gx = (i: number) => (i === rep ? qx : coords[i * 3]);
  const gy = (i: number) => (i === rep ? qy : coords[i * 3 + 1]);
  const gz = (i: number) => (i === rep ? qz : coords[i * 3 + 2]);
  const ax = gx(a), ay = gy(a), az = gz(a);
  const b1 = gx(b) - ax, b2 = gy(b) - ay, b3 = gz(b) - az;
  const c1 = gx(c) - ax, c2 = gy(c) - ay, c3 = gz(c) - az;
  const d1 = gx(d) - ax, d2 = gy(d) - ay, d3 = gz(d) - az;
  return b1 * (c2 * d3 - c3 * d2) - b2 * (c1 * d3 - c3 * d1) + b3 * (c1 * d2 - c2 * d1);
}

/**
 * Build a graded, boundary-conforming TET4 mesh from the uniform coarse mesh.
 *
 * pos    — non-indexed surface triangulation (the TRUE curved boundary)
 * coarse — the uniform grid mesh from `generateTetMesh`
 * opts   — targetSize (near-bore cell size), band (refine reach around the
 *          feature), maxCornerNodes (safety cap so the solve stays feasible)
 */
export function generateRefinedTetMesh(
  pos: THREE.BufferAttribute,
  coarse: { nodes: Float32Array; tets: Tet[] },
  opts: { targetSize?: number; band?: number; gradeK?: number; maxCornerNodes?: number } = {},
): RefineResult {
  const { bvh, geom: curvedGeom } = buildCurvedBVH(pos);
  if (!bvh || !curvedGeom) {
    // No curved feature — nothing to refine; hand the coarse mesh back untouched.
    return {
      nodes: coarse.nodes,
      tets: coarse.tets,
      diag: {
        coarseNodes: coarse.nodes.length / 3, refinedNodes: coarse.nodes.length / 3,
        refinedTets: coarse.tets.length, passes: 0, trimmed: 0, snapped: 0, snapRejected: 0,
        snapMaxDev: 0, targetSize: 0, featRadius: 0, minSignedVol: 0, negativeVols: 0,
      },
    };
  }

  // Curved-feature scale => default refinement targets.
  const fbb = new THREE.Box3().setFromBufferAttribute(
    curvedGeom.getAttribute('position') as THREE.BufferAttribute,
  );
  const fsz = new THREE.Vector3(); fbb.getSize(fsz);
  // In-plane radius of the feature (smaller of the two largest spans / 2).
  const spans = [fsz.x, fsz.y, fsz.z].sort((p, q) => q - p);
  const featRadius = Math.max(spans[1] / 2, 1e-3);
  // Defaults chosen so an r~10 bore lands ~O(6) graded cells across the radius at
  // ~30-80k DOF (IC0-solvable in-browser). Finer only raises the mesh-sensitive 3D
  // free-edge peak (see FEA_VALIDATION.md) without converging, so this is the honest
  // engineering-grade operating point rather than a chase to a single lucky number.
  const targetSize = opts.targetSize ?? Math.max(featRadius / 5.5, 0.5);
  const band = opts.band ?? featRadius * 1.0;
  const maxCornerNodes = opts.maxCornerNodes ?? 6000;

  // Full-surface flat triangle array for the inside/outside test used in trimming.
  const surfCount = pos.count;
  const surfTri = new Float32Array(surfCount * 3);
  for (let i = 0; i < surfCount; i++) {
    surfTri[i * 3] = pos.getX(i); surfTri[i * 3 + 1] = pos.getY(i); surfTri[i * 3 + 2] = pos.getZ(i);
  }
  const surfTriCount = surfCount / 3;

  // Mutable geometry: growable coords + tets (as index quadruples).
  const coords: number[] = Array.from(coarse.nodes);
  const tets: Array<[number, number, number, number] | null> =
    coarse.tets.map((t) => [t.nodes[0], t.nodes[1], t.nodes[2], t.nodes[3]] as [number, number, number, number]);

  // Distance-to-curved-surface per node, lazily filled (Infinity = beyond band).
  const nodeDist: number[] = new Array(coords.length / 3).fill(-1);
  const qp = new THREE.Vector3();
  const distTo = (idx: number): number => {
    let d = nodeDist[idx];
    if (d >= 0) return d;
    qp.set(coords[idx * 3], coords[idx * 3 + 1], coords[idx * 3 + 2]);
    const hit = bvh.closestPointToPoint(qp, { point: new THREE.Vector3(), distance: 0, faceIndex: -1 });
    d = hit ? hit.distance : Infinity;
    nodeDist[idx] = d;
    return d;
  };

  // Shared-midpoint cache so a bisected edge yields ONE shared node (conformity).
  const BIG = 1e7;
  const midCache = new Map<number, number>();
  const edgeKey = (a: number, b: number) => (a < b ? a * BIG + b : b * BIG + a);
  const midpoint = (a: number, b: number): number => {
    const k = edgeKey(a, b);
    let m = midCache.get(k);
    if (m === undefined) {
      m = coords.length / 3;
      coords.push(
        (coords[a * 3] + coords[b * 3]) / 2,
        (coords[a * 3 + 1] + coords[b * 3 + 1]) / 2,
        (coords[a * 3 + 2] + coords[b * 3 + 2]) / 2,
      );
      nodeDist.push(-1);
      midCache.set(k, m);
    }
    return m;
  };

  // Incidence: node -> set of tet slot indices.
  const node2tets: Set<number>[] = Array.from({ length: coords.length / 3 }, () => new Set<number>());
  for (let ti = 0; ti < tets.length; ti++) {
    const t = tets[ti]!; for (const nd of t) node2tets[nd].add(ti);
  }
  const ensureAdj = (idx: number) => { while (node2tets.length <= idx) node2tets.push(new Set<number>()); };

  const EDGES: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
  ];
  const longestEdge = (t: readonly number[]): [number, number, number] => {
    let bestLen = -1, ba = t[0], bb = t[1];
    for (const [i, j] of EDGES) {
      const a = t[i], b = t[j];
      const dx = coords[a * 3] - coords[b * 3];
      const dy = coords[a * 3 + 1] - coords[b * 3 + 1];
      const dz = coords[a * 3 + 2] - coords[b * 3 + 2];
      const l = dx * dx + dy * dy + dz * dz;
      if (l > bestLen) { bestLen = l; ba = a; bb = b; }
    }
    return [ba, bb, Math.sqrt(bestLen)];
  };

  /** Split every tet incident to edge (a,b) at the shared midpoint m. */
  const bisectEdge = (a: number, b: number): void => {
    const sa = node2tets[a], sb = node2tets[b];
    const inc: number[] = [];
    const [small, big] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
    for (const ti of small) if (big.has(ti) && tets[ti]) inc.push(ti);
    if (inc.length === 0) return;
    const m = midpoint(a, b); ensureAdj(m);
    for (const ti of inc) {
      const t = tets[ti]; if (!t) continue;
      // child A reuses slot ti: b -> m ; child B is new: a -> m (order preserved => orientation preserved)
      const cA = t.map((x) => (x === b ? m : x)) as [number, number, number, number];
      const cB = t.map((x) => (x === a ? m : x)) as [number, number, number, number];
      tets[ti] = cA;
      node2tets[b].delete(ti); node2tets[m].add(ti);
      const tj = tets.length; tets.push(cB);
      for (const nd of cB) node2tets[nd].add(tj);
    }
  };

  const tetNearCurve = (t: readonly number[]): boolean => {
    for (const nd of t) if (distTo(nd) <= band) return true;
    return false;
  };

  // ── Graded refinement passes: bisect the LONGEST edge of near-bore tets until
  //    they reach targetSize. Candidate edges are prioritised by proximity to the
  //    bore (closest first) and the corner-node cap is enforced MID-pass, so the
  //    budget is spent on the innermost cells where the Kirsch peak lives and the
  //    solve stays feasible. ──
  // DISTANCE-GRADED target: a tet's allowed size grows with its distance from the
  // bore, so cells are finest ON the bore (smooth boundary + steep-gradient capture
  // where the Kirsch peak lives) and coarsen outward — spending the node budget
  // where it matters instead of filling the whole band uniformly. localTarget(d) =
  // max(targetSize, gradeK·d).
  const gradeK = opts.gradeK ?? 1.6;
  const minNodeDist = (t: readonly number[]): number =>
    Math.min(distTo(t[0]), distTo(t[1]), distTo(t[2]), distTo(t[3]));
  let passes = 0;
  for (; passes < 48; passes++) {
    // The corner-node cap is a SAFETY limit only, checked at pass boundaries — a
    // pass always runs to COMPLETION so each graded ring is refined symmetrically.
    // (Cutting a pass mid-way left the bore boundary asymmetric and made Kt swing
    // with the cut point; final size is instead governed by targetSize/gradeK/band.)
    if (coords.length / 3 > maxCornerNodes) break;
    const edges = new Map<number, [number, number]>();
    for (let ti = 0; ti < tets.length; ti++) {
      const t = tets[ti]; if (!t) continue;
      const d = minNodeDist(t);
      if (d > band) continue;
      const localTarget = Math.max(targetSize, gradeK * d);
      const [la, lb, len] = longestEdge(t);
      if (len <= localTarget) continue;
      edges.set(edgeKey(la, lb), [la, lb]);
    }
    if (edges.size === 0) break;
    for (const [, [a, b]] of edges) bisectEdge(a, b);
  }

  // ── Trim: drop near-bore tets whose centroid fell into the void (the staircase
  //    overhang). Cheap inside-test, only for tets close to the feature. ──
  let trimmed = 0;
  for (let ti = 0; ti < tets.length; ti++) {
    const t = tets[ti]; if (!t) continue;
    if (!tetNearCurve(t)) continue;
    const cx = (coords[t[0] * 3] + coords[t[1] * 3] + coords[t[2] * 3] + coords[t[3] * 3]) / 4;
    const cy = (coords[t[0] * 3 + 1] + coords[t[1] * 3 + 1] + coords[t[2] * 3 + 1] + coords[t[3] * 3 + 1]) / 4;
    const cz = (coords[t[0] * 3 + 2] + coords[t[1] * 3 + 2] + coords[t[2] * 3 + 2] + coords[t[3] * 3 + 2]) / 4;
    if (!pointInsideSurface(cx, cy, cz, surfTri, surfTriCount)) { tets[ti] = null; trimmed++; }
  }

  // Rebuild incidence over surviving tets (trimming invalidated it).
  for (const s of node2tets) s.clear();
  for (let ti = 0; ti < tets.length; ti++) {
    const t = tets[ti]; if (!t) continue;
    for (const nd of t) node2tets[nd].add(ti);
  }

  // ── Boundary conformance: snap boundary nodes near the bore onto the true
  //    surface, guarded so no incident tet inverts or slivers. ──
  const faceCount = new Map<string, number>();
  const faceKey = (x: number, y: number, z: number) => {
    const a = Math.min(x, y, z), c = Math.max(x, y, z), b = x + y + z - a - c;
    return `${a},${b},${c}`;
  };
  for (let ti = 0; ti < tets.length; ti++) {
    const t = tets[ti]; if (!t) continue;
    const f = [[t[0], t[1], t[2]], [t[0], t[1], t[3]], [t[0], t[2], t[3]], [t[1], t[2], t[3]]];
    for (const [x, y, z] of f) { const k = faceKey(x, y, z); faceCount.set(k, (faceCount.get(k) ?? 0) + 1); }
  }
  const boundaryNode = new Uint8Array(coords.length / 3);
  for (let ti = 0; ti < tets.length; ti++) {
    const t = tets[ti]; if (!t) continue;
    const f = [[t[0], t[1], t[2]], [t[0], t[1], t[3]], [t[0], t[2], t[3]], [t[1], t[2], t[3]]];
    for (const [x, y, z] of f) if (faceCount.get(faceKey(x, y, z)) === 1) { boundaryNode[x] = 1; boundaryNode[y] = 1; boundaryNode[z] = 1; }
  }

  // Classify nodes. OUTER boundary nodes lie on the flat BC planes and are PINNED
  // (moving them off-plane would corrupt the axis-aligned plane BC detection).
  // BORE nodes are near the curved feature — they get pulled onto the true circle.
  // INTERIOR nodes relax freely.
  const isBore = new Uint8Array(coords.length / 3);
  const isOuter = new Uint8Array(coords.length / 3);
  for (let p = 0; p < boundaryNode.length; p++) {
    if (!boundaryNode[p]) continue;
    if (distTo(p) < band) isBore[p] = 1; else isOuter[p] = 1;
  }

  // A guarded LINE-SEARCH move: shift node p toward the target by the LARGEST
  // fraction that keeps every incident tet positively oriented and non-slivered.
  // Partial moves (rather than all-or-nothing rejects) are what keep the boundary
  // SMOOTH — a hard-rejected snap leaves a re-entrant notch that sharpens into a
  // spurious stress singularity as the mesh refines (Kt runs away). Advancing every
  // node as far as it safely can removes those notches.
  // Absolute floor on the (×6) signed volume so REPEATED partial moves cannot
  // compound a tet down to a near-degenerate sliver — a degenerate tet ruins the
  // conditioning and the PCG stops converging. A sound tet at the target size has
  // |sv6| ~ targetSize^3, so the floor is a small fraction of that.
  const absFloor = 0.012 * targetSize * targetSize * targetSize;
  const lineMove = (p: number, tx: number, ty: number, tz: number): number => {
    const ox = coords[p * 3], oy = coords[p * 3 + 1], oz = coords[p * 3 + 2];
    let f = 1.0;
    for (let it = 0; it < 7; it++) {
      const nx = ox + f * (tx - ox), ny = oy + f * (ty - oy), nz = oz + f * (tz - oz);
      let ok = true;
      for (const ti of node2tets[p]) {
        const t = tets[ti]; if (!t) continue;
        const vOld = sv6(coords, t[0], t[1], t[2], t[3]);
        const vNew = sv6Moved(coords, t[0], t[1], t[2], t[3], p, nx, ny, nz);
        const aNew = Math.abs(vNew), aOld = Math.abs(vOld);
        if (vOld === 0 || Math.sign(vNew) !== Math.sign(vOld) ||
            aNew < 0.3 * aOld || (aNew < absFloor && aNew < aOld)) { ok = false; break; }
      }
      if (ok) { coords[p * 3] = nx; coords[p * 3 + 1] = ny; coords[p * 3 + 2] = nz; return f; }
      f *= 0.5;
    }
    return 0;
  };
  const projectToBore = (p: number): { x: number; y: number; z: number } | null => {
    qp.set(coords[p * 3], coords[p * 3 + 1], coords[p * 3 + 2]);
    const hit = bvh.closestPointToPoint(qp, { point: new THREE.Vector3(), distance: 0, faceIndex: -1 });
    return hit ? { x: hit.point.x, y: hit.point.y, z: hit.point.z } : null;
  };

  // ── Boundary snap: pull each bore node onto the true circle (line-searched). ──
  let snapped = 0, snapRejected = 0, snapMaxDev = 0;
  for (let p = 0; p < isBore.length; p++) {
    if (!isBore[p]) continue;
    if (node2tets[p].size === 0) continue;
    const q = projectToBore(p); if (!q) continue;
    const full = Math.hypot(q.x - coords[p * 3], q.y - coords[p * 3 + 1], q.z - coords[p * 3 + 2]);
    if (full < 1e-9) { snapped++; continue; }
    const f = lineMove(p, q.x, q.y, q.z);
    if (f > 0) { snapped++; if (f * full > snapMaxDev) snapMaxDev = f * full; } else snapRejected++;
  }

  // ── Quality smoothing: Laplacian relaxation to erase the skewed transition tets
  //    that grading + snapping leave. INTERIOR nodes relax to the neighbour
  //    centroid; BORE nodes relax then RE-PROJECT to the true circle each sweep, so
  //    the boundary ring evens out and stays exactly conforming; OUTER nodes pinned.
  //    Every move is the same guarded line search — no move ever inverts a tet. ──
  const adj: Set<number>[] = Array.from({ length: coords.length / 3 }, () => new Set<number>());
  for (let ti = 0; ti < tets.length; ti++) {
    const t = tets[ti]; if (!t) continue;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j) adj[t[i]].add(t[j]);
  }
  const relax = 0.5;
  for (let sweep = 0; sweep < 8; sweep++) {
    for (let p = 0; p < coords.length / 3; p++) {
      if (isOuter[p]) continue; // pinned to the BC plane
      const nb = adj[p]; if (nb.size === 0) continue;
      let sx = 0, sy = 0, sz = 0;
      for (const q of nb) { sx += coords[q * 3]; sy += coords[q * 3 + 1]; sz += coords[q * 3 + 2]; }
      const inv = 1 / nb.size;
      let tx = coords[p * 3] + relax * (sx * inv - coords[p * 3]);
      let ty = coords[p * 3 + 1] + relax * (sy * inv - coords[p * 3 + 1]);
      let tz = coords[p * 3 + 2] + relax * (sz * inv - coords[p * 3 + 2]);
      if (isBore[p]) {
        qp.set(tx, ty, tz);
        const hit = bvh.closestPointToPoint(qp, { point: new THREE.Vector3(), distance: 0, faceIndex: -1 });
        if (hit) { tx = hit.point.x; ty = hit.point.y; tz = hit.point.z; }
      }
      lineMove(p, tx, ty, tz);
    }
  }
  // Final re-projection so bore nodes end exactly ON the true surface.
  for (let p = 0; p < isBore.length; p++) {
    if (!isBore[p]) continue;
    const q = projectToBore(p); if (q) lineMove(p, q.x, q.y, q.z);
  }

  // ── Compact: keep only referenced nodes, reindex, emit Tet[] with volume. ──
  const used = new Int32Array(coords.length / 3).fill(-1);
  const outCoords: number[] = [];
  const remap = (idx: number): number => {
    if (used[idx] >= 0) return used[idx];
    const ni = outCoords.length / 3;
    outCoords.push(coords[idx * 3], coords[idx * 3 + 1], coords[idx * 3 + 2]);
    used[idx] = ni; return ni;
  };
  const outTets: Tet[] = [];
  let minSignedVol = Infinity, negativeVols = 0;
  for (let ti = 0; ti < tets.length; ti++) {
    const t = tets[ti]; if (!t) continue;
    const v6 = sv6(coords, t[0], t[1], t[2], t[3]);
    if (v6 <= 0) negativeVols++;
    if (v6 < minSignedVol) minSignedVol = v6;
    const n0 = remap(t[0]), n1 = remap(t[1]), n2 = remap(t[2]), n3 = remap(t[3]);
    outTets.push({ nodes: [n0, n1, n2, n3], volume: Math.abs(v6) / 6 });
  }

  return {
    nodes: new Float32Array(outCoords),
    tets: outTets,
    diag: {
      coarseNodes: coarse.nodes.length / 3,
      refinedNodes: outCoords.length / 3,
      refinedTets: outTets.length,
      passes,
      trimmed,
      snapped,
      snapRejected,
      snapMaxDev,
      targetSize,
      featRadius,
      minSignedVol: minSignedVol === Infinity ? 0 : minSignedVol,
      negativeVols,
    },
  };
}
