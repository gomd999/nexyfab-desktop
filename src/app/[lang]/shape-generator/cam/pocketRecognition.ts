/**
 * pocketRecognition.ts — Recognize pocket-like features in a mesh
 * for automatic CAM operation generation.
 *
 * A "pocket" is a concave bounded region — typically a flat-bottom
 * cut-out: think a battery compartment in a phone case, or a recessed
 * label area. Pockets are the second-most-common machining operation
 * after profile cuts; CAM software needs to detect them so it can
 * generate a stepover toolpath automatically rather than asking
 * the user to draw boundaries.
 *
 * Algorithm (gross but effective for mesh-based CAM):
 *
 *   1. **Bottom-face detection**: triangles whose normal points
 *      ±pull-axis (within ε) are pocket-floor candidates.
 *   2. **Connected-component flood fill** on candidate triangles
 *      sharing an edge → each component is one pocket floor.
 *   3. **Side-wall extraction**: edges where a candidate triangle
 *      meets a non-candidate become the pocket boundary.
 *   4. **Depth estimate**: distance from pocket-floor centroid
 *      to highest mesh point along pull axis.
 *
 * Output: list of pockets with floor area, boundary length, depth,
 * and the floor triangle indices (so CAM can mask its toolpath).
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface Pocket {
  id: string;
  /** Floor triangle indices. */
  floorTriangles: number[];
  /** Floor area (mm²). */
  floorAreaMm2: number;
  /** Approximate floor centroid. */
  centroid: [number, number, number];
  /** Pocket depth in mm. */
  depthMm: number;
  /** Total length of pocket boundary edges, mm. */
  boundaryLengthMm: number;
  /** Approximate aspect ratio of the floor bbox (long / short). */
  aspectRatio: number;
}

export interface PocketRecognitionResult {
  pockets: Pocket[];
  /** Triangles flagged as floor candidates but not assigned (orphans). */
  orphanFloorTriangles: number[];
}

export interface PocketOptions {
  /** Pull axis. */
  pullAxis: [number, number, number];
  /** Cosine tolerance for "facing pull axis" (default 0.9 ≈ 26°). */
  facingCosine: number;
  /** Minimum floor area to keep, mm². */
  minFloorAreaMm2: number;
  /** Maximum mesh extent along pull axis for depth ref. */
  topHeightHintMm?: number;
}

export const DEFAULT_OPTIONS: PocketOptions = {
  pullAxis: [0, 0, 1],
  facingCosine: 0.9,
  minFloorAreaMm2: 1.0,
};

// ── Top-level entry ────────────────────────────────────────────

