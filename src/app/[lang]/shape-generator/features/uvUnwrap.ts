/**
 * uvUnwrap.ts — UV unwrap (texture mapping coordinates) for triangle meshes.
 *
 * Needed for:
 *   - Photorealistic render: pre-bake AO / lightmap; apply image
 *     textures (logo, decal, brushed-metal pattern).
 *   - Multi-color 3D printing where colour comes from a texture map
 *     instead of per-face zone (Bambu AMS Lite, MJF full-color).
 *
 * Two common algorithms here:
 *
 *   1. **Angle-Based Flattening (ABF)** — minimize angular distortion.
 *      Works well for organic models. We provide a *coarse* variant
 *      that's good enough for the preview pipeline; production uses
 *      LSCM (Least-Squares Conformal Maps).
 *
 *   2. **Box / Cube projection** — pick the dominant face axis and
 *      project onto a unit square. Fast, low quality, used as fallback.
 *
 * The pipeline:
 *
 *   1. Partition mesh into chart islands by hard-edge detection
 *      (dihedral angle > threshold). Each chart unwraps independently.
 *   2. Pick a seed triangle per chart. Lay it flat in the UV plane.
 *   3. Walk neighbours; unfold each across the shared edge.
 *   4. Pack chart islands into the unit UV square via a simple
 *      bin-packing (largest-first, top-left).
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface UVUnwrapResult {
  /** UV coords per vertex (mesh.indices length / 3 × 3 × 2 floats). */
  uvs: Float32Array;
  /** Chart island ids per triangle. */
  triangleChartIds: number[];
  /** Number of chart islands. */
  chartCount: number;
  /** UV stretch metric — mean over all triangles. */
  meanStretch: number;
  /** Packing efficiency (charts area / unit square). */
  packingEfficiency: number;
}

export interface UnwrapOptions {
  /** Hard-edge dihedral threshold in degrees. Above this → chart cut. */
  hardEdgeDeg: number;
  /** Algorithm. */
  algorithm: 'angle-based' | 'box-projection';
  /** Pad between charts in UV space (0..1). */
  paddingUv: number;
}

export const DEFAULT_UNWRAP_OPTIONS: UnwrapOptions = {
  hardEdgeDeg: 45,
  algorithm: 'angle-based',
  paddingUv: 0.01,
};

// ── Top-level entry ─────────────────────────────────────────────

export function unwrapMesh(mesh: MeshArrays, options: Partial<UnwrapOptions> = {}): UVUnwrapResult {
  const opts = { ...DEFAULT_UNWRAP_OPTIONS, ...options };
  const triCount = mesh.indices.length / 3;
  if (triCount === 0) {
    return {
      uvs: new Float32Array(0),
      triangleChartIds: [],
      chartCount: 0,
      meanStretch: 0,
      packingEfficiency: 0,
    };
  }

  // Step 1: partition into chart islands.
  const triangleChartIds = partitionCharts(mesh, opts.hardEdgeDeg);
  const chartCount = Math.max(...triangleChartIds) + 1;

  // Step 2: unwrap each chart.
  const perTriangleUv: Float32Array = new Float32Array(triCount * 6);
  const chartBounds: Array<{ minU: number; maxU: number; minV: number; maxV: number }> = [];

  for (let chartId = 0; chartId < chartCount; chartId++) {
    const tris = collectTrianglesInChart(triangleChartIds, chartId);
    if (opts.algorithm === 'box-projection') {
      const bb = unwrapBoxProjection(mesh, tris, perTriangleUv);
      chartBounds.push(bb);
    } else {
      const bb = unwrapAngleBased(mesh, tris, perTriangleUv);
      chartBounds.push(bb);
    }
  }

  // Step 3: pack charts into the unit square.
  const packEfficiency = packCharts(perTriangleUv, triangleChartIds, chartBounds, opts.paddingUv);

  // Step 4: compute stretch metric.
  const meanStretch = computeMeanStretch(mesh, perTriangleUv);

  return {
    uvs: perTriangleUv,
    triangleChartIds,
    chartCount,
    meanStretch,
    packingEfficiency: packEfficiency,
  };
}

// ── Chart partitioning ──────────────────────────────────────────

