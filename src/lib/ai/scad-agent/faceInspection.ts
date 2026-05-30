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
   * edges. For multi-body parts, see `perComponentGenus` and `totalGenus`
   * for the per-body / aggregate through-hole counts (X4).
   */
  componentCount: number;
  /**
   * X4 — Genus per connected component, in the order components are
   * discovered by BFS. null entries flag components that aren't closed
   * orientable manifolds (open boundary, non-manifold edges). Empty when
   * the mesh has no triangles.
   */
  perComponentGenus: Array<number | null>;
  /**
   * X4 — Sum of per-component genera = total number of through-holes
   * across all bodies. null when at least one component's genus is null
   * (the aggregate would be misleading then).
   */
  totalGenus: number | null;
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
      perComponentGenus: [],
      totalGenus: null,
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
  // adjacent if they share at least one edge. While we walk each
  // component we also tally its own V/E/F so we can compute per-body
  // genus (X4 multi-body support).
  let componentCount = 0;
  const perComponentGenus: Array<number | null> = [];
  {
    const seen = new Uint8Array(faceCount);
    for (let t0 = 0; t0 < faceCount; t0++) {
      if (seen[t0]) continue;
      componentCount++;
      const stack = [t0];
      seen[t0] = 1;
      const compVerts = new Set<number>();
      const compEdges = new Set<string>();
      let compFaces = 0;
      let compHasBoundary = false;
      let compHasNonManifold = false;
      while (stack.length > 0) {
        const t = stack.pop()!;
        compFaces++;
        const a = triangles[t * 3 + 0]!;
        const b = triangles[t * 3 + 1]!;
        const c = triangles[t * 3 + 2]!;
        compVerts.add(a); compVerts.add(b); compVerts.add(c);
        const pairs: Array<[number, number]> = [
          [a, b], [b, c], [a, c],
        ];
        for (const [u, v] of pairs) {
          const key = u < v ? `${u}-${v}` : `${v}-${u}`;
          compEdges.add(key);
          const sharedBy = edgeUseCount.get(key) ?? 0;
          if (sharedBy === 1) compHasBoundary = true;
          else if (sharedBy > 2) compHasNonManifold = true;
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
      // Per-component χ + genus.
      let compGenus: number | null = null;
      if (!compHasBoundary && !compHasNonManifold) {
        const compChi = compVerts.size - compEdges.size + compFaces;
        const raw = (2 - compChi) / 2;
        if (Number.isInteger(raw) && raw >= 0) compGenus = raw;
      }
      perComponentGenus.push(compGenus);
    }
  }

  // Backwards-compatible single-body genus (X2 callers).
  let genus: number | null = null;
  if (manifoldClosed && componentCount === 1) {
    const raw = (2 - eulerChar) / 2;
    if (Number.isInteger(raw) && raw >= 0) genus = raw;
  }

  // X4 — Total genus = sum of per-component genera. null if any
  // component's genus is null (we don't want to silently under-count).
  let totalGenus: number | null = 0;
  for (const g of perComponentGenus) {
    if (g === null) { totalGenus = null; break; }
    totalGenus += g;
  }
  if (perComponentGenus.length === 0) totalGenus = null;

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
    perComponentGenus,
    totalGenus,
  };
}

/**
 * Convenience: estimate the TOTAL through-hole count across all bodies.
 * X4 — returns the sum of per-component genera so a multi-body assembly
 * still gets a meaningful answer (where X2 would have returned null).
 * Returns null only when at least one component isn't a closed manifold.
 */
export function countThroughHoles(geometry: THREE.BufferGeometry, tolMm?: number): number | null {
  return computeMeshTopology(geometry, tolMm).totalGenus;
}

// ─── Phase X6 — Hole position detection (Z-axis v1) ───────────────────────

export interface DetectedHole {
  /** Cylinder axis location in the XY plane (world coords). */
  cx: number;
  cy: number;
  /** Estimated hole diameter in mm (mean cylindrical radius × 2). */
  diameter: number;
  /** Vote count from the Hough accumulator — proxy for confidence. */
  voteCount: number;
}

export interface DetectZAxisHolesOptions {
  /** Bounding box in world coords. Computed from geometry if omitted. */
  bbox?: { min: [number, number, number]; max: [number, number, number] };
  /** Hough grid cell size in mm. Smaller = more precise but slower. */
  cellSizeMm?: number;
  /** A triangle qualifies as "perpendicular to Z" when |nz|/|n| is
   *  below sin(this angle). Default 8° handles facet noise. */
  normalToleranceDeg?: number;
  /** Sample radii (mm) at which each triangle's normal-line votes.
   *  Cover the expected hole-radius range for the geometry. */
  radiiSamples?: number[];
  /** Minimum vote count for a grid cell to qualify as a peak. */
  minVotes?: number;
  /** A peak must be ≥ this fraction of the grid maximum. */
  peakRatioOfMax?: number;
}

