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

// ─── Phase X6/X7 — Axis-aligned hole position detection ──────────────────

export type HoleAxis = 'x' | 'y' | 'z';

export interface DetectedHole {
  /** Which axis the cylinder is aligned to. */
  axis: HoleAxis;
  /** Cylinder axis location in the perpendicular plane (world coords).
   *  Z-axis: (cx, cy) = (worldX, worldY).
   *  X-axis: (cx, cy) = (worldY, worldZ).
   *  Y-axis: (cx, cy) = (worldX, worldZ).
   *
   *  Use `holeAxisToWorld(hole)` to get a [x, y, z] representative point. */
  cx: number;
  cy: number;
  /** Estimated hole diameter in mm (mean cylindrical radius × 2). */
  diameter: number;
  /** Vote count from the Hough accumulator — proxy for confidence. */
  voteCount: number;
}

/** Convert a detected hole's (cx, cy) to a representative world point.
 *  The "height" axis (along the cylinder) is set to 0 — callers that
 *  need a specific Z for a Z-axis hole should ignore this coordinate. */
export function holeAxisToWorld(h: DetectedHole): [number, number, number] {
  switch (h.axis) {
    case 'z': return [h.cx, h.cy, 0];
    case 'x': return [0, h.cx, h.cy];
    case 'y': return [h.cx, 0, h.cy];
  }
}

export interface DetectAxisAlignedHolesOptions {
  /** Cylinder axis to scan for. Default 'z' (matches intent emitter). */
  axis?: HoleAxis;
  /** Bounding box in world coords. Computed from geometry if omitted. */
  bbox?: { min: [number, number, number]; max: [number, number, number] };
  /** Hough grid cell size in mm. Smaller = more precise but slower. */
  cellSizeMm?: number;
  /** A triangle qualifies as "perpendicular to axis" when |n·axis|/|n|
   *  is below sin(this angle). Default 8° handles facet noise. */
  normalToleranceDeg?: number;
  /** Sample radii (mm) at which each triangle's normal-line votes. */
  radiiSamples?: number[];
  /** Minimum vote count for a grid cell to qualify as a peak. */
  minVotes?: number;
  /** A peak must be ≥ this fraction of the grid maximum. */
  peakRatioOfMax?: number;
}

/** @deprecated use DetectAxisAlignedHolesOptions */
export type DetectZAxisHolesOptions = Omit<DetectAxisAlignedHolesOptions, 'axis'>;

const DEFAULT_RADII: number[] = [1, 2, 3, 5, 8, 12, 18, 25, 35, 50];

/** Plane / height axis indices per cylinder direction.
 *  perpAxes = [i, j] gives the two coordinate indices for the perpendicular
 *  plane; axisIdx is the coordinate parallel to the cylinder axis. */
function axisIndices(axis: HoleAxis): { perpAxes: [number, number]; axisIdx: number } {
  switch (axis) {
    case 'z': return { perpAxes: [0, 1], axisIdx: 2 };
    case 'x': return { perpAxes: [1, 2], axisIdx: 0 };
    case 'y': return { perpAxes: [0, 2], axisIdx: 1 };
  }
}

/**
 * v2 — detect cylindrical holes whose axis is parallel to one of the
 * coordinate axes (X, Y, or Z, set via `opts.axis`, default Z).
 *
 * The intent emitter (`applyHole` in intentToScad) cuts holes along Z
 * by convention. v2 also supports X/Y for the general case (custom
 * write_scad sources, multi-axis assemblies).
 *
 * For each triangle whose normal is roughly perpendicular to the
 * selected axis, project rays at sampled radii in both ±normal
 * directions and vote in a 2D grid (the perpendicular plane). Peaks
 * in the grid correspond to cylinder axis positions.
 *
 * Limitations:
 *   - Only axis-aligned cylinders detected (no oblique angles).
 *   - Highly curved surfaces (sphere, torus) may emit false peaks.
 *   - Holes smaller than `cellSizeMm` won't separate cleanly.
 */
export function detectAxisAlignedHoles(
  geometry: THREE.BufferGeometry,
  opts: DetectAxisAlignedHolesOptions = {},
): DetectedHole[] {
  const axis: HoleAxis = opts.axis ?? 'z';
  const { perpAxes, axisIdx } = axisIndices(axis);
  return detectHolesAlongAxis(geometry, axis, perpAxes, axisIdx, opts);
}

/** v1 alias — kept for backwards compatibility with X6 callers. */
export function detectZAxisHoles(
  geometry: THREE.BufferGeometry,
  opts: DetectZAxisHolesOptions = {},
): DetectedHole[] {
  return detectAxisAlignedHoles(geometry, { ...opts, axis: 'z' });
}