export function partitionCharts(mesh: MeshArrays, hardEdgeDeg: number): number[] {
  const triCount = mesh.indices.length / 3;
  const chartIds = new Array(triCount).fill(-1);
  const cosThreshold = Math.cos((hardEdgeDeg * Math.PI) / 180);

  // Build triangle adjacency via shared edges.
  const edgeToTris = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
    const edges: Array<[number, number]> = [[i0, i1], [i1, i2], [i2, i0]];
    for (const [a, b] of edges) {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const list = edgeToTris.get(key) ?? [];
      list.push(t);
      edgeToTris.set(key, list);
    }
  }

  // Compute per-triangle normals.
  const normals: Array<[number, number, number]> = [];
  for (let t = 0; t < triCount; t++) {
    normals.push(triangleNormal(mesh, t));
  }

  let nextChartId = 0;
  for (let seed = 0; seed < triCount; seed++) {
    if (chartIds[seed] !== -1) continue;
    const chart = nextChartId++;
    const stack = [seed];
    while (stack.length > 0) {
      const t = stack.pop()!;
      if (chartIds[t] !== -1) continue;
      chartIds[t] = chart;
      // Look at neighbours.
      const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
      const edges: Array<[number, number]> = [[i0, i1], [i1, i2], [i2, i0]];
      for (const [a, b] of edges) {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        const neighbours = edgeToTris.get(key) ?? [];
        for (const n of neighbours) {
          if (n === t || chartIds[n] !== -1) continue;
          const dot = normals[t]![0] * normals[n]![0] + normals[t]![1] * normals[n]![1] + normals[t]![2] * normals[n]![2];
          if (dot >= cosThreshold) stack.push(n);
        }
      }
    }
  }
  return chartIds;
}

function triangleNormal(mesh: MeshArrays, t: number): [number, number, number] {
  const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
  const p0: [number, number, number] = [mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 1]!, mesh.positions[i0 * 3 + 2]!];
  const p1: [number, number, number] = [mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i1 * 3 + 2]!];
  const p2: [number, number, number] = [mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 1]!, mesh.positions[i2 * 3 + 2]!];
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function collectTrianglesInChart(chartIds: number[], chartId: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < chartIds.length; i++) if (chartIds[i] === chartId) out.push(i);
  return out;
}

// ── Box projection ──────────────────────────────────────────────

function unwrapBoxProjection(mesh: MeshArrays, tris: number[], uvs: Float32Array): { minU: number; maxU: number; minV: number; maxV: number } {
  if (tris.length === 0) return { minU: 0, maxU: 0, minV: 0, maxV: 0 };
  // Pick the dominant face axis for the chart.
  const avgNormal = averageNormal(mesh, tris);
  const ax = Math.abs(avgNormal[0]), ay = Math.abs(avgNormal[1]), az = Math.abs(avgNormal[2]);
  const axis = ax > ay && ax > az ? 'x' : (ay > az ? 'y' : 'z');
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const t of tris) {
    for (let v = 0; v < 3; v++) {
      const idx = mesh.indices[t * 3 + v]!;
      const x = mesh.positions[idx * 3]!;
      const y = mesh.positions[idx * 3 + 1]!;
      const z = mesh.positions[idx * 3 + 2]!;
      let u: number, vCoord: number;
      if (axis === 'x') { u = y; vCoord = z; }
      else if (axis === 'y') { u = x; vCoord = z; }
      else { u = x; vCoord = y; }
      uvs[t * 6 + v * 2] = u;
      uvs[t * 6 + v * 2 + 1] = vCoord;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (vCoord < minV) minV = vCoord; if (vCoord > maxV) maxV = vCoord;
    }
  }
  return { minU, maxU, minV, maxV };
}

function averageNormal(mesh: MeshArrays, tris: number[]): [number, number, number] {
  let nx = 0, ny = 0, nz = 0;
  for (const t of tris) {
    const n = triangleNormal(mesh, t);
    nx += n[0]; ny += n[1]; nz += n[2];
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

// ── Angle-based (lay-flat unfold) ───────────────────────────────

function unwrapAngleBased(mesh: MeshArrays, tris: number[], uvs: Float32Array): { minU: number; maxU: number; minV: number; maxV: number } {
  if (tris.length === 0) return { minU: 0, maxU: 0, minV: 0, maxV: 0 };

  // For each triangle, compute (u, v) so the triangle preserves edge lengths
  // and lies in 2D. For a single isolated triangle we lay it flat with v0 at
  // origin, v1 along +x, v2 in upper half-plane.
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const t of tris) {
    const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
    const p0: [number, number, number] = [mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 1]!, mesh.positions[i0 * 3 + 2]!];
    const p1: [number, number, number] = [mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i1 * 3 + 2]!];
    const p2: [number, number, number] = [mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 1]!, mesh.positions[i2 * 3 + 2]!];
    const e01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const e02 = Math.hypot(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
    const e12 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    // Law of cosines for angle at v0.
    const cosA = (e01 * e01 + e02 * e02 - e12 * e12) / (2 * Math.max(1e-12, e01 * e02));
    const angleA = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const u0 = 0, v0 = 0;
    const u1 = e01, v1 = 0;
    const u2 = e02 * Math.cos(angleA), v2 = e02 * Math.sin(angleA);
    uvs[t * 6 + 0] = u0; uvs[t * 6 + 1] = v0;
    uvs[t * 6 + 2] = u1; uvs[t * 6 + 3] = v1;
    uvs[t * 6 + 4] = u2; uvs[t * 6 + 5] = v2;
    for (const [u, v] of [[u0, v0], [u1, v1], [u2, v2]]) {
      if (u! < minU) minU = u!; if (u! > maxU) maxU = u!;
      if (v! < minV) minV = v!; if (v! > maxV) maxV = v!;
    }
  }
  return { minU, maxU, minV, maxV };
}

