/**
 * stlRepairDegenerate.ts — Clean a triangle mesh of degenerate
 * triangles before downstream processing.
 *
 * Mesh exporters / converters often produce *degenerate triangles*:
 *
 *   - **Zero-area** — three vertices that coincide.
 *   - **Sliver** — three nearly-collinear vertices (huge edge-length
 *     ratio).
 *   - **Duplicate vertex** — two triangles sharing the same vertex
 *     coordinates but different indices.
 *
 * Slicers, FEA mesher, OCCT importers all choke on these. Repair:
 *
 *   1. Collapse duplicate vertices (within ε).
 *   2. Drop triangles with < 3 distinct vertices.
 *   3. Drop triangles with area below ε.
 *   4. Optionally split slivers along their long edge.
 *
 * Report what was changed so the UI can flag "imported mesh
 * required N repairs".
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface RepairResult {
  /** Repaired mesh. */
  mesh: MeshArrays;
  /** Triangles dropped because area was < ε. */
  zeroAreaTriangleCount: number;
  /** Triangles dropped because their 3 vertices were duplicates. */
  duplicateVertexTriangleCount: number;
  /** Triangles flagged as slivers (kept unless splitSlivers = true). */
  sliverTriangleCount: number;
  /** Unique vertices remaining after dedup. */
  vertexCountAfter: number;
  /** Triangle count after repair. */
  triangleCountAfter: number;
  /** Vertices merged into duplicates. */
  mergedVertexCount: number;
}

export interface RepairOptions {
  /** Vertex-merge tolerance, mm. */
  mergeEpsilonMm: number;
  /** Triangle area threshold, mm². */
  minAreaMm2: number;
  /** Sliver: longest / shortest edge ratio above this is flagged. */
  sliverRatio: number;
  /** Drop sliver triangles entirely. */
  dropSlivers: boolean;
}

export const DEFAULT_OPTIONS: RepairOptions = {
  mergeEpsilonMm: 1e-4,
  minAreaMm2: 1e-6,
  sliverRatio: 100,
  dropSlivers: false,
};

// ── Top-level entry ────────────────────────────────────────────

export function repairMesh(mesh: MeshArrays, options: Partial<RepairOptions> = {}): RepairResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (mesh.positions.length === 0) {
    return {
      mesh: { positions: [], indices: [] },
      zeroAreaTriangleCount: 0,
      duplicateVertexTriangleCount: 0,
      sliverTriangleCount: 0,
      vertexCountAfter: 0,
      triangleCountAfter: 0,
      mergedVertexCount: 0,
    };
  }

  // Step 1: dedup vertices.
  const vertexCount = mesh.positions.length / 3;
  const oldToNew: number[] = new Array(vertexCount).fill(-1);
  const newPositions: number[] = [];
  const eps = opts.mergeEpsilonMm;
  // Spatial bucket for O(n) duplicate detection (assuming roughly grid-distributed verts).
  const bucketSize = Math.max(eps * 10, 1e-3);
  const buckets = new Map<string, number[]>();
  let merged = 0;
  for (let i = 0; i < vertexCount; i++) {
    const x = mesh.positions[i * 3]!;
    const y = mesh.positions[i * 3 + 1]!;
    const z = mesh.positions[i * 3 + 2]!;
    const key = `${Math.floor(x / bucketSize)}|${Math.floor(y / bucketSize)}|${Math.floor(z / bucketSize)}`;
    const bucket = buckets.get(key) ?? [];
    let foundIdx = -1;
    for (const candIdx of bucket) {
      const cx = newPositions[candIdx * 3]!;
      const cy = newPositions[candIdx * 3 + 1]!;
      const cz = newPositions[candIdx * 3 + 2]!;
      if (Math.abs(cx - x) < eps && Math.abs(cy - y) < eps && Math.abs(cz - z) < eps) {
        foundIdx = candIdx;
        break;
      }
    }
    if (foundIdx >= 0) {
      oldToNew[i] = foundIdx;
      merged++;
    } else {
      const newIdx = newPositions.length / 3;
      newPositions.push(x, y, z);
      bucket.push(newIdx);
      buckets.set(key, bucket);
      oldToNew[i] = newIdx;
    }
  }

  // Step 2 + 3 + 4: triangle-level filtering.
  const newIndices: number[] = [];
  let zeroAreaCount = 0;
  let dupVertexCount = 0;
  let sliverCount = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = oldToNew[mesh.indices[t]!]!;
    const b = oldToNew[mesh.indices[t + 1]!]!;
    const c = oldToNew[mesh.indices[t + 2]!]!;
    if (a === b || b === c || a === c) {
      dupVertexCount++;
      continue;
    }
    const pa = vertexAt(newPositions, a);
    const pb = vertexAt(newPositions, b);
    const pc = vertexAt(newPositions, c);
    const area = triangleArea(pa, pb, pc);
    if (area < opts.minAreaMm2) {
      zeroAreaCount++;
      continue;
    }
    const ratio = edgeRatio(pa, pb, pc);
    if (ratio > opts.sliverRatio) {
      sliverCount++;
      if (opts.dropSlivers) continue;
    }
    newIndices.push(a, b, c);
  }

  return {
    mesh: { positions: newPositions, indices: newIndices },
    zeroAreaTriangleCount: zeroAreaCount,
    duplicateVertexTriangleCount: dupVertexCount,
    sliverTriangleCount: sliverCount,
    vertexCountAfter: newPositions.length / 3,
    triangleCountAfter: newIndices.length / 3,
    mergedVertexCount: merged,
  };
}

// ── Geometry helpers ───────────────────────────────────────────

function vertexAt(positions: number[], i: number): [number, number, number] {
  return [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
}

export function triangleArea(p0: [number, number, number], p1: [number, number, number], p2: [number, number, number]): number {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return Math.hypot(cx, cy, cz) / 2;
}

export function edgeRatio(p0: [number, number, number], p1: [number, number, number], p2: [number, number, number]): number {
  const e01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const e12 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
  const e20 = Math.hypot(p0[0] - p2[0], p0[1] - p2[1], p0[2] - p2[2]);
  const max = Math.max(e01, e12, e20);
  const min = Math.min(e01, e12, e20);
  if (min < 1e-9) return Infinity;
  return max / min;
}

// ── Summary ────────────────────────────────────────────────────

export interface RepairSummary {
  inputTriangles: number;
  outputTriangles: number;
  trianglesRemoved: number;
  vertexReductionPct: number;
  cleanEnoughToProcess: boolean;
}

export function summarize(originalMesh: MeshArrays, result: RepairResult): RepairSummary {
  const originalTris = originalMesh.indices.length / 3;
  const originalVerts = originalMesh.positions.length / 3;
  const vReduction = originalVerts > 0 ? (1 - result.vertexCountAfter / originalVerts) * 100 : 0;
  return {
    inputTriangles: originalTris,
    outputTriangles: result.triangleCountAfter,
    trianglesRemoved: originalTris - result.triangleCountAfter,
    vertexReductionPct: vReduction,
    cleanEnoughToProcess: result.triangleCountAfter > 0,
  };
}