const DEFAULT_RADII: number[] = [1, 2, 3, 5, 8, 12, 18, 25, 35, 50];

/**
 * v1 — detect cylindrical holes whose axis is parallel to Z.
 *
 * The intent emitter (`applyHole` in intentToScad) always cuts holes
 * along the Z axis, so v1 covers the common case. For each triangle
 * whose normal is roughly perpendicular to Z, project rays at sampled
 * radii in both ±normal directions and vote in a 2D XY grid. Peaks
 * in the grid correspond to cylinder axis positions.
 *
 * Limitations:
 *   - Only Z-aligned cylinders detected.
 *   - Highly curved surfaces (sphere, torus) may emit false peaks.
 *   - Holes smaller than `cellSizeMm` won't separate cleanly.
 */
export function detectZAxisHoles(
  geometry: THREE.BufferGeometry,
  opts: DetectZAxisHolesOptions = {},
): DetectedHole[] {
  const positions = geometry.attributes.position;
  if (!positions) return [];
  const posArr = positions.array as ArrayLike<number>;
  const indexAttr = geometry.index;

  // Resolve bbox
  let bb = opts.bbox;
  if (!bb) {
    const cloned = geometry.clone();
    cloned.computeBoundingBox();
    const b = cloned.boundingBox;
    if (!b) return [];
    bb = { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
  }

  const cellSize = opts.cellSizeMm ?? 1;
  const normalToleranceSin = Math.sin((opts.normalToleranceDeg ?? 8) * Math.PI / 180);
  const radii = opts.radiiSamples ?? DEFAULT_RADII;
  const minVotes = opts.minVotes ?? 12;
  const peakRatio = opts.peakRatioOfMax ?? 0.5;

  const minX = bb.min[0], minY = bb.min[1];
  const maxX = bb.max[0], maxY = bb.max[1];
  const wCells = Math.max(1, Math.ceil((maxX - minX) / cellSize));
  const hCells = Math.max(1, Math.ceil((maxY - minY) / cellSize));

  // Cap grid size so a pathological bbox doesn't OOM (500×500 = 250k cells).
  if (wCells > 500 || hCells > 500) return [];

  const grid = new Int32Array(wCells * hCells);

  // Collect candidates so we can compute radius after finding peaks.
  const candidates: Array<{ cx: number; cy: number; nx: number; ny: number }> = [];

  const triCount = indexAttr
    ? Math.floor(indexAttr.count / 3)
    : Math.floor(posArr.length / 9);

  for (let t = 0; t < triCount; t++) {
    let i0: number, i1: number, i2: number;
    if (indexAttr) {
      const idxArr = indexAttr.array as ArrayLike<number>;
      i0 = idxArr[t * 3 + 0]! * 3;
      i1 = idxArr[t * 3 + 1]! * 3;
      i2 = idxArr[t * 3 + 2]! * 3;
    } else {
      i0 = t * 9;
      i1 = t * 9 + 3;
      i2 = t * 9 + 6;
    }
    const ax = posArr[i0]!,    ay = posArr[i0 + 1]!, az = posArr[i0 + 2]!;
    const bx = posArr[i1]!,    by = posArr[i1 + 1]!, bz = posArr[i1 + 2]!;
    const cx = posArr[i2]!,    cy = posArr[i2 + 1]!, cz = posArr[i2 + 2]!;
    // Normal = (b-a) × (c-a)
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nLen === 0) continue;

    // Perpendicular-to-Z gate
    if (Math.abs(nz) / nLen > normalToleranceSin) continue;

    // XY normal, renormalized so |n_xy| = 1
    const nXy = Math.sqrt(nx * nx + ny * ny);
    if (nXy === 0) continue;
    const nxN = nx / nXy;
    const nyN = ny / nXy;

    const centX = (ax + bx + cx) / 3;
    const centY = (ay + by + cy) / 3;

    candidates.push({ cx: centX, cy: centY, nx: nxN, ny: nyN });

    // Vote at each sample radius in both ± normal directions
    for (let ri = 0; ri < radii.length; ri++) {
      const r = radii[ri]!;
      for (let sign = -1; sign <= 1; sign += 2) {
        const px = centX + sign * r * nxN;
        const py = centY + sign * r * nyN;
        const col = Math.floor((px - minX) / cellSize);
        const row = Math.floor((py - minY) / cellSize);
        if (col >= 0 && col < wCells && row >= 0 && row < hCells) {
          grid[row * wCells + col]++;
        }
      }
    }
  }

  // Find global max for the ratio threshold
  let globalMax = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i]! > globalMax) globalMax = grid[i]!;
  const effectiveMin = Math.max(minVotes, Math.ceil(globalMax * peakRatio));

  // Local-maxima scan: a cell qualifies if its vote ≥ effectiveMin AND it's
  // ≥ each of its 8 (or fewer at edges) neighbors. Suppress neighbors within
  // a 3-cell radius after emitting a peak so a noisy cluster yields one hole.
  const peaks: Array<{ cx: number; cy: number; voteCount: number }> = [];
  const suppressed = new Uint8Array(wCells * hCells);
  for (let row = 0; row < hCells; row++) {
    for (let col = 0; col < wCells; col++) {
      const idx = row * wCells + col;
      if (suppressed[idx]) continue;
      const v = grid[idx]!;
      if (v < effectiveMin) continue;
      let isPeak = true;
      for (let dr = -1; dr <= 1 && isPeak; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const r2 = row + dr, c2 = col + dc;
          if (r2 < 0 || r2 >= hCells || c2 < 0 || c2 >= wCells) continue;
          if (grid[r2 * wCells + c2]! > v) { isPeak = false; break; }
        }
      }
      if (!isPeak) continue;
      peaks.push({
        cx: minX + (col + 0.5) * cellSize,
        cy: minY + (row + 0.5) * cellSize,
        voteCount: v,
      });
      // Suppress a 5×5 neighborhood (2-cell radius) to deduplicate.
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const r2 = row + dr, c2 = col + dc;
          if (r2 < 0 || r2 >= hCells || c2 < 0 || c2 >= wCells) continue;
          suppressed[r2 * wCells + c2] = 1;
        }
      }
    }
  }

  // Estimate radius per peak: inlier-distance mean. An inlier is a
  // candidate triangle whose normal-line passes within ±cellSize of the
  // peak point (perpendicular distance) AND whose distance from the peak
  // is within the radii-sample range.
  const results: DetectedHole[] = [];
  for (const peak of peaks) {
    let radiusSum = 0;
    let inlierCount = 0;
    for (const c of candidates) {
      // Perpendicular distance from peak to the normal-line through c.
      // Line passes through (c.cx, c.cy) with direction (c.nx, c.ny);
      // perpendicular distance = |(peak - c) × direction|.
      const dx = peak.cx - c.cx;
      const dy = peak.cy - c.cy;
      const cross = Math.abs(dx * c.ny - dy * c.nx);
      if (cross > cellSize) continue;
      const along = Math.sqrt(dx * dx + dy * dy);
      if (along < 0.5 || along > radii[radii.length - 1]! + cellSize) continue;
      radiusSum += along;
      inlierCount++;
    }
    if (inlierCount >= 6) {
      results.push({
        cx: peak.cx,
        cy: peak.cy,
        diameter: 2 * (radiusSum / inlierCount),
        voteCount: peak.voteCount,
      });
    }
  }

  // Sort peaks by vote descending for stable output.
  results.sort((a, b) => b.voteCount - a.voteCount);
  return results;
}