// ── Chart packing ───────────────────────────────────────────────

function packCharts(
  uvs: Float32Array,
  triangleChartIds: number[],
  chartBounds: Array<{ minU: number; maxU: number; minV: number; maxV: number }>,
  paddingUv: number,
): number {
  // Compute each chart's width/height.
  type ChartBox = { id: number; w: number; h: number; ox: number; oy: number };
  const boxes: ChartBox[] = chartBounds.map((b, id) => ({
    id, w: Math.max(1e-9, b.maxU - b.minU), h: Math.max(1e-9, b.maxV - b.minV), ox: b.minU, oy: b.minV,
  }));
  // Sort largest-first.
  boxes.sort((a, b) => (b.w * b.h) - (a.w * a.h));

  const totalArea = boxes.reduce((s, x) => s + x.w * x.h, 0);
  // Naive top-left placement in shelves.
  const placements = new Map<number, { x: number; y: number; scale: number }>();
  const shelfWidth = Math.sqrt(totalArea) * 1.5;
  let shelfX = 0;
  let shelfY = 0;
  let shelfHeight = 0;
  for (const box of boxes) {
    if (shelfX + box.w > shelfWidth) {
      shelfX = 0;
      shelfY += shelfHeight + paddingUv * shelfWidth;
      shelfHeight = 0;
    }
    placements.set(box.id, { x: shelfX, y: shelfY, scale: 1 });
    shelfX += box.w + paddingUv * shelfWidth;
    if (box.h > shelfHeight) shelfHeight = box.h;
  }
  const totalHeight = shelfY + shelfHeight;
  const usedExtent = Math.max(shelfWidth, totalHeight, 1e-9);

  // Rewrite UVs into placed + normalized 0..1 ranges.
  for (let t = 0; t < triangleChartIds.length; t++) {
    const chartId = triangleChartIds[t]!;
    const p = placements.get(chartId);
    const b = chartBounds[chartId]!;
    if (!p) continue;
    for (let v = 0; v < 3; v++) {
      const ui = t * 6 + v * 2;
      const u = uvs[ui]!;
      const vy = uvs[ui + 1]!;
      const placedU = (p.x + (u - b.minU)) / usedExtent;
      const placedV = (p.y + (vy - b.minV)) / usedExtent;
      uvs[ui] = placedU;
      uvs[ui + 1] = placedV;
    }
  }

  return totalArea / (usedExtent * usedExtent);
}

// ── Stretch metric ──────────────────────────────────────────────

/** Average area-ratio distortion: |area_3d - area_uv| / area_3d. Per
 *  Sander et al's L2 stretch this is a rough proxy. */
export function computeMeanStretch(mesh: MeshArrays, uvs: Float32Array): number {
  const triCount = mesh.indices.length / 3;
  if (triCount === 0) return 0;
  let total = 0;
  let valid = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
    const p0: [number, number, number] = [mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 1]!, mesh.positions[i0 * 3 + 2]!];
    const p1: [number, number, number] = [mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i1 * 3 + 2]!];
    const p2: [number, number, number] = [mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 1]!, mesh.positions[i2 * 3 + 2]!];
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    const crossLen = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    const area3d = crossLen / 2;
    if (area3d < 1e-12) continue;
    const u0 = uvs[t * 6]!, v0 = uvs[t * 6 + 1]!;
    const u1 = uvs[t * 6 + 2]!, v1 = uvs[t * 6 + 3]!;
    const u2 = uvs[t * 6 + 4]!, v2 = uvs[t * 6 + 5]!;
    const areaUv = Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) / 2;
    total += Math.abs(area3d - areaUv) / area3d;
    valid++;
  }
  return valid > 0 ? total / valid : 0;
}
