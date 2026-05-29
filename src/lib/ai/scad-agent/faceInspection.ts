/**
 * faceInspection.ts — Phase X2 mesh topology + through-hole counting.
 *
 * Phase X1 closed the bbox check ("did the AI produce a 50mm cube?").
 * X2 closes the next-tier gap: "does the part have the right number of
 * through-holes?". Critical for verifying intents like
 * `{ shapeId: 'box', features: [{type:'hole'}, {type:'hole'}] }` where
 * bbox stays identical regardless of how many holes were drilled.
 *
 * Approach: Euler characteristic.
 *   For a closed orientable manifold mesh:  χ = V - E + F = 2 - 2g
 *   where g (genus) = number of topological handles = number of
 *   through-holes for a single-body part.
 *
 *   Blind holes do NOT change topology (genus 0) — they show up only
 *   as volume reduction, which is a Phase X3 follow-up.
 *
 * Pre-step: STLLoader returns non-indexed positions (each triangle's
 * 3 vertices are independent). We dedup by quantized position so the
 * topology counts match the geometric reality, not the rendering
 * detail. Tolerance: 1 µm, well below CAD resolution.
 *
 * Cost: O(F log F) for the position sort + dedup; cheap enough to run
 * after every render.
 */

import type * as THREE from 'three';

export interface MeshTopology {
  /** Deduplicated vertex count. */
  vertexCount: number;
  /** Triangle count (positions.count / 3). */
  faceCount: number;
  /** Unique edge count (sorted (a,b) pairs). */
  edgeCount: number;
  /** Euler characteristic: V - E + F. 2 = sphere/cube, 0 = torus, -2 = double torus. */
  eulerChar: number;
  /**
   * Topological genus = (2 - χ) / 2 for a single closed orientable
   * manifold body. null when the mesh isn't manifold (boundary edges,
   * multi-body, etc.) since genus is undefined there.
   */
  genus: number | null;
  /**
   * True iff every edge is shared by exactly 2 triangles (manifold +
   * closed). When false, genus is null because χ doesn't map cleanly
   * to g for boundary surfaces.
   */
  manifoldClosed: boolean;
  /** Number of edges that appear in exactly 1 triangle (boundary edges). */
  boundaryEdgeCount: number;
  /** Number of edges shared by 3+ triangles (non-manifold edges). */
  nonManifoldEdgeCount: number;
  /**
   * Number of connected components (bodies) found via BFS over shared
   * edges. Genus is only meaningful for a single body; multi-body parts
   * report `genus: null` with `componentCount > 1` so callers can detect
   * the case and route to Phase X3 component-aware counting.
   */
  componentCount: number;
}

/**
 * Default vertex dedup tolerance in millimeters. 1 µm is below CAD
 * design resolution (typically 0.01 mm = 10 µm) so we never merge two
 * intentionally-distinct vertices. Set higher for noisy meshes.
 */
export const DEFAULT_DEDUP_TOL_MM = 1e-3;

/**
 * Quantize a coordinate to an integer grid at the given tolerance.
 * Vertices that quantize to the same integer triple are considered
 * the same vertex. We round to nearest (not floor) so points on grid
 * boundaries don't split.
 */
function quantize(x: number, tol: number): number {
  return Math.round(x / tol);
}

/**
 * Build a deduplicated index buffer from a non-indexed positions array.
 * Returns the dedup map: triangles[i] = [v0, v1, v2] index triple,
 * uniqueVerts = number of distinct vertex positions.
 */
function dedupVerts(
  positions: ArrayLike<number>,
  tol: number,
): { triangles: Int32Array; uniqueVerts: number } {
  const vertCount = positions.length / 3;
  const map = new Map<string, number>();
  const indexOf = new Int32Array(vertCount);

  let nextId = 0;
  for (let i = 0; i < vertCount; i++) {
    const x = quantize(positions[i * 3 + 0]!, tol);
    const y = quantize(positions[i * 3 + 1]!, tol);
    const z = quantize(positions[i * 3 + 2]!, tol);
    const key = `${x},${y},${z}`;
    let id = map.get(key);
    if (id === undefined) {
      id = nextId++;
      map.set(key, id);
    }
    indexOf[i] = id;
  }

  const triCount = Math.floor(vertCount / 3);
  const triangles = new Int32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    triangles[t * 3 + 0] = indexOf[t * 3 + 0]!;
    triangles[t * 3 + 1] = indexOf[t * 3 + 1]!;
    triangles[t * 3 + 2] = indexOf[t * 3 + 2]!;
  }
  return { triangles, uniqueVerts: nextId };
}

/**
 * Compute mesh topology metrics. Operates on a THREE.BufferGeometry
 * (indexed or non-indexed); ignores normals/UVs.
 */
