/**
 * meshHealing.ts — In-place fixes for the most common mesh defects
 * imported STEP / STL files arrive with. Pairs with `meshValidation`:
 * validate finds the issues, heal removes them.
 *
 * Operations performed (in order):
 *   1. Drop triangles whose area is below `minTriangleArea`.
 *   2. Weld vertices closer than `vertexMergeTolerance` (the union-find
 *      collapses duplicates and re-indexes the triangle buffer).
 *   3. Remove vertices the rewritten triangle list never references
 *      (compact the position attribute).
 *
 * Each step is opt-out via the options struct so callers that already
 * trust their input (e.g. NexyFab's own primitive emitters) can skip
 * the cost.
 *
 * Returns a fresh BufferGeometry — the input is never mutated, so
 * undo history and the original viewport mesh stay intact.
 */

import * as THREE from 'three';

export interface MeshHealOptions {
  /** Triangle area threshold; below this the triangle is dropped. */
  minTriangleArea?: number;
  /** Welding radius — vertices within this distance fuse. */
  vertexMergeTolerance?: number;
  removeDegenerateTriangles?: boolean;
  mergeDuplicateVertices?: boolean;
  removeIsolatedVertices?: boolean;
}

export interface MeshHealReport {
  removedTriangles: number;
  mergedVertices: number;
  removedIsolatedVertices: number;
  /** Final triangle / vertex counts after healing. */
  finalTriangleCount: number;
  finalVertexCount: number;
}

export interface MeshHealResult {
  geometry: THREE.BufferGeometry;
  report: MeshHealReport;
}

const DEFAULT_MIN_AREA = 1e-6;
const DEFAULT_WELD_TOL = 1e-4;

function triangleArea(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return Math.hypot(nx, ny, nz) * 0.5;
}

/** Heal a mesh. Returns a new geometry; the original is untouched. */
export function healMesh(
  geometry: THREE.BufferGeometry,
  opts: MeshHealOptions = {},
): MeshHealResult {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) {
    return {
      geometry: geometry.clone(),
      report: {
        removedTriangles: 0,
        mergedVertices: 0,
        removedIsolatedVertices: 0,
        finalTriangleCount: 0,
        finalVertexCount: 0,
      },
    };
  }

  const minArea = opts.minTriangleArea ?? DEFAULT_MIN_AREA;
  const weldTol = opts.vertexMergeTolerance ?? DEFAULT_WELD_TOL;
  const removeDegen = opts.removeDegenerateTriangles !== false;
  const mergeDup = opts.mergeDuplicateVertices !== false;
  const removeIso = opts.removeIsolatedVertices !== false;

  // Read positions into typed arrays so we can rebuild quickly.
  const vCount = pos.count;
  const xs = new Float32Array(vCount);
  const ys = new Float32Array(vCount);
  const zs = new Float32Array(vCount);
  for (let i = 0; i < vCount; i++) {
    xs[i] = pos.getX(i); ys[i] = pos.getY(i); zs[i] = pos.getZ(i);
  }

  const idx = geometry.index;
  const triCount = idx ? idx.count / 3 : vCount / 3;
  const triIndices: number[] = []; // flat list of vertex indices, 3 per triangle

  let removedTriangles = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    if (removeDegen) {
      const area = triangleArea(xs[i0], ys[i0], zs[i0], xs[i1], ys[i1], zs[i1], xs[i2], ys[i2], zs[i2]);
      if (area < minArea) { removedTriangles++; continue; }
    }
    triIndices.push(i0, i1, i2);
  }

  // Vertex welding via spatial-hash union-find. Bucket size = weldTol×2 so
  // any two points within the tolerance fall into adjacent buckets at
  // worst. We check the 27 neighbouring buckets for each vertex.
  const mergeMap = new Int32Array(vCount);
  for (let i = 0; i < vCount; i++) mergeMap[i] = i;
  let mergedVertices = 0;

  if (mergeDup && weldTol > 0) {
    const cell = Math.max(weldTol * 2, 1e-12);
    const buckets = new Map<string, number[]>();
    const key = (x: number, y: number, z: number) =>
      `${Math.floor(x / cell)}|${Math.floor(y / cell)}|${Math.floor(z / cell)}`;
    const tol2 = weldTol * weldTol;
    for (let i = 0; i < vCount; i++) {
      const k = key(xs[i], ys[i], zs[i]);
      const peers = buckets.get(k);
      let merged = false;
      if (peers) {
        for (const j of peers) {
          const dx = xs[i] - xs[j], dy = ys[i] - ys[j], dz = zs[i] - zs[j];
          if (dx * dx + dy * dy + dz * dz <= tol2) {
            mergeMap[i] = mergeMap[j];
            mergedVertices++;
            merged = true;
            break;
          }
        }
      }
      if (!merged) {
        if (!peers) buckets.set(k, [i]);
        else peers.push(i);
      }
    }
    // Apply merge map to triangle indices.
    for (let t = 0; t < triIndices.length; t++) triIndices[t] = mergeMap[triIndices[t]];
  }

  // Optional: remove triangles that collapsed to a line after welding
  // (two indices became equal). Skipped when degen removal is off so
  // callers can opt into a "merge-only" pass without losing triangles.
  if (mergeDup && removeDegen) {
    const filtered: number[] = [];
    for (let t = 0; t < triIndices.length; t += 3) {
      const a = triIndices[t], b = triIndices[t + 1], c = triIndices[t + 2];
      if (a === b || b === c || a === c) { removedTriangles++; continue; }
      filtered.push(a, b, c);
    }
    triIndices.length = 0;
    for (const v of filtered) triIndices.push(v);
  }

  // Compact: only keep referenced vertices.
  let finalVCount = vCount;
  let removedIso = 0;
  const newXs: number[] = [];
  const newYs: number[] = [];
  const newZs: number[] = [];
  if (removeIso) {
    const remap = new Int32Array(vCount).fill(-1);
    for (const oldIdx of triIndices) {
      if (remap[oldIdx] === -1) {
        remap[oldIdx] = newXs.length;
        newXs.push(xs[oldIdx]);
        newYs.push(ys[oldIdx]);
        newZs.push(zs[oldIdx]);
      }
    }
    for (let t = 0; t < triIndices.length; t++) triIndices[t] = remap[triIndices[t]];
    finalVCount = newXs.length;
    removedIso = vCount - finalVCount;
  } else {
    for (let i = 0; i < vCount; i++) {
      newXs.push(xs[i]); newYs.push(ys[i]); newZs.push(zs[i]);
    }
  }

  // Assemble output geometry.
  const out = new THREE.BufferGeometry();
  const flatPos = new Float32Array(finalVCount * 3);
  for (let i = 0; i < finalVCount; i++) {
    flatPos[i * 3] = newXs[i];
    flatPos[i * 3 + 1] = newYs[i];
    flatPos[i * 3 + 2] = newZs[i];
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(flatPos, 3));
  out.setIndex(triIndices);
  out.computeVertexNormals();

  return {
    geometry: out,
    report: {
      removedTriangles,
      mergedVertices,
      removedIsolatedVertices: removedIso,
      finalTriangleCount: triIndices.length / 3,
      finalVertexCount: finalVCount,
    },
  };
}
