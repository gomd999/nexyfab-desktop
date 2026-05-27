/**
 * meshletBuilder.ts — Meshlet partitioning for GPU mesh shading.
 *
 * GPU mesh shaders (Vulkan / Metal / WebGPU once it lands) process
 * geometry in fixed-size chunks called **meshlets** — small clusters
 * of triangles + a bounded vertex set. Compared to the classic vertex
 * → fragment pipeline they let the GPU:
 *
 *   - Cull invisible clusters before doing per-vertex work.
 *   - Stream geometry from memory in cache-friendly chunks.
 *   - Run a per-meshlet compute stage (LOD selection, animation).
 *
 * Constraints (NVIDIA / NVMesh defaults, also matches Vulkan limits):
 *   - ≤ 64 unique vertices per meshlet (one byte index → 256 possible
 *     but the GPU registers cap it at 64).
 *   - ≤ 124 triangles per meshlet.
 *
 * This builder takes a flat triangle list and outputs:
 *   - meshlet record array (vertex offset, vertex count, triangle
 *     offset, triangle count, bounding sphere)
 *   - global vertex index buffer (4-byte indices into original mesh)
 *   - local-relative triangle index buffer (1-byte indices into the
 *     meshlet's vertex set)
 *
 * Algorithm: greedy region-growing — seed from an arbitrary triangle,
 * keep adding adjacent triangles whose unique-vertex count stays
 * under the cap.
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface Meshlet {
  /** Offset into the global vertex-index buffer. */
  vertexOffset: number;
  /** Number of unique vertices in this meshlet. */
  vertexCount: number;
  /** Offset into the local triangle-index buffer. */
  triangleOffset: number;
  /** Triangle count (3 indices each). */
  triangleCount: number;
  /** Bounding sphere center (mm). */
  centerMm: [number, number, number];
  /** Bounding sphere radius (mm). */
  radiusMm: number;
}

export interface MeshletBuildResult {
  meshlets: Meshlet[];
  /** Global vertex indices that meshlets reference. */
  vertexIndices: Uint32Array;
  /** Local triangle indices (each in [0, meshlet.vertexCount)). */
  triangleIndices: Uint8Array;
  /** Build stats. */
  stats: MeshletStats;
}

export interface MeshletStats {
  meshletCount: number;
  averageVerticesPerMeshlet: number;
  averageTrianglesPerMeshlet: number;
  /** Total unique vertex references (with duplication across meshlets). */
  totalVertexReferences: number;
}

export interface BuildOptions {
  /** Maximum unique vertices per meshlet (≤ 64 typical). */
  maxVertices: number;
  /** Maximum triangles per meshlet (≤ 124 typical). */
  maxTriangles: number;
}

export const DEFAULT_BUILD_OPTIONS: BuildOptions = {
  maxVertices: 64,
  maxTriangles: 124,
};

// ── Top-level entry ─────────────────────────────────────────────

