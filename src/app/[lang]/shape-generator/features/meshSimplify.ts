/**
 * meshSimplify.ts — Mesh decimation for imported STEP files that
 * arrive with hundreds of thousands of triangles. Both the viewport
 * (renders 60 fps target) and the OCCT path (every triangle is
 * extra tolerance load) benefit from dropping the count by 5-10× when
 * the user is reviewing rather than editing.
 *
 * Algorithm: **uniform vertex clustering** (Rossignac & Borrel 1993).
 *  - Divide bbox into a regular grid of cells.
 *  - Cluster all vertices that land in the same cell.
 *  - Replace each cluster with its centroid; remap triangle indices.
 *  - Drop triangles whose three indices collapsed to ≤2 distinct vertices.
 *
 * Trade-offs vs Quadric Error Metrics (QEM):
 *  - Faster (O(n) vs O(n log n)) and simpler — no priority queue.
 *  - Lower geometric fidelity at the same triangle count.
 *  - Doesn't preserve sharp features as well — but the burn-in models
 *    we're decimating for cron analysis don't need feature preservation.
 *  - Topology is not formally guaranteed but rarely breaks in practice.
 *
 * QEM lands in a follow-up when we need <5% surface error at <10% tri
 * count. For now this is a "good enough" simplifier for cron + UI.
 */

import * as THREE from 'three';

export interface MeshSimplifyOptions {
  /** Target number of triangles. The decimator picks a grid resolution
   *  that lands close to this. */
  targetTriangleCount: number;
  /** Lower bound on grid resolution per axis. Default 4 — below this
   *  the cluster centroid collapses to nonsense on small features. */
  minGridDivisions?: number;
  /** Upper bound on grid resolution per axis. Default 256 — caps
   *  memory use on huge bboxes. */
  maxGridDivisions?: number;
}

export interface MeshSimplifyReport {
  triangleCountBefore: number;
  triangleCountAfter: number;
  vertexCountBefore: number;
  vertexCountAfter: number;
  /** Grid divisions chosen along each axis. */
  gridDivisions: number;
  /** Triangles dropped because their three vertices collapsed. */
  collapsedTriangles: number;
}

export interface MeshSimplifyResult {
  geometry: THREE.BufferGeometry;
  report: MeshSimplifyReport;
}

const DEFAULT_MIN_DIV = 4;
const DEFAULT_MAX_DIV = 256;

/** Pick a grid resolution that hits roughly the requested triangle
 *  count. We use the rule of thumb that uniform clustering reduces
 *  the triangle count proportionally to vertex count, and vertex
 *  count scales with grid³ for bulky meshes. */
function pickGridDivisions(
  vertexCount: number,
  targetTri: number,
  triBefore: number,
  minDiv: number,
  maxDiv: number,
): number {
  if (targetTri >= triBefore) return maxDiv; // no decimation needed
  // Heuristic: target_vertex ≈ targetTri / 2 (Euler formula for closed
  // manifold). target_vertex ≈ grid³ × (fraction filled). Assume 30%
  // fill for typical bounding boxes.
  const targetVerts = Math.max(8, targetTri / 2);
  const cubicGrid = Math.cbrt(targetVerts / 0.3);
  return Math.max(minDiv, Math.min(maxDiv, Math.round(cubicGrid)));
}

/** Decimate `geometry` toward `targetTriangleCount` via uniform vertex
 *  clustering. Returns a fresh geometry; input is untouched. */
export function simplifyMesh(
  geometry: THREE.BufferGeometry,
  opts: MeshSimplifyOptions,
): MeshSimplifyResult {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const minDiv = opts.minGridDivisions ?? DEFAULT_MIN_DIV;
  const maxDiv = opts.maxGridDivisions ?? DEFAULT_MAX_DIV;

  if (!pos) {
    return {
      geometry: geometry.clone(),
      report: {
        triangleCountBefore: 0, triangleCountAfter: 0,
        vertexCountBefore: 0, vertexCountAfter: 0,
        gridDivisions: 0, collapsedTriangles: 0,
      },
    };
  }

  const vertexCount = pos.count;
  const idx = geometry.index;
  const triCountBefore = idx ? idx.count / 3 : vertexCount / 3;

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb || !Number.isFinite(bb.min.x)) {
    return {
      geometry: geometry.clone(),
      report: {
        triangleCountBefore: triCountBefore, triangleCountAfter: triCountBefore,
        vertexCountBefore: vertexCount, vertexCountAfter: vertexCount,
        gridDivisions: 0, collapsedTriangles: 0,
      },
    };
  }

  const div = pickGridDivisions(vertexCount, opts.targetTriangleCount, triCountBefore, minDiv, maxDiv);
  const sx = (bb.max.x - bb.min.x) / div || 1;
  const sy = (bb.max.y - bb.min.y) / div || 1;
  const sz = (bb.max.z - bb.min.z) / div || 1;

  // Vertex → cluster id; cluster id → centroid accumulator.
  const clusterId = new Int32Array(vertexCount);
  interface Cluster { sumX: number; sumY: number; sumZ: number; count: number; newIdx: number; }
  const clusters = new Map<string, Cluster>();
  let nextClusterIdx = 0;

  for (let i = 0; i < vertexCount; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const cx = Math.floor((x - bb.min.x) / sx);
    const cy = Math.floor((y - bb.min.y) / sy);
    const cz = Math.floor((z - bb.min.z) / sz);
    const k = `${cx}|${cy}|${cz}`;
    let cluster = clusters.get(k);
    if (!cluster) {
      cluster = { sumX: 0, sumY: 0, sumZ: 0, count: 0, newIdx: nextClusterIdx++ };
      clusters.set(k, cluster);
    }
    cluster.sumX += x; cluster.sumY += y; cluster.sumZ += z; cluster.count++;
    clusterId[i] = cluster.newIdx;
  }

  // Build the simplified position attribute (one vertex per cluster).
  const newVertCount = nextClusterIdx;
  const newPositions = new Float32Array(newVertCount * 3);
  for (const c of clusters.values()) {
    newPositions[c.newIdx * 3]     = c.sumX / c.count;
    newPositions[c.newIdx * 3 + 1] = c.sumY / c.count;
    newPositions[c.newIdx * 3 + 2] = c.sumZ / c.count;
  }

  // Rebuild triangle indices via the cluster map; drop collapsed tris.
  const newIndices: number[] = [];
  let collapsedTriangles = 0;
  for (let t = 0; t < triCountBefore; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const c0 = clusterId[i0], c1 = clusterId[i1], c2 = clusterId[i2];
    if (c0 === c1 || c1 === c2 || c0 === c2) {
      collapsedTriangles++;
      continue;
    }
    newIndices.push(c0, c1, c2);
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  out.setIndex(newIndices);
  out.computeVertexNormals();

  return {
    geometry: out,
    report: {
      triangleCountBefore: triCountBefore,
      triangleCountAfter: newIndices.length / 3,
      vertexCountBefore: vertexCount,
      vertexCountAfter: newVertCount,
      gridDivisions: div,
      collapsedTriangles,
    },
  };
}
