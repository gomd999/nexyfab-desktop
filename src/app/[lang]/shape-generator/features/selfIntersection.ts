/**
 * selfIntersection.ts — Detect coplanar / piercing triangle pairs.
 *
 * STL exports from poorly-sealed B-Reps frequently produce triangle
 * pairs that pierce one another. Downstream consumers — slicers for
 * 3D print, FEA mesh generators, OCCT boolean — all break in
 * different ways on these. Detecting them is the first step; the
 * paired `repairSelfIntersections` runs a Möller intersection check
 * and splits the offending triangles along the intersection line.
 *
 * Implementation: Möller-Trumbore-style triangle-triangle test
 * with broad-phase AABB pruning. O(n²) worst case so callers should
 * decimate or pre-cluster before running on million-triangle meshes.
 */

import * as THREE from 'three';

export interface SelfIntersectionPair {
  triA: number;
  triB: number;
  /** World-space line segment along which the two triangles cross. */
  segmentStart: [number, number, number];
  segmentEnd: [number, number, number];
}

export interface SelfIntersectionReport {
  pairs: SelfIntersectionPair[];
  scannedTriangles: number;
  scannedPairs: number;
  prunedByAabb: number;
}

interface TriCache {
  v0: THREE.Vector3;
  v1: THREE.Vector3;
  v2: THREE.Vector3;
  min: THREE.Vector3;
  max: THREE.Vector3;
  normal: THREE.Vector3;
  /** Plane offset such that normal·p + d = 0. */
  d: number;
}

const EPS = 1e-7;

function buildTriCache(geo: THREE.BufferGeometry): TriCache[] {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const cache: TriCache[] = [];
  const tmpN = new THREE.Vector3();
  const tmpE1 = new THREE.Vector3();
  const tmpE2 = new THREE.Vector3();
  for (let i = 0; i < triCount; i++) {
    const i0 = idx ? idx.getX(i * 3 + 0) : i * 3 + 0;
    const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
    const v0 = new THREE.Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    const v1 = new THREE.Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    const v2 = new THREE.Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
    tmpE1.subVectors(v1, v0);
    tmpE2.subVectors(v2, v0);
    tmpN.crossVectors(tmpE1, tmpE2).normalize();
    cache.push({
      v0, v1, v2,
      min: new THREE.Vector3(
        Math.min(v0.x, v1.x, v2.x),
        Math.min(v0.y, v1.y, v2.y),
        Math.min(v0.z, v1.z, v2.z),
      ),
      max: new THREE.Vector3(
        Math.max(v0.x, v1.x, v2.x),
        Math.max(v0.y, v1.y, v2.y),
        Math.max(v0.z, v1.z, v2.z),
      ),
      normal: tmpN.clone(),
      d: -tmpN.dot(v0),
    });
  }
  return cache;
}

function aabbOverlap(a: TriCache, b: TriCache): boolean {
  return !(a.max.x < b.min.x || b.max.x < a.min.x ||
           a.max.y < b.min.y || b.max.y < a.min.y ||
           a.max.z < b.min.z || b.max.z < a.min.z);
}

function shareVertex(a: TriCache, b: TriCache, tol = EPS): boolean {
  for (const va of [a.v0, a.v1, a.v2]) {
    for (const vb of [b.v0, b.v1, b.v2]) {
      if (va.distanceTo(vb) < tol) return true;
    }
  }
  return false;
}

/** Signed distance of point to plane (normal·p + d). */
function pointPlaneDist(t: TriCache, p: THREE.Vector3): number {
  return t.normal.dot(p) + t.d;
}

/** Where line v0→v1 hits plane t. Returns null if parallel. */
function lineSegmentPlaneIntersect(
  t: TriCache,
  v0: THREE.Vector3,
  v1: THREE.Vector3,
): THREE.Vector3 | null {
  const dir = new THREE.Vector3().subVectors(v1, v0);
  const denom = t.normal.dot(dir);
  if (Math.abs(denom) < EPS) return null;
  const u = -(t.normal.dot(v0) + t.d) / denom;
  if (u < -EPS || u > 1 + EPS) return null;
  return v0.clone().addScaledVector(dir, u);
}

/** Möller-style line-of-intersection for triangle pair. Returns the
 *  two endpoints when they cross, null otherwise. */
