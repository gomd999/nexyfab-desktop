/**
 * surfaceKnit.ts — Stitch multiple surfaces into a closed shell.
 *
 * SolidWorks "Knit Surface" sews surfaces along shared edges so the
 * result acts as a single body. NexyFab equivalent: take an array
 * of SurfaceMesh, weld vertices within `tolerance`, output a unified
 * mesh whose edge use-count tells you whether the result is closed
 * (every edge shared by exactly 2 triangles).
 *
 * Same idea as sewFaces in stepImport, but operating on output of
 * NURBS / Coons / network tessellation rather than imported B-Rep.
 */

import type { SurfaceMesh } from './nurbsSurface';

export interface KnitOptions {
  /** Vertex merge tolerance (mm). */
  toleranceMm?: number;
}

export interface KnitReport {
  mergedVertices: number;
  finalVertexCount: number;
  finalTriangleCount: number;
  /** True when every edge is shared by exactly 2 triangles. */
  isClosed: boolean;
  /** Boundary edges (each is [v0, v1]) — empty array on closed shell. */
  boundaryEdges: Array<[number, number]>;
}

function vKey(x: number, y: number, z: number, tol: number): string {
  const q = (n: number) => Math.round(n / tol);
  return `${q(x)}|${q(y)}|${q(z)}`;
}

/** Combine N surfaces into one mesh with welded vertices. */
export function knitSurfaces(
  meshes: SurfaceMesh[],
  opts: KnitOptions = {},
): { mesh: SurfaceMesh; report: KnitReport } {
  const tol = opts.toleranceMm ?? 1e-3;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const remap = new Map<string, number>();
  const indices: number[] = [];

  let merged = 0;
  for (const m of meshes) {
    const localRemap: number[] = [];
    for (let i = 0; i < m.positions.length; i += 3) {
      const x = m.positions[i]!;
      const y = m.positions[i + 1]!;
      const z = m.positions[i + 2]!;
      const key = vKey(x, y, z, tol);
      let idx = remap.get(key);
      if (idx === undefined) {
        idx = positions.length / 3;
        positions.push(x, y, z);
        normals.push(m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!);
        uvs.push(m.uvs[(i / 3) * 2] ?? 0, m.uvs[(i / 3) * 2 + 1] ?? 0);
        remap.set(key, idx);
      } else {
        merged++;
      }
      localRemap.push(idx);
    }
    for (const j of m.indices) indices.push(localRemap[j]!);
  }

  // Closure check: count edge uses.
  const edgeUses = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!, b = indices[i + 1]!, c = indices[i + 2]!;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const k = u < v ? `${u}|${v}` : `${v}|${u}`;
      edgeUses.set(k, (edgeUses.get(k) ?? 0) + 1);
    }
  }
  const boundaryEdges: Array<[number, number]> = [];
  let isClosed = true;
  for (const [k, count] of edgeUses) {
    if (count !== 2) {
      isClosed = false;
      if (count === 1) {
        const [a, b] = k.split('|').map(Number) as [number, number];
        boundaryEdges.push([a, b]);
      }
    }
  }

  return {
    mesh: { positions, normals, uvs, indices },
    report: {
      mergedVertices: merged,
      finalVertexCount: positions.length / 3,
      finalTriangleCount: indices.length / 3,
      isClosed,
      boundaryEdges,
    },
  };
}
