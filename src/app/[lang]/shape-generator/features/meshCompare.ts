/**
 * meshCompare.ts — Tolerance-aware geometry comparison for burn-in
 * regression checks. "Did this OCCT operation produce the same result
 * as the baseline run?" — answered without requiring bit-exact match,
 * because tessellation order and floating-point round-off vary.
 *
 * Metrics:
 *   - bbox centre & extent delta (mm)
 *   - approximate Hausdorff distance, sampled at N points
 *   - vertex / triangle count delta
 *
 * The Hausdorff distance is the worst-case point-to-set distance. We
 * approximate by sampling K vertices from A and finding the nearest
 * vertex in B, then vice-versa. The maximum of those minimum distances
 * is the bidirectional Hausdorff. For 5k vertices and K=200 samples
 * this runs in ~2ms on a modern laptop — well within the burn-in cron
 * budget.
 */

import * as THREE from 'three';

export interface MeshCompareOptions {
  /** Number of vertices to sample for Hausdorff approximation. */
  sampleCount?: number;
  /** Bbox-extent difference tolerance, mm. Hard fail above this. */
  bboxExtentTolerance?: number;
  /** Hausdorff distance threshold for "match", mm. */
  hausdorffTolerance?: number;
  /** Vertex count delta as fraction of baseline (e.g. 0.05 = ±5%). */
  vertexCountTolerance?: number;
}

export interface MeshCompareResult {
  /** Overall match decision (all metrics within tolerance). */
  match: boolean;
  /** Estimated Hausdorff distance, mm. -1 if comparison was rejected
   *  by an earlier gate. */
  hausdorffDistance: number;
  /** Bbox-centre offset in mm (Euclidean). */
  centroidDistance: number;
  /** Bbox-extent difference (sum of |dx,dy,dz|). */
  bboxExtentDelta: number;
  /** Vertex count of A minus B. */
  vertexCountDelta: number;
  /** Triangle count of A minus B. */
  triangleCountDelta: number;
  /** First gate that failed when match=false; null when match=true. */
  failedGate: 'no-position' | 'bbox-extent' | 'hausdorff' | 'vertex-count' | null;
}

function bboxOf(geo: THREE.BufferGeometry): { min: THREE.Vector3; max: THREE.Vector3; center: THREE.Vector3; size: THREE.Vector3 } | null {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb || !Number.isFinite(bb.min.x) || !Number.isFinite(bb.max.x)) return null;
  const center = new THREE.Vector3().addVectors(bb.min, bb.max).multiplyScalar(0.5);
  const size = new THREE.Vector3().subVectors(bb.max, bb.min);
  return { min: bb.min.clone(), max: bb.max.clone(), center, size };
}

/** Find the nearest vertex in `verts` (flat xyz array) to a target
 *  point. O(n) linear scan — fine for the few-thousand-vertex meshes
 *  the burn-in suite uses; swap for a KD-tree if we ever benchmark > 50k. */
function nearestDistance(target: THREE.Vector3, verts: Float32Array): number {
  let best = Infinity;
  for (let i = 0; i < verts.length; i += 3) {
    const dx = target.x - verts[i];
    const dy = target.y - verts[i + 1];
    const dz = target.z - verts[i + 2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** Pseudo-random sample of `k` distinct indices from `[0, n)`.
 *  Deterministic for reproducible burn-in comparisons. */
function sampleIndices(n: number, k: number, seed = 12345): number[] {
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  // LCG-based picker — fixed seed gives stable samples across runs.
  let state = seed;
  const taken = new Set<number>();
  const out: number[] = [];
  while (out.length < k && taken.size < n) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const idx = state % n;
    if (!taken.has(idx)) {
      taken.add(idx);
      out.push(idx);
    }
  }
  return out;
}

/** Flatten a geometry's positions into a Float32Array for fast scanning. */
function flatPositions(geo: THREE.BufferGeometry): Float32Array | null {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return null;
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    out[i * 3] = pos.getX(i);
    out[i * 3 + 1] = pos.getY(i);
    out[i * 3 + 2] = pos.getZ(i);
  }
  return out;
}

/**
 * Compare two geometries and return whether they're equivalent within
 * the configured tolerances, plus the underlying metrics for debug.
 */
export function compareMeshes(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
  opts: MeshCompareOptions = {},
): MeshCompareResult {
  const sampleCount = opts.sampleCount ?? 200;
  const bboxTol = opts.bboxExtentTolerance ?? 0.1;
  const hausdorffTol = opts.hausdorffTolerance ?? 0.5;
  const vertexTol = opts.vertexCountTolerance ?? 0.10;

  const posA = flatPositions(a);
  const posB = flatPositions(b);
  if (!posA || !posB) {
    return {
      match: false,
      hausdorffDistance: -1,
      centroidDistance: -1,
      bboxExtentDelta: -1,
      vertexCountDelta: 0,
      triangleCountDelta: 0,
      failedGate: 'no-position',
    };
  }

  const bbA = bboxOf(a);
  const bbB = bboxOf(b);
  let bboxExtentDelta = -1;
  let centroidDistance = -1;
  if (bbA && bbB) {
    centroidDistance = bbA.center.distanceTo(bbB.center);
    bboxExtentDelta =
      Math.abs(bbA.size.x - bbB.size.x) +
      Math.abs(bbA.size.y - bbB.size.y) +
      Math.abs(bbA.size.z - bbB.size.z);
  }

  const vertexCountA = posA.length / 3;
  const vertexCountB = posB.length / 3;
  const idxA = a.index ? a.index.count / 3 : vertexCountA / 3;
  const idxB = b.index ? b.index.count / 3 : vertexCountB / 3;

  // Gate 1: bbox extent.
  if (bboxExtentDelta > bboxTol) {
    return {
      match: false,
      hausdorffDistance: -1,
      centroidDistance,
      bboxExtentDelta,
      vertexCountDelta: vertexCountA - vertexCountB,
      triangleCountDelta: idxA - idxB,
      failedGate: 'bbox-extent',
    };
  }

  // Gate 2: vertex count parity (loose).
  const baseline = Math.max(1, vertexCountB);
  const vDelta = Math.abs(vertexCountA - vertexCountB) / baseline;
  if (vDelta > vertexTol) {
    return {
      match: false,
      hausdorffDistance: -1,
      centroidDistance,
      bboxExtentDelta,
      vertexCountDelta: vertexCountA - vertexCountB,
      triangleCountDelta: idxA - idxB,
      failedGate: 'vertex-count',
    };
  }

  // Gate 3: Hausdorff distance (sampled both directions, pick the max).
  const samplesA = sampleIndices(vertexCountA, sampleCount);
  const samplesB = sampleIndices(vertexCountB, sampleCount, 67890);
  const targetA = new THREE.Vector3();
  const targetB = new THREE.Vector3();
  let hausdorff = 0;
  for (const i of samplesA) {
    targetA.set(posA[i * 3], posA[i * 3 + 1], posA[i * 3 + 2]);
    const d = nearestDistance(targetA, posB);
    if (d > hausdorff) hausdorff = d;
  }
  for (const i of samplesB) {
    targetB.set(posB[i * 3], posB[i * 3 + 1], posB[i * 3 + 2]);
    const d = nearestDistance(targetB, posA);
    if (d > hausdorff) hausdorff = d;
  }

  const match = hausdorff <= hausdorffTol;
  return {
    match,
    hausdorffDistance: hausdorff,
    centroidDistance,
    bboxExtentDelta,
    vertexCountDelta: vertexCountA - vertexCountB,
    triangleCountDelta: idxA - idxB,
    failedGate: match ? null : 'hausdorff',
  };
}
