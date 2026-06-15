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

/** Boundary edges of a triangle mesh: undirected edges used by exactly one
 *  triangle, returned with the direction in which that triangle traverses them
 *  (so a side wall can be wound to oppose it). */
function boundaryEdges(indices: number[]): Array<[number, number]> {
  const seen = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
    for (let e = 0; e < 3; e++) {
      const u = tri[e]!, v = tri[(e + 1) % 3]!;
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      const rec = seen.get(key);
      if (rec) rec.count++;
      else seen.set(key, { a: u, b: v, count: 1 });
    }
  }
  const out: Array<[number, number]> = [];
  for (const r of seen.values()) if (r.count === 1) out.push([r.a, r.b]);
  return out;
}

/** Build a CLOSED offset-shell solid by pairing the original surface + an
 *  offset copy + side walls stitched along the open boundary. The walls make
 *  the result watertight (every edge shared by two triangles), so it is valid
 *  STL / OCCT solid input. */
export function thickenSurface(
  mesh: SurfaceMesh,
  thickness: number,
): SurfaceMesh {
  const top = offsetSurface(mesh, thickness);
  const bottom = mesh;
  const off = bottom.positions.length / 3; // top vertices are appended after bottom

  const positions: number[] = [...bottom.positions, ...top.positions];
  const normals: number[] = [...bottom.normals, ...top.normals];
  const uvs: number[] = [...bottom.uvs, ...top.uvs];

  // Original triangles + flipped top triangles (so the top faces outward).
  const indices: number[] = [...bottom.indices];
  for (let i = 0; i < top.indices.length; i += 3) {
    indices.push(
      top.indices[i + 2]! + off,
      top.indices[i + 1]! + off,
      top.indices[i]! + off,
    );
  }

  // Side walls along every open boundary edge of the original surface. For a
  // bottom directed edge (a→b) the wall is wound (b→a) so it opposes the bottom
  // edge, and (a+off→b+off) so it opposes the flipped top edge — closing both.
  for (const [a, b] of boundaryEdges(bottom.indices)) {
    indices.push(b, a, a + off);
    indices.push(b, a + off, b + off);
  }

  return { positions, normals, uvs, indices };
}