/** Convenience: scan all 3 coordinate axes and return the union. Useful
 *  for arbitrary-geometry analysis where the agent doesn't know in
 *  advance which axis a hole was cut along. */
export function detectAllAxisAlignedHoles(
  geometry: THREE.BufferGeometry,
  opts: Omit<DetectAxisAlignedHolesOptions, 'axis'> = {},
): DetectedHole[] {
  return [
    ...detectAxisAlignedHoles(geometry, { ...opts, axis: 'x' }),
    ...detectAxisAlignedHoles(geometry, { ...opts, axis: 'y' }),
    ...detectAxisAlignedHoles(geometry, { ...opts, axis: 'z' }),
  ];
}

function detectHolesAlongAxis(
  geometry: THREE.BufferGeometry,
  axis: HoleAxis,
  perpAxes: [number, number],
  axisIdx: number,
  opts: DetectAxisAlignedHolesOptions,
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

  // Plane min/max for the perpendicular plane (a, b) coordinates.
  const [pi, pj] = perpAxes;
  const minA = bb.min[pi], minB = bb.min[pj];
  const maxA = bb.max[pi], maxB = bb.max[pj];
  const wCells = Math.max(1, Math.ceil((maxA - minA) / cellSize));
  const hCells = Math.max(1, Math.ceil((maxB - minB) / cellSize));

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
    // Vertex coords as [x, y, z] triples.
    const a: [number, number, number] = [posArr[i0]!, posArr[i0 + 1]!, posArr[i0 + 2]!];
    const b: [number, number, number] = [posArr[i1]!, posArr[i1 + 1]!, posArr[i1 + 2]!];
    const c: [number, number, number] = [posArr[i2]!, posArr[i2 + 1]!, posArr[i2 + 2]!];
    // Normal = (b-a) × (c-a), full 3D
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const n: [number, number, number] = [
      uy * vz - uz * vy,
      uz * vx - ux * vz,
      ux * vy - uy * vx,
    ];
    const nLen = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (nLen === 0) continue;

    // Perpendicular-to-axis gate: the axial component must be small.
    if (Math.abs(n[axisIdx]) / nLen > normalToleranceSin) continue;

    // In-plane normal, renormalized.
    const nA = n[pi], nB = n[pj];
    const nPlaneLen = Math.sqrt(nA * nA + nB * nB);
    if (nPlaneLen === 0) continue;
    const nAn = nA / nPlaneLen;
    const nBn = nB / nPlaneLen;

    const centA = (a[pi] + b[pi] + c[pi]) / 3;
    const centB = (a[pj] + b[pj] + c[pj]) / 3;

    candidates.push({ cx: centA, cy: centB, nx: nAn, ny: nBn });

    // Vote at each sample radius in both ± normal directions
    for (let ri = 0; ri < radii.length; ri++) {
      const r = radii[ri]!;
      for (let sign = -1; sign <= 1; sign += 2) {
        const pa = centA + sign * r * nAn;
        const pb = centB + sign * r * nBn;
        const col = Math.floor((pa - minA) / cellSize);
        const row = Math.floor((pb - minB) / cellSize);
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
        cx: minA + (col + 0.5) * cellSize,
        cy: minB + (row + 0.5) * cellSize,
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
        axis,
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

// ─── Phase X8 — Dihedral angle / fillet edge stats ────────────────────────

export interface DihedralStats {
  /** Edges shared by exactly 2 triangles (manifold edges only). */
  totalManifoldEdges: number;
  /** Edges with dihedral angle > sharpThresholdDeg (sharp corners). */
  sharpEdgeCount: number;
  /** Edges with dihedral in (flatThresholdDeg, sharpThresholdDeg) — the
   *  curvature signature of a fillet/rounded transition. */
  curvedEdgeCount: number;
  /** Edges with dihedral < flatThresholdDeg (coplanar neighbors). */
  flatEdgeCount: number;
  /** Maximum dihedral observed across all manifold edges, in degrees. */
  maxDihedralDeg: number;
  /** Mean dihedral, in degrees (weighted equally across edges). */
  meanDihedralDeg: number;
}

export interface ComputeDihedralStatsOptions {
  /** Vertex dedup tolerance (mm). Default 1 µm — same as topology. */
  tolMm?: number;
  /** Below this, an edge is "flat" (coplanar). Default 3°. */
  flatThresholdDeg?: number;
  /** Above this, an edge is "sharp" (90°-ish corner). Default 30°. */
  sharpThresholdDeg?: number;
}

/**
 * v1 — dihedral angle statistics across manifold edges.
 *
 * Used to verify that a `fillet` feature was actually applied: a part
 * with a fillet replaces all sharp 90° corners with smooth curved
 * transitions (small dihedrals between many small triangles). A
 * filleted box has sharpEdgeCount = 0 and many curvedEdges; an
 * un-filleted box has sharpEdgeCount = 12 (one per cube edge).
 *
 * Convention: dihedral = angle between the two triangle outward normals.
 *   0°    — coplanar (flat surface)
 *   90°   — sharp orthogonal corner
 *   180°  — fold-back (impossible for orientable manifold)
 */
export function computeDihedralStats(
  geometry: THREE.BufferGeometry,
  opts: ComputeDihedralStatsOptions = {},
): DihedralStats {
  const positions = geometry.attributes.position;
  if (!positions) {
    return {
      totalManifoldEdges: 0,
      sharpEdgeCount: 0,
      curvedEdgeCount: 0,
      flatEdgeCount: 0,
      maxDihedralDeg: 0,
      meanDihedralDeg: 0,
    };
  }
  const posArr = positions.array as ArrayLike<number>;
  const indexAttr = geometry.index;
  const tolMm = opts.tolMm ?? DEFAULT_DEDUP_TOL_MM;
  const flatThr = opts.flatThresholdDeg ?? 3;
  const sharpThr = opts.sharpThresholdDeg ?? 30;

  // Dedup vertices so triangles that "share" a position via float-equal
  // verts are recognised as edge-adjacent.
  const triCount = indexAttr
    ? Math.floor(indexAttr.count / 3)
    : Math.floor(posArr.length / 9);

  // Per-original-vertex → deduped-id
  const map = new Map<string, number>();
  let nextId = 0;
  const vertCount = posArr.length / 3;
  const vertId = new Int32Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    const x = Math.round(posArr[i * 3 + 0]! / tolMm);
    const y = Math.round(posArr[i * 3 + 1]! / tolMm);
    const z = Math.round(posArr[i * 3 + 2]! / tolMm);
    const key = `${x},${y},${z}`;
    let id = map.get(key);
    if (id === undefined) { id = nextId++; map.set(key, id); }
    vertId[i] = id;
  }

  // For each edge (sorted pair of deduped vertex ids), record the
  // adjacent triangles' outward normals.
  const edgeNormals = new Map<string, Array<[number, number, number]>>();

  for (let t = 0; t < triCount; t++) {
    let i0: number, i1: number, i2: number;
    if (indexAttr) {
      const idxArr = indexAttr.array as ArrayLike<number>;
      i0 = idxArr[t * 3 + 0]!;
      i1 = idxArr[t * 3 + 1]!;
      i2 = idxArr[t * 3 + 2]!;
    } else {
      i0 = t * 3 + 0;
      i1 = t * 3 + 1;
      i2 = t * 3 + 2;
    }
    const va = vertId[i0]!;
    const vb = vertId[i1]!;
    const vc = vertId[i2]!;
    if (va === vb || vb === vc || va === vc) continue;

    const ax = posArr[i0 * 3]!,    ay = posArr[i0 * 3 + 1]!, az = posArr[i0 * 3 + 2]!;
    const bx = posArr[i1 * 3]!,    by = posArr[i1 * 3 + 1]!, bz = posArr[i1 * 3 + 2]!;
    const cx = posArr[i2 * 3]!,    cy = posArr[i2 * 3 + 1]!, cz = posArr[i2 * 3 + 2]!;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nLen === 0) continue;
    const normal: [number, number, number] = [nx / nLen, ny / nLen, nz / nLen];

    const pairs: Array<[number, number]> = [[va, vb], [vb, vc], [va, vc]];
    for (const [u, v] of pairs) {
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      const list = edgeNormals.get(key);
      if (list) list.push(normal);
      else edgeNormals.set(key, [normal]);
    }
  }

  let total = 0, sharp = 0, curved = 0, flat = 0;
  let maxDeg = 0, sumDeg = 0;
  for (const list of edgeNormals.values()) {
    if (list.length !== 2) continue; // skip boundary / non-manifold
    total++;
    const [n1, n2] = list as [[number, number, number], [number, number, number]];
    const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
    const angleDeg = Math.acos(dot) * 180 / Math.PI;
    sumDeg += angleDeg;
    if (angleDeg > maxDeg) maxDeg = angleDeg;
    if (angleDeg >= sharpThr) sharp++;
    else if (angleDeg >= flatThr) curved++;
    else flat++;
  }

  return {
    totalManifoldEdges: total,
    sharpEdgeCount: sharp,
    curvedEdgeCount: curved,
    flatEdgeCount: flat,
    maxDihedralDeg: maxDeg,
    meanDihedralDeg: total > 0 ? sumDeg / total : 0,
  };
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
