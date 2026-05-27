/**
 * meshSpikeDetector.ts — Detect "spike" vertices in a triangle mesh:
 * vertices that protrude well beyond the local neighbourhood average.
 *
 * Spikes appear when:
 *
 *   - Reconstruction (photogrammetry, mesh-from-points) produces
 *     outlier points.
 *   - STL exporters with floating-point glitches.
 *   - Hand-edited meshes with stray vertices.
 *
 * Spikes break slicing, FEA, and 3D-print path planning.
 *
 * Module:
 *   - Builds a vertex-to-vertex adjacency from the triangle list.
 *   - For each vertex, computes a "spikiness" metric = distance from
 *     vertex to centroid of its one-ring neighbourhood, normalized
 *     by neighbourhood mean-edge length.
 *   - Flags vertices with spikiness > threshold.
 *   - Suggests smoothing (move to centroid) or deletion (collapse to
 *     neighbour).
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Triangle {
  id: string;
  v0: number;
  v1: number;
  v2: number;
}

export interface MeshData {
  vertices: Vec3[];
  triangles: Triangle[];
}

export interface SpikeOptions {
  /** Spikiness ratio (distance / mean-edge length) above which to flag. */
  spikinessThreshold: number;
  /** Minimum neighbour count (vertices with < this are skipped). */
  minNeighbours: number;
}

export const DEFAULT_OPTIONS: SpikeOptions = {
  spikinessThreshold: 2.0,
  minNeighbours: 3,
};

export interface SpikeVertex {
  vertexIndex: number;
  position: Vec3;
  /** Mean neighbour position. */
  neighbourCentroid: Vec3;
  /** Distance from position to centroid. */
  protrusionMm: number;
  spikinessRatio: number;
  /** Suggested action: smooth (move) or delete (remove + retri). */
  suggestedAction: 'smooth' | 'delete';
}

export interface DetectionResult {
  spikes: SpikeVertex[];
  scannedVertexCount: number;
  meanSpikiness: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function detectSpikes(mesh: MeshData, options: Partial<SpikeOptions> = {}): DetectionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const adjacency = buildAdjacency(mesh);
  const spikes: SpikeVertex[] = [];
  let totalSpikiness = 0;
  let scanned = 0;
  for (let i = 0; i < mesh.vertices.length; i++) {
    const neighbours = adjacency.get(i) ?? new Set<number>();
    if (neighbours.size < opts.minNeighbours) continue;
    scanned++;
    const stats = computeSpikiness(i, mesh.vertices, neighbours);
    totalSpikiness += stats.spikinessRatio;
    if (stats.spikinessRatio > opts.spikinessThreshold) {
      spikes.push({
        vertexIndex: i,
        position: mesh.vertices[i]!,
        neighbourCentroid: stats.centroid,
        protrusionMm: stats.protrusion,
        spikinessRatio: stats.spikinessRatio,
        suggestedAction: stats.spikinessRatio > opts.spikinessThreshold * 2 ? 'delete' : 'smooth',
      });
    }
  }
  return {
    spikes,
    scannedVertexCount: scanned,
    meanSpikiness: scanned === 0 ? 0 : totalSpikiness / scanned,
  };
}

function buildAdjacency(mesh: MeshData): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  for (const t of mesh.triangles) {
    addEdge(adj, t.v0, t.v1);
    addEdge(adj, t.v1, t.v2);
    addEdge(adj, t.v2, t.v0);
  }
  return adj;
}

function addEdge(adj: Map<number, Set<number>>, a: number, b: number): void {
  if (!adj.has(a)) adj.set(a, new Set());
  if (!adj.has(b)) adj.set(b, new Set());
  adj.get(a)!.add(b);
  adj.get(b)!.add(a);
}

function computeSpikiness(
  vIdx: number,
  vertices: Vec3[],
  neighbours: Set<number>,
): { centroid: Vec3; protrusion: number; spikinessRatio: number } {
  const v = vertices[vIdx]!;
  let cx = 0, cy = 0, cz = 0;
  for (const ni of neighbours) {
    const n = vertices[ni]!;
    cx += n.x;
    cy += n.y;
    cz += n.z;
  }
  const count = neighbours.size;
  const centroid: Vec3 = { x: cx / count, y: cy / count, z: cz / count };
  const protrusion = Math.hypot(v.x - centroid.x, v.y - centroid.y, v.z - centroid.z);
  // Scale: standard deviation of neighbour positions from their own centroid.
  // This is the lateral spread, ignoring how far the spike itself protrudes.
  let varSum = 0;
  for (const ni of neighbours) {
    const n = vertices[ni]!;
    varSum += (n.x - centroid.x) ** 2 + (n.y - centroid.y) ** 2 + (n.z - centroid.z) ** 2;
  }
  const stddev = Math.sqrt(varSum / count);
  const spikiness = stddev === 0 ? (protrusion === 0 ? 0 : Infinity) : protrusion / stddev;
  return { centroid, protrusion, spikinessRatio: spikiness };
}

// ── Smoothing helper (Laplacian) ─────────────────────────────

export function applySmoothing(mesh: MeshData, spike: SpikeVertex): MeshData {
  const newVertices = mesh.vertices.slice();
  newVertices[spike.vertexIndex] = spike.neighbourCentroid;
  return { vertices: newVertices, triangles: mesh.triangles };
}

// ── Severity classifier ─────────────────────────────────────

export type SpikeSeverity = 'minor' | 'major' | 'critical';

export function severity(spike: SpikeVertex): SpikeSeverity {
  if (spike.spikinessRatio > 5) return 'critical';
  if (spike.spikinessRatio > 3) return 'major';
  return 'minor';
}

// ── Summary ────────────────────────────────────────────────────

export interface SpikeSummary {
  vertexCount: number;
  spikeCount: number;
  spikeFraction: number;
  worstSpikinessRatio: number;
}

export function summarize(mesh: MeshData, result: DetectionResult): SpikeSummary {
  let worst = 0;
  for (const s of result.spikes) if (s.spikinessRatio > worst) worst = s.spikinessRatio;
  return {
    vertexCount: mesh.vertices.length,
    spikeCount: result.spikes.length,
    spikeFraction: result.scannedVertexCount === 0 ? 0 : result.spikes.length / result.scannedVertexCount,
    worstSpikinessRatio: worst,
  };
}
