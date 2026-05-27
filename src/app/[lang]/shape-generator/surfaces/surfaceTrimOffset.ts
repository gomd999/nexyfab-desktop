/**
 * surfaceTrimOffset.ts — UV trim + normal-direction offset.
 *
 * Trim: discard regions of a surface outside (or inside) a closed
 * polyline drawn in UV-parameter space. The trim loop is given as
 * a list of (u, v) vertices. Output is a flag per tessellation
 * vertex indicating "inside" / "outside" so the caller can render
 * trimmed regions invisible or generate the appropriate triangle
 * mask.
 *
 * Offset: move every surface point along its local normal by a
 * scalar distance. Used to make thick-walled solids from a single
 * surface ("thicken").
 *
 * Both operations are post-evaluation — they take a tessellated
 * surface mesh + UVs and produce derived data, not a new analytic
 * surface. Good enough for preview / display.
 */

import type { SurfaceMesh } from './nurbsSurface';

export interface TrimLoop {
  /** Closed polyline in (u, v) parameter space. */
  vertices: Array<[number, number]>;
  /** 'inside' = keep inside the loop, 'outside' = keep outside. */
  retain: 'inside' | 'outside';
}

/** Even-odd point-in-polygon test in UV space. */
export function pointInTrimLoop(loop: TrimLoop, uv: [number, number]): boolean {
  const [px, py] = uv;
  let inside = false;
  const v = loop.vertices;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const xi = v[i]![0], yi = v[i]![1];
    const xj = v[j]![0], yj = v[j]![1];
    if (((yi > py) !== (yj > py))
      && (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return loop.retain === 'inside' ? inside : !inside;
}

/** Returns an array of booleans (per-vertex) — true = kept. */
export function classifyTrim(mesh: SurfaceMesh, loops: TrimLoop[]): boolean[] {
  const kept: boolean[] = [];
  for (let i = 0; i < mesh.uvs.length; i += 2) {
    const u = mesh.uvs[i]!;
    const v = mesh.uvs[i + 1]!;
    let keep = true;
    for (const loop of loops) {
      if (!pointInTrimLoop(loop, [u, v])) { keep = false; break; }
    }
    kept.push(keep);
  }
  return kept;
}

/** Filter triangle indices to only those whose all 3 verts are kept. */
export function filterTrimmedTriangles(mesh: SurfaceMesh, kept: boolean[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i]!;
    const b = mesh.indices[i + 1]!;
    const c = mesh.indices[i + 2]!;
    if (kept[a] && kept[b] && kept[c]) {
      out.push(a, b, c);
    }
  }
  return out;
}

// ── Offset ──────────────────────────────────────────────────────────

/** Offset every vertex along its normal by `distance` (mm). */
export function offsetSurface(mesh: SurfaceMesh, distance: number): SurfaceMesh {
  const positions = mesh.positions.slice();
  for (let i = 0; i < positions.length; i += 3) {
    positions[i]     += mesh.normals[i]!     * distance;
    positions[i + 1] += mesh.normals[i + 1]! * distance;
    positions[i + 2] += mesh.normals[i + 2]! * distance;
  }
  return {
    positions,
    normals: mesh.normals.slice(),
    uvs: mesh.uvs.slice(),
    indices: mesh.indices.slice(),
  };
}

/** Build a closed offset-shell solid by pairing the original surface
 *  + an offset copy + side walls along the boundary. Returns a
 *  triangle-mesh-style result suitable for STL / OCCT input. */
export function thickenSurface(
  mesh: SurfaceMesh,
  thickness: number,
): SurfaceMesh {
  const top = offsetSurface(mesh, thickness);
  const bottom = mesh;
  const topVerts = top.positions.length / 3;

  const positions: number[] = [...bottom.positions, ...top.positions];
  const normals: number[] = [...bottom.normals, ...top.normals];
  const uvs: number[] = [...bottom.uvs, ...top.uvs];

  // Original triangles + flipped top triangles.
  const indices: number[] = [...bottom.indices];
  for (let i = 0; i < top.indices.length; i += 3) {
    indices.push(
      top.indices[i + 2]! + topVerts,
      top.indices[i + 1]! + topVerts,
      top.indices[i]! + topVerts,
    );
  }

  return { positions, normals, uvs, indices };
}