export function buildMeshlets(mesh: MeshArrays, options: Partial<BuildOptions> = {}): MeshletBuildResult {
  const opts = { ...DEFAULT_BUILD_OPTIONS, ...options };
  const triCount = mesh.indices.length / 3;
  if (triCount === 0) {
    return {
      meshlets: [],
      vertexIndices: new Uint32Array(0),
      triangleIndices: new Uint8Array(0),
      stats: { meshletCount: 0, averageVerticesPerMeshlet: 0, averageTrianglesPerMeshlet: 0, totalVertexReferences: 0 },
    };
  }

  // Build triangle adjacency for region growing.
  const adjacency = buildAdjacency(mesh);

  const triangleAssigned = new Array<boolean>(triCount).fill(false);
  const meshlets: Meshlet[] = [];
  const vertexIndicesOut: number[] = [];
  const triangleIndicesOut: number[] = [];

  for (let seed = 0; seed < triCount; seed++) {
    if (triangleAssigned[seed]) continue;
    const m = growMeshletFromSeed(mesh, adjacency, seed, triangleAssigned, opts);

    const vertexOffset = vertexIndicesOut.length;
    for (const v of m.vertexIndices) vertexIndicesOut.push(v);
    const triangleOffset = triangleIndicesOut.length;
    for (const t of m.localTriangleIndices) triangleIndicesOut.push(t);

    const sphere = computeBoundingSphere(mesh, m.vertexIndices);
    meshlets.push({
      vertexOffset,
      vertexCount: m.vertexIndices.length,
      triangleOffset,
      triangleCount: m.localTriangleIndices.length / 3,
      centerMm: sphere.center,
      radiusMm: sphere.radius,
    });
  }

  let avgVerts = 0, avgTris = 0;
  for (const m of meshlets) {
    avgVerts += m.vertexCount;
    avgTris += m.triangleCount;
  }
  avgVerts = meshlets.length > 0 ? avgVerts / meshlets.length : 0;
  avgTris = meshlets.length > 0 ? avgTris / meshlets.length : 0;

  return {
    meshlets,
    vertexIndices: new Uint32Array(vertexIndicesOut),
    triangleIndices: new Uint8Array(triangleIndicesOut),
    stats: {
      meshletCount: meshlets.length,
      averageVerticesPerMeshlet: avgVerts,
      averageTrianglesPerMeshlet: avgTris,
      totalVertexReferences: vertexIndicesOut.length,
    },
  };
}

// ── Region growing ──────────────────────────────────────────────

interface GrownMeshlet {
  vertexIndices: number[];
  localTriangleIndices: number[];
}

function growMeshletFromSeed(
  mesh: MeshArrays,
  adjacency: number[][],
  seed: number,
  assigned: boolean[],
  opts: BuildOptions,
): GrownMeshlet {
  const vertexSet = new Map<number, number>(); // globalIdx → localIdx
  const localTris: number[] = [];
  const queue = [seed];
  let triCount = 0;

  while (queue.length > 0) {
    const t = queue.shift()!;
    if (assigned[t]) continue;
    const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
    const newVerts = [];
    for (const v of [i0, i1, i2]) if (!vertexSet.has(v)) newVerts.push(v);

    const wouldExceedVerts = vertexSet.size + newVerts.length > opts.maxVertices;
    const wouldExceedTris = triCount + 1 > opts.maxTriangles;
    if (wouldExceedVerts || wouldExceedTris) {
      // Skip — this triangle won't fit in this meshlet.
      continue;
    }
    for (const v of newVerts) vertexSet.set(v, vertexSet.size);
    localTris.push(vertexSet.get(i0)!, vertexSet.get(i1)!, vertexSet.get(i2)!);
    triCount++;
    assigned[t] = true;
    // Enqueue neighbours.
    for (const nb of adjacency[t] ?? []) {
      if (!assigned[nb]) queue.push(nb);
    }
  }

  return {
    vertexIndices: [...vertexSet.keys()],
    localTriangleIndices: localTris,
  };
}

// ── Adjacency build ─────────────────────────────────────────────

function buildAdjacency(mesh: MeshArrays): number[][] {
  const triCount = mesh.indices.length / 3;
  const adj: number[][] = Array.from({ length: triCount }, () => []);
  const edgeToTris = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const key = a! < b! ? `${a}_${b}` : `${b}_${a}`;
      const list = edgeToTris.get(key) ?? [];
      list.push(t);
      edgeToTris.set(key, list);
    }
  }
  for (const tris of edgeToTris.values()) {
    if (tris.length === 2) {
      const [a, b] = tris;
      adj[a!]!.push(b!);
      adj[b!]!.push(a!);
    }
  }
  return adj;
}

// ── Bounding sphere ─────────────────────────────────────────────

