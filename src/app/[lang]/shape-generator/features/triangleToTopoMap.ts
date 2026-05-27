/**
 * triangleToTopoMap.ts — Per-triangle ↔ topology hash mapping.
 *
 * Phase 2 step A (existing in `pipelineManager`) stamps every output
 * triangle with the *feature ID* that produced it via the
 * `nfabFaceFeatureId` BufferAttribute. That's coarse — you know
 * "this triangle came from feature X" but not "this triangle came
 * from edge Y of sketch Z extruded by feature X".
 *
 * Phase 2 step B (here) adds the fine-grained per-triangle map that
 * downstream selection (fillet, chamfer, click-to-select) needs:
 *
 *   - **Triangle → persistent topology hash**: a string like
 *     `extrude1_sweep_sketch0_line_3` or `extrude1_cap_top`.
 *   - **Hash → current triangle indices**: reverse lookup used by
 *     the renderer's hover/highlight + by recovery code after a
 *     parameter change reshuffles indices.
 *
 * The map is built per-pipeline-run by features that know their
 * source segments (currently sketchExtrude + revolve) and persisted
 * onto the output geometry's userData.
 *
 * Memory shape: roughly 1 × Uint32 per triangle (24 byte average per
 * unique hash). A 100k-triangle preview spends ~400 KB, which is
 * acceptable for a CAD app.
 */

import * as THREE from 'three';

export const TOPO_MAP_USER_DATA_KEY = 'nfabTopoMap';

export interface TriangleTopoMap {
  /** Length = triangle count. Each entry is a numeric hash key. */
  triangleToKey: Uint32Array;
  /** Reverse: numeric key → original string hash. */
  keyToHash: string[];
  /** Reverse: numeric key → list of triangle indices that have this hash. */
  keyToTriangles: number[][];
}

export class TriangleTopoMapBuilder {
  private triangleKeys: number[] = [];
  private hashToKey = new Map<string, number>();
  private keyToHash: string[] = [];

  /** Record the topology hash for the next triangle. Call sequentially
   *  in the order triangles are written to the index buffer. */
  recordTriangle(topoHash: string): void {
    let key = this.hashToKey.get(topoHash);
    if (key === undefined) {
      key = this.keyToHash.length;
      this.keyToHash.push(topoHash);
      this.hashToKey.set(topoHash, key);
    }
    this.triangleKeys.push(key);
  }

  /** Bulk recording — same hash for a contiguous range of triangles. */
  recordTriangleRange(topoHash: string, count: number): void {
    let key = this.hashToKey.get(topoHash);
    if (key === undefined) {
      key = this.keyToHash.length;
      this.keyToHash.push(topoHash);
      this.hashToKey.set(topoHash, key);
    }
    for (let i = 0; i < count; i++) this.triangleKeys.push(key);
  }

  /** Build the final map + reverse index. */
  build(): TriangleTopoMap {
    const triangleToKey = new Uint32Array(this.triangleKeys);
    const keyToTriangles: number[][] = this.keyToHash.map(() => []);
    for (let i = 0; i < triangleToKey.length; i++) {
      keyToTriangles[triangleToKey[i]!]!.push(i);
    }
    return {
      triangleToKey,
      keyToHash: this.keyToHash.slice(),
      keyToTriangles,
    };
  }

  get triangleCount(): number {
    return this.triangleKeys.length;
  }

  get uniqueHashCount(): number {
    return this.keyToHash.length;
  }
}

/** Attach a topo map to a BufferGeometry. */
export function attachTopoMap(geometry: THREE.BufferGeometry, map: TriangleTopoMap): void {
  geometry.userData = geometry.userData ?? {};
  geometry.userData[TOPO_MAP_USER_DATA_KEY] = map;
}

/** Look up the persistent topology hash for a clicked triangle. */
export function topoHashForTriangle(
  geometry: THREE.BufferGeometry,
  triangleIndex: number,
): string | null {
  const map = geometry.userData?.[TOPO_MAP_USER_DATA_KEY] as TriangleTopoMap | undefined;
  if (!map) return null;
  if (triangleIndex < 0 || triangleIndex >= map.triangleToKey.length) return null;
  const key = map.triangleToKey[triangleIndex]!;
  return map.keyToHash[key] ?? null;
}

/** Reverse: given a hash, return the triangle indices currently
 *  carrying it. Used when re-running the pipeline to keep highlight
 *  state in sync. */
export function trianglesForTopoHash(
  geometry: THREE.BufferGeometry,
  hash: string,
): number[] {
  const map = geometry.userData?.[TOPO_MAP_USER_DATA_KEY] as TriangleTopoMap | undefined;
  if (!map) return [];
  const key = map.keyToHash.indexOf(hash);
  if (key < 0) return [];
  return map.keyToTriangles[key] ?? [];
}

/** Pass the topo map through a triangle-index permutation. Used after
 *  vertex welding / mesh healing rearranges indices but keeps the same
 *  triangles. `permutation[newIndex] = oldIndex`. */
export function permuteTopoMap(
  map: TriangleTopoMap,
  permutation: number[],
): TriangleTopoMap {
  const triangleToKey = new Uint32Array(permutation.length);
  for (let i = 0; i < permutation.length; i++) {
    const old = permutation[i]!;
    if (old >= 0 && old < map.triangleToKey.length) {
      triangleToKey[i] = map.triangleToKey[old]!;
    }
  }
  const keyToTriangles: number[][] = map.keyToHash.map(() => []);
  for (let i = 0; i < triangleToKey.length; i++) {
    keyToTriangles[triangleToKey[i]!]!.push(i);
  }
  return { triangleToKey, keyToHash: map.keyToHash.slice(), keyToTriangles };
}

/** Cluster triangles by hash and return one entry per face cluster.
 *  Each cluster is the set of triangles that share the same hash
 *  (= the same logical face of the B-rep). */
export interface FaceCluster {
  hash: string;
  triangleIndices: number[];
}

export function clustersFromTopoMap(map: TriangleTopoMap): FaceCluster[] {
  return map.keyToHash.map((hash, key) => ({
    hash,
    triangleIndices: map.keyToTriangles[key] ?? [],
  })).filter(c => c.triangleIndices.length > 0);
}

/** Helper used by features that emit a "swept face" — e.g. a sketch
 *  segment extrudes to a side face of N quads. Given the segment hash
 *  and the number of quad strips, this enqueues 2 triangles per quad
 *  with the same `${extrudeId}_sweep_${segmentHash}` topology hash. */
export function recordSweptFace(
  builder: TriangleTopoMapBuilder,
  extrudeId: string,
  segmentHash: string,
  quadCount: number,
): void {
  const hash = `${extrudeId}_sweep_${segmentHash}`;
  // Each quad = 2 triangles.
  builder.recordTriangleRange(hash, quadCount * 2);
}

/** Helper for the top/bottom end-caps. */
export function recordCap(
  builder: TriangleTopoMapBuilder,
  extrudeId: string,
  capType: 'top' | 'bottom',
  triangleCount: number,
): void {
  builder.recordTriangleRange(`${extrudeId}_cap_${capType}`, triangleCount);
}
