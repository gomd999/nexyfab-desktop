/**
 * topologyExtract — turn a 3D SIMP density field into a printable WATERTIGHT
 * solid (roadmap Track G / G3).
 *
 * Pipeline: threshold the density → emit the boundary faces of the solid voxel
 * set (every face between a solid voxel and a void/outside neighbour), welding
 * corners through a shared grid-vertex map so the result is a closed 2-manifold
 * by construction → Taubin-smooth it into an organic body without shrinking it
 * away. The watertightness is the same bar the mesh-rounding invariant enforces,
 * so the optimiser output can go straight to STL/print.
 *
 * Pure + dependency-free (no THREE), so it unit-tests headlessly.
 */
import { TopologyGrid } from './topology3D';

export interface ExtractedMesh {
  positions: Float32Array; // 3 per vertex
  indices: Uint32Array;    // 3 per triangle
}

// Each face: the void-neighbour direction + its 4 corner offsets, wound so the
// triangle normal points OUT of the solid voxel (verified by right-hand rule).
const FACES: ReadonlyArray<{ d: readonly [number, number, number]; c: ReadonlyArray<readonly [number, number, number]> }> = [
  { d: [+1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { d: [0, +1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { d: [0, 0, +1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { d: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

/**
 * Boundary surface of the solid voxel set (density > threshold). Watertight by
 * construction: interior faces (solid|solid) are skipped, every boundary face is
 * emitted once, and corner vertices are welded through one grid-vertex map.
 * `cell` scales grid coords to world units.
 */
export function extractSolidSurface(
  density: Float32Array, grid: TopologyGrid, threshold = 0.5, cell = 1,
): ExtractedMesh {
  const { nx, ny, nz } = grid;
  const solid = (ex: number, ey: number, ez: number): boolean =>
    ex >= 0 && ey >= 0 && ez >= 0 && ex < nx && ey < ny && ez < nz &&
    density[(ez * ny + ey) * nx + ex] > threshold;

  const vMap = new Map<number, number>();
  const coords: number[] = [];
  const vKey = (ix: number, iy: number, iz: number) => (iz * (ny + 1) + iy) * (nx + 1) + ix;
  const vert = (ix: number, iy: number, iz: number): number => {
    const k = vKey(ix, iy, iz);
    let idx = vMap.get(k);
    if (idx === undefined) { idx = coords.length / 3; coords.push(ix * cell, iy * cell, iz * cell); vMap.set(k, idx); }
    return idx;
  };

  const tris: number[] = [];
  for (let ez = 0; ez < nz; ez++) for (let ey = 0; ey < ny; ey++) for (let ex = 0; ex < nx; ex++) {
    if (!solid(ex, ey, ez)) continue;
    for (const face of FACES) {
      if (solid(ex + face.d[0], ey + face.d[1], ez + face.d[2])) continue; // interior face
      const q = face.c.map(([dx, dy, dz]) => vert(ex + dx, ey + dy, ez + dz));
      tris.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    }
  }
  return { positions: new Float32Array(coords), indices: new Uint32Array(tris) };
}

/** Build the vertex→neighbour adjacency from the triangle list. */
function buildAdjacency(mesh: ExtractedMesh): number[][] {
  const n = mesh.positions.length / 3;
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  const ix = mesh.indices;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t], b = ix[t + 1], c = ix[t + 2];
    adj[a].add(b); adj[a].add(c); adj[b].add(a); adj[b].add(c); adj[c].add(a); adj[c].add(b);
  }
  return adj.map((s) => [...s]);
}

/**
 * Taubin λ|μ smoothing — a low-pass that fairs the blocky voxel surface into an
 * organic body WITHOUT the shrinkage of plain Laplacian (the negative μ pass
 * pushes back out). Connectivity is untouched, so a watertight mesh stays
 * watertight. Defaults: λ=0.5, μ=−0.53, 10 iterations.
 */
export function taubinSmooth(
  mesh: ExtractedMesh, iterations = 10, lambda = 0.5, mu = -0.53,
): ExtractedMesh {
  const adj = buildAdjacency(mesh);
  const n = mesh.positions.length / 3;
  let pos = Float32Array.from(mesh.positions);

  const pass = (factor: number) => {
    const next = Float32Array.from(pos);
    for (let v = 0; v < n; v++) {
      const ns = adj[v];
      if (ns.length === 0) continue;
      let ax = 0, ay = 0, az = 0;
      for (const w of ns) { ax += pos[w*3]; ay += pos[w*3+1]; az += pos[w*3+2]; }
      ax /= ns.length; ay /= ns.length; az /= ns.length;
      next[v*3]   = pos[v*3]   + factor * (ax - pos[v*3]);
      next[v*3+1] = pos[v*3+1] + factor * (ay - pos[v*3+1]);
      next[v*3+2] = pos[v*3+2] + factor * (az - pos[v*3+2]);
    }
    pos = next;
  };

  for (let i = 0; i < iterations; i++) { pass(lambda); pass(mu); }
  return { positions: pos, indices: Uint32Array.from(mesh.indices) };
}

/** Pick a density threshold so the solid voxel count realises ~targetFraction. */
export function thresholdForFraction(density: Float32Array, targetFraction: number): number {
  const sorted = Float32Array.from(density).sort();
  const k = Math.floor((1 - targetFraction) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, k))];
}