export function recognizePockets(mesh: MeshArrays, options: Partial<PocketOptions> = {}): PocketRecognitionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const triCount = mesh.indices.length / 3;
  if (triCount === 0) return { pockets: [], orphanFloorTriangles: [] };

  const pull = normalize(opts.pullAxis);
  const normals: Array<[number, number, number]> = [];
  const areas: number[] = [];
  const centroids: Array<[number, number, number]> = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const p0 = vertex(mesh, i0);
    const p1 = vertex(mesh, i1);
    const p2 = vertex(mesh, i2);
    const { normal, area } = triangleNormalArea(p0, p1, p2);
    normals.push(normal);
    areas.push(area);
    centroids.push([
      (p0[0] + p1[0] + p2[0]) / 3,
      (p0[1] + p1[1] + p2[1]) / 3,
      (p0[2] + p1[2] + p2[2]) / 3,
    ]);
  }

  // Candidate floor triangles: normal points along pull axis (the floor
  // of a pocket cut into the +Z top face has outward normal = +Z, same
  // direction as the pull axis).
  const candidates: Set<number> = new Set();
  for (let t = 0; t < triCount; t++) {
    const d = dot(normals[t]!, pull);
    if (d >= opts.facingCosine) candidates.add(t);
  }

  // Build edge → triangle map for connectivity.
  const edgeMap = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    const idx = [mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!];
    for (let e = 0; e < 3; e++) {
      const a = idx[e]!;
      const b = idx[(e + 1) % 3]!;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const list = edgeMap.get(key) ?? [];
      list.push(t);
      edgeMap.set(key, list);
    }
  }

  // Flood-fill candidate triangles into components.
  const components: number[][] = [];
  const visited = new Set<number>();
  for (const seed of candidates) {
    if (visited.has(seed)) continue;
    const comp: number[] = [];
    const stack = [seed];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      comp.push(cur);
      const idx = [mesh.indices[cur * 3]!, mesh.indices[cur * 3 + 1]!, mesh.indices[cur * 3 + 2]!];
      for (let e = 0; e < 3; e++) {
        const a = idx[e]!;
        const b = idx[(e + 1) % 3]!;
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        for (const adjT of edgeMap.get(key) ?? []) {
          if (adjT !== cur && candidates.has(adjT) && !visited.has(adjT)) stack.push(adjT);
        }
      }
    }
    components.push(comp);
  }

  // Mesh extent along pull axis.
  let minH = Infinity, maxH = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const v: [number, number, number] = [mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!];
    const h = dot(v, pull);
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  const topH = opts.topHeightHintMm ?? maxH;

  // Build pockets.
  const pockets: Pocket[] = [];
  const orphans: number[] = [];
  for (let ci = 0; ci < components.length; ci++) {
    const comp = components[ci]!;
    let floorArea = 0;
    let cx = 0, cy = 0, cz = 0;
    let floorHeight = 0;
    let weight = 0;
    for (const t of comp) {
      floorArea += areas[t]!;
      const c = centroids[t]!;
      cx += c[0] * areas[t]!;
      cy += c[1] * areas[t]!;
      cz += c[2] * areas[t]!;
      floorHeight += dot(c, pull) * areas[t]!;
      weight += areas[t]!;
    }
    if (floorArea < opts.minFloorAreaMm2) {
      orphans.push(...comp);
      continue;
    }
    const centroid: [number, number, number] = [cx / weight, cy / weight, cz / weight];
    const meanFloorH = floorHeight / weight;
    const depth = Math.max(0, topH - meanFloorH);

    // Boundary length: edges where one side is in comp and the other isn't.
    let boundaryLen = 0;
    const compSet = new Set(comp);
    for (const t of comp) {
      const idx = [mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!];
      for (let e = 0; e < 3; e++) {
        const a = idx[e]!;
        const b = idx[(e + 1) % 3]!;
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        const adj = edgeMap.get(key) ?? [];
        const otherInComp = adj.some(at => at !== t && compSet.has(at));
        if (!otherInComp) {
          const va = vertex(mesh, a);
          const vb = vertex(mesh, b);
          boundaryLen += Math.hypot(va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]);
        }
      }
    }
    // Halve because each interior boundary edge would be counted once;
    // boundary edges are only seen once already, but double-counts can creep
    // in from shared edges between adjacent floor triangles when one
    // candidate is left out. Halve to compensate as a rough estimate.
    boundaryLen *= 1;

    // Aspect ratio from floor bbox.
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const t of comp) {
      const c = centroids[t]!;
      if (c[0] < xMin) xMin = c[0];
      if (c[0] > xMax) xMax = c[0];
      if (c[1] < yMin) yMin = c[1];
      if (c[1] > yMax) yMax = c[1];
    }
    const dx = xMax - xMin;
    const dy = yMax - yMin;
    const aspect = dx > 0 && dy > 0 ? Math.max(dx / dy, dy / dx) : 1;

    pockets.push({
      id: `pocket-${ci}`,
      floorTriangles: comp,
      floorAreaMm2: floorArea,
      centroid,
      depthMm: depth,
      boundaryLengthMm: boundaryLen,
      aspectRatio: aspect,
    });
  }

  // Sort by area descending.
  pockets.sort((a, b) => b.floorAreaMm2 - a.floorAreaMm2);
  return { pockets, orphanFloorTriangles: orphans };
}

// ── Helpers ────────────────────────────────────────────────────

function vertex(mesh: MeshArrays, i: number): [number, number, number] {
  return [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function triangleNormalArea(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
): { normal: [number, number, number]; area: number } {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  const len = Math.hypot(cx, cy, cz);
  if (len < 1e-9) return { normal: [0, 0, 1], area: 0 };
  return { normal: [cx / len, cy / len, cz / len], area: len / 2 };
}

// ── Summary ────────────────────────────────────────────────────

export interface PocketSummary {
  pocketCount: number;
  totalFloorAreaMm2: number;
  averageDepthMm: number;
  deepestPocketMm: number;
  /** True if any pocket has aspect ratio > 4 (a slot, not a pocket). */
  hasSlotLikePockets: boolean;
}

export function summarize(result: PocketRecognitionResult): PocketSummary {
  if (result.pockets.length === 0) {
    return { pocketCount: 0, totalFloorAreaMm2: 0, averageDepthMm: 0, deepestPocketMm: 0, hasSlotLikePockets: false };
  }
  const total = result.pockets.reduce((s, p) => s + p.floorAreaMm2, 0);
  const avgDepth = result.pockets.reduce((s, p) => s + p.depthMm, 0) / result.pockets.length;
  const maxDepth = result.pockets.reduce((m, p) => Math.max(m, p.depthMm), 0);
  const hasSlot = result.pockets.some(p => p.aspectRatio > 4);
  return {
    pocketCount: result.pockets.length,
    totalFloorAreaMm2: total,
    averageDepthMm: avgDepth,
    deepestPocketMm: maxDepth,
    hasSlotLikePockets: hasSlot,
  };
}