/**
 * X5 — compute mesh surface area (sum of triangle areas, mm²).
 *
 * Used by spec verification to catch errors that bbox + volume + genus
 * all pass: missing ribs, extra fins, wrong wall counts in a hollow
 * enclosure. A 50mm cube has expected area 15000 mm²; if the AI
 * accidentally made a hollow shell (6 outer + 6 inner faces), area
 * jumps to ~30000 mm² while bbox and volume look almost identical.
 *
 * Works on indexed or non-indexed BufferGeometry. Cost O(F).
 */
export function computeSurfaceArea(geometry: THREE.BufferGeometry): number {
  const positions = geometry.attributes.position;
  if (!positions) return 0;
  const posArr = positions.array as ArrayLike<number>;
  const indexAttr = geometry.index;

  let total = 0;
  const triCount = indexAttr
    ? Math.floor(indexAttr.count / 3)
    : Math.floor(posArr.length / 9);

  for (let t = 0; t < triCount; t++) {
    let i0: number, i1: number, i2: number;
    if (indexAttr) {
      const idxArr = indexAttr.array as ArrayLike<number>;
      i0 = idxArr[t * 3 + 0]! * 3;
      i1 = idxArr[t * 3 + 1]! * 3;
      i2 = idxArr[t * 3 + 2]! * 3;
    } else {
      i0 = t * 9;
      i1 = t * 9 + 3;
      i2 = t * 9 + 6;
    }
    const ax = posArr[i0]!,    ay = posArr[i0 + 1]!, az = posArr[i0 + 2]!;
    const bx = posArr[i1]!,    by = posArr[i1 + 1]!, bz = posArr[i1 + 2]!;
    const cx = posArr[i2]!,    cy = posArr[i2 + 1]!, cz = posArr[i2 + 2]!;
    // Edges
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    // Cross product magnitude / 2 = triangle area
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    total += 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
  }
  return total;
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