function computeBoundingSphere(mesh: MeshArrays, vertexIndices: number[]): { center: [number, number, number]; radius: number } {
  if (vertexIndices.length === 0) return { center: [0, 0, 0], radius: 0 };
  let cx = 0, cy = 0, cz = 0;
  for (const v of vertexIndices) {
    cx += mesh.positions[v * 3]!;
    cy += mesh.positions[v * 3 + 1]!;
    cz += mesh.positions[v * 3 + 2]!;
  }
  cx /= vertexIndices.length;
  cy /= vertexIndices.length;
  cz /= vertexIndices.length;
  let r = 0;
  for (const v of vertexIndices) {
    const dx = mesh.positions[v * 3]! - cx;
    const dy = mesh.positions[v * 3 + 1]! - cy;
    const dz = mesh.positions[v * 3 + 2]! - cz;
    const d = Math.hypot(dx, dy, dz);
    if (d > r) r = d;
  }
  return { center: [cx, cy, cz], radius: r };
}

// ── Cone culling ────────────────────────────────────────────────

/** For each meshlet, compute a normal cone for back-face culling. The
 *  cone is the smallest cone containing all triangle normals; if its
 *  axis points away from camera and the cone fits within ±90°, the
 *  whole meshlet is back-facing. */
export interface MeshletCone {
  axis: [number, number, number];
  /** cos(half-angle) — small means tight cone. */
  cosHalfAngle: number;
}

export function buildMeshletCones(mesh: MeshArrays, result: MeshletBuildResult): MeshletCone[] {
  const cones: MeshletCone[] = [];
  for (const m of result.meshlets) {
    let nx = 0, ny = 0, nz = 0;
    for (let t = 0; t < m.triangleCount; t++) {
      const local0 = result.triangleIndices[m.triangleOffset + t * 3]!;
      const local1 = result.triangleIndices[m.triangleOffset + t * 3 + 1]!;
      const local2 = result.triangleIndices[m.triangleOffset + t * 3 + 2]!;
      const g0 = result.vertexIndices[m.vertexOffset + local0]!;
      const g1 = result.vertexIndices[m.vertexOffset + local1]!;
      const g2 = result.vertexIndices[m.vertexOffset + local2]!;
      const p0: [number, number, number] = [mesh.positions[g0 * 3]!, mesh.positions[g0 * 3 + 1]!, mesh.positions[g0 * 3 + 2]!];
      const p1: [number, number, number] = [mesh.positions[g1 * 3]!, mesh.positions[g1 * 3 + 1]!, mesh.positions[g1 * 3 + 2]!];
      const p2: [number, number, number] = [mesh.positions[g2 * 3]!, mesh.positions[g2 * 3 + 1]!, mesh.positions[g2 * 3 + 2]!];
      const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
      const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
      const cx = ay * bz - az * by;
      const cy = az * bx - ax * bz;
      const cz = ax * by - ay * bx;
      const len = Math.hypot(cx, cy, cz) || 1;
      nx += cx / len; ny += cy / len; nz += cz / len;
    }
    const axisLen = Math.hypot(nx, ny, nz) || 1;
    const axis: [number, number, number] = [nx / axisLen, ny / axisLen, nz / axisLen];
    // cos half-angle = min normal · axis, but we use mean as a quick proxy.
    cones.push({ axis, cosHalfAngle: m.triangleCount > 0 ? axisLen / m.triangleCount : 1 });
  }
  return cones;
}

// ── Validation ──────────────────────────────────────────────────

export function validateMeshlets(result: MeshletBuildResult, opts: BuildOptions = DEFAULT_BUILD_OPTIONS): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  for (let i = 0; i < result.meshlets.length; i++) {
    const m = result.meshlets[i]!;
    if (m.vertexCount > opts.maxVertices) issues.push(`Meshlet ${i} vertex count ${m.vertexCount} > ${opts.maxVertices}`);
    if (m.triangleCount > opts.maxTriangles) issues.push(`Meshlet ${i} triangle count ${m.triangleCount} > ${opts.maxTriangles}`);
    // Local indices must be < vertexCount.
    for (let t = 0; t < m.triangleCount * 3; t++) {
      const idx = result.triangleIndices[m.triangleOffset + t]!;
      if (idx >= m.vertexCount) {
        issues.push(`Meshlet ${i} local index ${idx} >= vertexCount ${m.vertexCount}`);
      }
    }
  }
  return { valid: issues.length === 0, issues };
}