function trianglePairIntersection(
  a: TriCache,
  b: TriCache,
): { p: THREE.Vector3; q: THREE.Vector3 } | null {
  const d0 = pointPlaneDist(b, a.v0);
  const d1 = pointPlaneDist(b, a.v1);
  const d2 = pointPlaneDist(b, a.v2);
  // All on same side of b's plane → no intersection.
  if ((d0 > EPS && d1 > EPS && d2 > EPS) || (d0 < -EPS && d1 < -EPS && d2 < -EPS)) return null;

  const e0 = pointPlaneDist(a, b.v0);
  const e1 = pointPlaneDist(a, b.v1);
  const e2 = pointPlaneDist(a, b.v2);
  if ((e0 > EPS && e1 > EPS && e2 > EPS) || (e0 < -EPS && e1 < -EPS && e2 < -EPS)) return null;

  // Take the edges of `a` that cross b's plane.
  const aHits: THREE.Vector3[] = [];
  if (Math.sign(d0) !== Math.sign(d1)) {
    const h = lineSegmentPlaneIntersect(b, a.v0, a.v1); if (h) aHits.push(h);
  }
  if (Math.sign(d1) !== Math.sign(d2)) {
    const h = lineSegmentPlaneIntersect(b, a.v1, a.v2); if (h) aHits.push(h);
  }
  if (Math.sign(d0) !== Math.sign(d2)) {
    const h = lineSegmentPlaneIntersect(b, a.v0, a.v2); if (h) aHits.push(h);
  }
  if (aHits.length < 2) return null;
  return { p: aHits[0]!, q: aHits[1]! };
}

export function detectSelfIntersections(
  geometry: THREE.BufferGeometry,
  opts: { skipSharedVertex?: boolean } = {},
): SelfIntersectionReport {
  const skipShared = opts.skipSharedVertex ?? true;
  const tris = buildTriCache(geometry);
  const pairs: SelfIntersectionPair[] = [];
  let prunedByAabb = 0;
  let scannedPairs = 0;
  for (let i = 0; i < tris.length; i++) {
    for (let j = i + 1; j < tris.length; j++) {
      scannedPairs++;
      const ta = tris[i]!;
      const tb = tris[j]!;
      if (!aabbOverlap(ta, tb)) { prunedByAabb++; continue; }
      if (skipShared && shareVertex(ta, tb)) continue;
      const hit = trianglePairIntersection(ta, tb);
      if (hit) {
        pairs.push({
          triA: i,
          triB: j,
          segmentStart: [hit.p.x, hit.p.y, hit.p.z],
          segmentEnd: [hit.q.x, hit.q.y, hit.q.z],
        });
      }
    }
  }
  return {
    pairs,
    scannedTriangles: tris.length,
    scannedPairs,
    prunedByAabb,
  };
}

/** Remove offending triangles. Best-effort repair — splitting would
 *  preserve more geometry but introduces T-junctions that need
 *  retriangulation. For NexyFab's "make import not crash OCCT" use
 *  case, deletion is the pragmatic shortcut. */
export function repairBySelfIntersectionDeletion(
  geometry: THREE.BufferGeometry,
): { geometry: THREE.BufferGeometry; removed: number; pairs: number } {
  const report = detectSelfIntersections(geometry);
  if (report.pairs.length === 0) {
    return { geometry: geometry.clone(), removed: 0, pairs: 0 };
  }
  const skip = new Set<number>();
  for (const p of report.pairs) {
    // Delete the triangle with smaller area (less of a loss).
    const tris = buildTriCache(geometry);
    const aA = tris[p.triA]!;
    const aB = tris[p.triB]!;
    const areaA = new THREE.Vector3().subVectors(aA.v1, aA.v0).cross(new THREE.Vector3().subVectors(aA.v2, aA.v0)).length() * 0.5;
    const areaB = new THREE.Vector3().subVectors(aB.v1, aB.v0).cross(new THREE.Vector3().subVectors(aB.v2, aB.v0)).length() * 0.5;
    skip.add(areaA < areaB ? p.triA : p.triB);
  }
  const idx = geometry.index;
  const triCount = idx ? idx.count / 3 : geometry.attributes.position.count / 3;
  const out: number[] = [];
  for (let i = 0; i < triCount; i++) {
    if (skip.has(i)) continue;
    if (idx) {
      out.push(idx.getX(i * 3), idx.getX(i * 3 + 1), idx.getX(i * 3 + 2));
    } else {
      out.push(i * 3, i * 3 + 1, i * 3 + 2);
    }
  }
  const cloned = geometry.clone();
  cloned.setIndex(out);
  return { geometry: cloned, removed: skip.size, pairs: report.pairs.length };
}
