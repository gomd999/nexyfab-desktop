// ─── Assembly Interference / Clearance ───────────────────────────────────────
// Detects whether two solid bodies overlap (interference) or are separated, and
// reports the clearance gap when they are apart. Two phases:
//   broad: axis-aligned bounding-box gap (exact closest distance between AABBs)
//   narrow: vertex-in-solid sampling (reuses femSolver's ray-parity point-in-solid)
//
// Scope: the narrow phase flags overlap when a vertex of one body lies inside the
// other. That catches enclosure and corner penetration (the common assembly cases).
// A pathological thin "+"-cross where neither body has a vertex inside the other but
// the volumes still overlap is NOT caught here — that needs triangle–triangle tests;
// the AABB broad phase still flags such pairs as "possibly interfering".

import * as THREE from 'three';
import { pointInsideSurface } from './femSolver';

export interface InterferenceResult {
  /** Bodies overlap (a vertex of one is inside the other). */
  interfering: boolean;
  /** Broad-phase: the AABBs overlap (necessary, not sufficient, for interference). */
  aabbOverlap: boolean;
  /** Vertices of A found inside B. */
  verticesAInsideB: number;
  /** Vertices of B found inside A. */
  verticesBInsideA: number;
  /** Minimum clearance gap (mm) when separated; 0 when interfering. */
  minClearance: number;
}

function worldBox(geo: THREE.BufferGeometry, offset: [number, number, number]): THREE.Box3 {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!.clone();
  bb.min.add(new THREE.Vector3(...offset));
  bb.max.add(new THREE.Vector3(...offset));
  return bb;
}

/** Exact closest distance between two AABBs (0 if they overlap). */
function aabbGap(a: THREE.Box3, b: THREE.Box3): number {
  const gx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const gy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  const gz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.hypot(gx, gy, gz);
}

/** Flat world-space triangle array (9 floats/tri) for the point-in-solid test. */
function worldTriArray(geo: THREE.BufferGeometry, offset: [number, number, number]): Float32Array {
  const ni = geo.index ? geo.toNonIndexed() : geo;
  const pos = ni.attributes.position as THREE.BufferAttribute;
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    out[i * 3]     = pos.getX(i) + offset[0];
    out[i * 3 + 1] = pos.getY(i) + offset[1];
    out[i * 3 + 2] = pos.getZ(i) + offset[2];
  }
  return out;
}

/** Count vertices of `geo` (world-offset) that lie inside the solid `tri`/`triCount`. */
function countInside(geo: THREE.BufferGeometry, offset: [number, number, number], tri: Float32Array, triCount: number): number {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const seen = new Set<string>();
  let count = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + offset[0], y = pos.getY(i) + offset[1], z = pos.getZ(i) + offset[2];
    // de-dup coincident vertices (primitives repeat them) so the count is per unique point
    const key = `${Math.round(x / 1e-4)}_${Math.round(y / 1e-4)}_${Math.round(z / 1e-4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (pointInsideSurface(x, y, z, tri, triCount)) count++;
  }
  return count;
}

/**
 * Check interference / clearance between two bodies, each optionally offset in world space.
 */
export function checkInterference(
  geoA: THREE.BufferGeometry,
  geoB: THREE.BufferGeometry,
  offsetA: [number, number, number] = [0, 0, 0],
  offsetB: [number, number, number] = [0, 0, 0],
): InterferenceResult {
  const bbA = worldBox(geoA, offsetA);
  const bbB = worldBox(geoB, offsetB);
  const gap = aabbGap(bbA, bbB);
  const aabbOverlap = gap <= 1e-9;

  let vAinB = 0, vBinA = 0;
  if (aabbOverlap) {
    const triB = worldTriArray(geoB, offsetB);
    const triA = worldTriArray(geoA, offsetA);
    vAinB = countInside(geoA, offsetA, triB, triB.length / 9);
    vBinA = countInside(geoB, offsetB, triA, triA.length / 9);
  }
  const interfering = vAinB > 0 || vBinA > 0;
  return {
    interfering,
    aabbOverlap,
    verticesAInsideB: vAinB,
    verticesBInsideA: vBinA,
    minClearance: interfering ? 0 : gap,
  };
}
