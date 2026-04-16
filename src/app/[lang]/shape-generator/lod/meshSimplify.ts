import * as THREE from 'three';
import { simplifyQEM } from './qemSimplify';

/**
 * Simplify a BufferGeometry using vertex clustering.
 *
 * Divides the geometry's bounding box into a uniform grid whose resolution is
 * derived from `targetRatio`. All vertices that fall into the same cell are
 * merged into one representative vertex (the centroid of the cluster).
 * Degenerate triangles (where two or more corners collapse into the same cell)
 * are discarded.
 *
 * Used as a fast fallback for very simple meshes (≤200 triangles).
 *
 * @param geometry  Source BufferGeometry (indexed or non-indexed).
 * @param targetRatio  0.0–1.0 — fraction of triangles to keep (0.5 = ~half).
 * @returns A new, non-indexed BufferGeometry with reduced triangle count.
 */
function vertexClusterSimplify(
  geometry: THREE.BufferGeometry,
  targetRatio: number,
): THREE.BufferGeometry {
  // Clamp ratio
  const ratio = Math.max(0.01, Math.min(1.0, targetRatio));
  if (ratio >= 1.0) return geometry.clone();

  // Work with non-indexed geometry for simplicity
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const posAttr = src.attributes.position as THREE.BufferAttribute;
  const vertexCount = posAttr.count;
  const triCount = Math.floor(vertexCount / 3);

  if (triCount === 0) return geometry.clone();

  // Compute bounding box
  src.computeBoundingBox();
  const box = src.boundingBox!;
  const size = box.getSize(new THREE.Vector3());

  // Determine grid resolution from ratio.
  // Higher ratio → more cells → less merging → more triangles kept.
  // We use cube-root scaling: cells per axis ~ triCount^(1/3) * ratio^(1/3)
  const cellsPerAxis = Math.max(
    2,
    Math.round(Math.pow(triCount, 1 / 3) * Math.pow(ratio, 1 / 3)),
  );
  const cellSize = new THREE.Vector3(
    (size.x || 1) / cellsPerAxis,
    (size.y || 1) / cellsPerAxis,
    (size.z || 1) / cellsPerAxis,
  );

  const min = box.min;

  // ---------- Pass 1: assign each vertex to a cell, accumulate centroids ----------

  // cellKey → { sum, count, representative index }
  const cellMap = new Map<string, { sx: number; sy: number; sz: number; count: number; idx: number }>();
  const vertexCell = new Int32Array(vertexCount); // maps vertex → cell representative idx
  let nextIdx = 0;

  // Temporary arrays to hold representative positions (we'll fill them after pass 1)
  const cellKeys: string[] = new Array(vertexCount);

  for (let i = 0; i < vertexCount; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);

    const cx = Math.floor((x - min.x) / cellSize.x);
    const cy = Math.floor((y - min.y) / cellSize.y);
    const cz = Math.floor((z - min.z) / cellSize.z);
    const key = `${cx},${cy},${cz}`;
    cellKeys[i] = key;

    let cell = cellMap.get(key);
    if (!cell) {
      cell = { sx: 0, sy: 0, sz: 0, count: 0, idx: nextIdx++ };
      cellMap.set(key, cell);
    }
    cell.sx += x;
    cell.sy += y;
    cell.sz += z;
    cell.count += 1;
    vertexCell[i] = cell.idx;
  }

  // Build representative position array
  const repPositions = new Float32Array(cellMap.size * 3);
  for (const cell of cellMap.values()) {
    const inv = 1 / cell.count;
    repPositions[cell.idx * 3] = cell.sx * inv;
    repPositions[cell.idx * 3 + 1] = cell.sy * inv;
    repPositions[cell.idx * 3 + 2] = cell.sz * inv;
  }

  // ---------- Pass 2: rebuild triangles, skip degenerate ones ----------

  const outPositions: number[] = [];
  const hasNormals = !!src.attributes.normal;

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    const i1 = i0 + 1;
    const i2 = i0 + 2;

    const c0 = vertexCell[i0];
    const c1 = vertexCell[i1];
    const c2 = vertexCell[i2];

    // Skip degenerate triangles (two or more vertices collapsed to same cell)
    if (c0 === c1 || c1 === c2 || c0 === c2) continue;

    outPositions.push(
      repPositions[c0 * 3], repPositions[c0 * 3 + 1], repPositions[c0 * 3 + 2],
      repPositions[c1 * 3], repPositions[c1 * 3 + 1], repPositions[c1 * 3 + 2],
      repPositions[c2 * 3], repPositions[c2 * 3 + 1], repPositions[c2 * 3 + 2],
    );
  }

  // Build output geometry
  const result = new THREE.BufferGeometry();
  const posArray = new Float32Array(outPositions);
  result.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

  // Recompute normals for the simplified mesh
  result.computeVertexNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();

  return result;
}

/**
 * Simplify a BufferGeometry, automatically selecting the best algorithm:
 *
 * - Meshes with >200 triangles use Quadric Error Metrics (QEM) which preserves
 *   sharp features (gears, fillets, flanges) far better than grid-based methods.
 * - Simpler meshes fall back to vertex clustering (faster, quality difference
 *   is negligible at low triangle counts).
 *
 * This is the public API consumed by `useLOD`. The parameter names are
 * intentionally identical to the previous export so no call-sites need changing.
 *
 * @param geometry  Source BufferGeometry (indexed or non-indexed).
 * @param targetRatio  0.0–1.0 — fraction of triangles to keep (0.5 = ~half).
 * @returns A new, non-indexed BufferGeometry with reduced triangle count.
 */
export function simplifyGeometry(
  geometry: THREE.BufferGeometry,
  targetRatio: number,
): THREE.BufferGeometry {
  const triCount = geometry.index
    ? Math.floor(geometry.index.count / 3)
    : Math.floor((geometry.getAttribute('position')?.count ?? 0) / 3);

  // QEM for meshes complex enough to benefit from quality-aware simplification
  if (triCount > 200) {
    const result = simplifyQEM(geometry, {
      targetRatio,
      preserveBoundary: true,
    });
    return result.geometry;
  }

  // Vertex clustering for very simple meshes (faster, no perceptible quality loss)
  return vertexClusterSimplify(geometry, targetRatio);
}