export function computeMeshTopology(
  geometry: THREE.BufferGeometry,
  tolMm: number = DEFAULT_DEDUP_TOL_MM,
): MeshTopology {
  const positionAttr = geometry.attributes.position;
  if (!positionAttr) {
    return {
      vertexCount: 0,
      faceCount: 0,
      edgeCount: 0,
      eulerChar: 0,
      genus: null,
      manifoldClosed: false,
      boundaryEdgeCount: 0,
      nonManifoldEdgeCount: 0,
      componentCount: 0,
    };
  }

  const positions = positionAttr.array as ArrayLike<number>;
  const indexAttr = geometry.index;

  // Build (triangles, uniqueVerts) — branch on indexed vs non-indexed.
  let triangles: Int32Array;
  let uniqueVerts: number;
  if (indexAttr) {
    // Indexed: dedup positions first (since duplicate positions can still
    // exist even with an index), then remap via the index.
    const dedup = dedupVerts(positions, tolMm);
    uniqueVerts = dedup.uniqueVerts;
    // Build a per-original-vertex → deduped-id map.
    const positionDedup = new Int32Array(positions.length / 3);
    {
      const map = new Map<string, number>();
      let next = 0;
      for (let i = 0; i < positions.length / 3; i++) {
        const x = quantize(positions[i * 3 + 0]!, tolMm);
        const y = quantize(positions[i * 3 + 1]!, tolMm);
        const z = quantize(positions[i * 3 + 2]!, tolMm);
        const key = `${x},${y},${z}`;
        let id = map.get(key);
        if (id === undefined) {
          id = next++;
          map.set(key, id);
        }
        positionDedup[i] = id;
      }
    }
    const idxArr = indexAttr.array as ArrayLike<number>;
    const triCount = Math.floor(idxArr.length / 3);
    triangles = new Int32Array(triCount * 3);
    for (let t = 0; t < triCount; t++) {
      triangles[t * 3 + 0] = positionDedup[idxArr[t * 3 + 0]!]!;
      triangles[t * 3 + 1] = positionDedup[idxArr[t * 3 + 1]!]!;
      triangles[t * 3 + 2] = positionDedup[idxArr[t * 3 + 2]!]!;
    }
  } else {
    const dedup = dedupVerts(positions, tolMm);
    triangles = dedup.triangles;
    uniqueVerts = dedup.uniqueVerts;
  }

  const faceCount = triangles.length / 3;

  // Count edges + how many triangles share each. Also build an
  // edge → triangle-ids index so we can BFS connected components.
  const edgeUseCount = new Map<string, number>();
  const edgeToTris = new Map<string, number[]>();
  for (let t = 0; t < faceCount; t++) {
    const a = triangles[t * 3 + 0]!;
    const b = triangles[t * 3 + 1]!;
    const c = triangles[t * 3 + 2]!;
    if (a === b || b === c || a === c) continue; // degenerate triangle
    const pairs: Array<[number, number]> = [
      [a, b], [b, c], [a, c],
    ];
    for (const [u, v] of pairs) {
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      edgeUseCount.set(key, (edgeUseCount.get(key) ?? 0) + 1);
      const list = edgeToTris.get(key);
      if (list) list.push(t);
      else edgeToTris.set(key, [t]);
    }
  }

  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const count of edgeUseCount.values()) {
    if (count === 1) boundaryEdgeCount++;
    else if (count > 2) nonManifoldEdgeCount++;
  }

  const edgeCount = edgeUseCount.size;
  const eulerChar = uniqueVerts - edgeCount + faceCount;
  const manifoldClosed = boundaryEdgeCount === 0 && nonManifoldEdgeCount === 0;

  // BFS connected components over triangle adjacency. Two triangles are
  // adjacent if they share at least one edge.
  let componentCount = 0;
  {
    const seen = new Uint8Array(faceCount);
    for (let t0 = 0; t0 < faceCount; t0++) {
      if (seen[t0]) continue;
      componentCount++;
      const stack = [t0];
      seen[t0] = 1;
      while (stack.length > 0) {
        const t = stack.pop()!;
        const a = triangles[t * 3 + 0]!;
        const b = triangles[t * 3 + 1]!;
        const c = triangles[t * 3 + 2]!;
        const pairs: Array<[number, number]> = [
          [a, b], [b, c], [a, c],
        ];
        for (const [u, v] of pairs) {
          const key = u < v ? `${u}-${v}` : `${v}-${u}`;
          const neighbors = edgeToTris.get(key);
          if (!neighbors) continue;
          for (const n of neighbors) {
            if (!seen[n]) {
              seen[n] = 1;
              stack.push(n);
            }
          }
        }
      }
    }
  }

  // Genus only well-defined for a *single-body* closed orientable
  // manifold. Multi-body or open meshes → null so callers don't act on
  // a nonsense number.
  let genus: number | null = null;
  if (manifoldClosed && componentCount === 1) {
    const raw = (2 - eulerChar) / 2;
    if (Number.isInteger(raw) && raw >= 0) genus = raw;
  }

  return {
    vertexCount: uniqueVerts,
    faceCount,
    edgeCount,
    eulerChar,
    genus,
    manifoldClosed,
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    componentCount,
  };
}

/**
 * Convenience: estimate through-hole count from genus. Returns null if
 * the mesh isn't a clean closed manifold (blind-hole detection is X3).
 */
export function countThroughHoles(geometry: THREE.BufferGeometry, tolMm?: number): number | null {
  return computeMeshTopology(geometry, tolMm).genus;
}

export interface HoleCountMismatch {
  expected: number;
  detected: number;
  delta: number;
}

/**
 * Compare expected through-hole count (from intent) against detected
 * (from mesh genus). Returns null when detection isn't possible —
 * caller should NOT report a mismatch in that case.
 */
export function compareHoleCount(
  expected: number,
  detectedGenus: number | null,
): HoleCountMismatch | null {
  if (detectedGenus === null) return null;
  if (expected === detectedGenus) return null;
  return {
    expected,
    detected: detectedGenus,
    delta: detectedGenus - expected,
  };
}
