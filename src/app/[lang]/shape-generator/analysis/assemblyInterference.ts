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
  /** Bodies overlap (a vertex of one is inside the other, or their surfaces cross). */
  interfering: boolean;
  /** Broad-phase: the AABBs overlap (necessary, not sufficient, for interference). */
  aabbOverlap: boolean;
  /** Vertices of A found inside B. */
  verticesAInsideB: number;
  /** Vertices of B found inside A. */
  verticesBInsideA: number;
  /** Surface triangles of the two bodies cross transversally (catches a thin cross with
   *  no enclosed vertex). Coplanar / flush-mating faces are NOT counted. */
  surfacesCross: boolean;
  /** Minimum clearance gap (mm) when separated; 0 when interfering. */
  minClearance: number;
}

/** Möller–Trumbore segment(P→Q)–triangle intersection, interior crossing only (a parallel
 *  / coplanar segment, or one merely touching at an endpoint, returns false). */
function segHitsTri(
  px: number, py: number, pz: number, qx: number, qy: number, qz: number,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
): boolean {
  const dx = qx - px, dy = qy - py, dz = qz - pz;
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const pvx = dy * e2z - dz * e2y, pvy = dz * e2x - dx * e2z, pvz = dx * e2y - dy * e2x;
  const det = e1x * pvx + e1y * pvy + e1z * pvz;
  // Reject a segment (near-)parallel to the triangle plane with a SCALE-RELATIVE threshold:
  // an absolute 1e-12 is below the float noise of ~10 mm coords (products ~1e3 ⇒ noise ~1e-10),
  // which let flush/coplanar mating faces register a spurious crossing.
  const e1m = Math.hypot(e1x, e1y, e1z), e2m = Math.hypot(e2x, e2y, e2z), dm = Math.hypot(dx, dy, dz);
  if (Math.abs(det) < 1e-8 * e1m * e2m * dm) return false; // parallel / coplanar
  const inv = 1 / det;
  const TOL = 1e-6;
  const tvx = px - ax, tvy = py - ay, tvz = pz - az;
  const u = (tvx * pvx + tvy * pvy + tvz * pvz) * inv;
  if (u <= TOL || u >= 1 - TOL) return false;
  const qvx = tvy * e1z - tvz * e1y, qvy = tvz * e1x - tvx * e1z, qvz = tvx * e1y - tvy * e1x;
  const v = (dx * qvx + dy * qvy + dz * qvz) * inv;
  if (v <= TOL || u + v >= 1 - TOL) return false;            // strictly INSIDE the triangle:
  const t = (e2x * qvx + e2y * qvy + e2z * qvz) * inv;        // a hit on an edge/vertex is a
  return t > TOL && t < 1 - TOL;                              // graze (touch), not a crossing
}

/** Do any surface triangles of the two (flat, world-space) meshes cross transversally?
 *  Per-triangle AABB pruning keeps it from being a full O(nA·nB) sweep on real meshes. */
function surfacesCross(triA: Float32Array, triB: Float32Array): boolean {
  const nA = triA.length / 9, nB = triB.length / 9;
  for (let i = 0; i < nA; i++) {
    const a = i * 9;
    const aMinX = Math.min(triA[a], triA[a+3], triA[a+6]), aMaxX = Math.max(triA[a], triA[a+3], triA[a+6]);
    const aMinY = Math.min(triA[a+1], triA[a+4], triA[a+7]), aMaxY = Math.max(triA[a+1], triA[a+4], triA[a+7]);
    const aMinZ = Math.min(triA[a+2], triA[a+5], triA[a+8]), aMaxZ = Math.max(triA[a+2], triA[a+5], triA[a+8]);
    for (let j = 0; j < nB; j++) {
      const b = j * 9;
      if (Math.max(triB[b], triB[b+3], triB[b+6]) < aMinX || Math.min(triB[b], triB[b+3], triB[b+6]) > aMaxX) continue;
      if (Math.max(triB[b+1], triB[b+4], triB[b+7]) < aMinY || Math.min(triB[b+1], triB[b+4], triB[b+7]) > aMaxY) continue;
      if (Math.max(triB[b+2], triB[b+5], triB[b+8]) < aMinZ || Math.min(triB[b+2], triB[b+5], triB[b+8]) > aMaxZ) continue;
      const ax = triA[a], ay = triA[a+1], az = triA[a+2], bx = triA[a+3], by = triA[a+4], bz = triA[a+5], cx = triA[a+6], cy = triA[a+7], cz = triA[a+8];
      const ux = triB[b], uy = triB[b+1], uz = triB[b+2], vx = triB[b+3], vy = triB[b+4], vz = triB[b+5], wx = triB[b+6], wy = triB[b+7], wz = triB[b+8];
      // an edge of A piercing B, or an edge of B piercing A ⇒ the triangles cross
      if (segHitsTri(ax,ay,az, bx,by,bz, ux,uy,uz, vx,vy,vz, wx,wy,wz)) return true;
      if (segHitsTri(bx,by,bz, cx,cy,cz, ux,uy,uz, vx,vy,vz, wx,wy,wz)) return true;
      if (segHitsTri(cx,cy,cz, ax,ay,az, ux,uy,uz, vx,vy,vz, wx,wy,wz)) return true;
      if (segHitsTri(ux,uy,uz, vx,vy,vz, ax,ay,az, bx,by,bz, cx,cy,cz)) return true;
      if (segHitsTri(vx,vy,vz, wx,wy,wz, ax,ay,az, bx,by,bz, cx,cy,cz)) return true;
      if (segHitsTri(wx,wy,wz, ux,uy,uz, ax,ay,az, bx,by,bz, cx,cy,cz)) return true;
    }
  }
  return false;
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

  let vAinB = 0, vBinA = 0, cross = false;
  if (aabbOverlap) {
    const triB = worldTriArray(geoB, offsetB);
    const triA = worldTriArray(geoA, offsetA);
    vAinB = countInside(geoA, offsetA, triB, triB.length / 9);
    vBinA = countInside(geoB, offsetB, triA, triA.length / 9);
    // surface-crossing catches a thin "+"-cross with no enclosed vertex
    cross = surfacesCross(triA, triB);
  }
  const interfering = vAinB > 0 || vBinA > 0 || cross;
  return {
    interfering,
    aabbOverlap,
    verticesAInsideB: vAinB,
    verticesBInsideA: vBinA,
    surfacesCross: cross,
    minClearance: interfering ? 0 : gap,
  };
}
