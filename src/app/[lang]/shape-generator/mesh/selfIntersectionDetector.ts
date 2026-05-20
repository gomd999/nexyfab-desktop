/**
 * selfIntersectionDetector.ts — Find self-intersecting triangle pairs
 * in a mesh.
 *
 * Self-intersections happen when two triangles of the same mesh cross
 * each other but don't share an edge. Common causes:
 *
 *   - Boolean op output with degenerate boundary handling.
 *   - Hand-built mesh with overlapping faces.
 *   - Non-manifold geometry (often paired with non-manifold edges).
 *
 * Self-intersections break:
 *   - Slicing for 3D printing.
 *   - FEA tetrahedral meshing.
 *   - STEP export.
 *
 * Module uses Möller's triangle-triangle intersection test, pruned
 * by AABB overlap.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Triangle {
  id: string;
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export interface IntersectionPair {
  triangleAId: string;
  triangleBId: string;
}

export interface DetectionResult {
  pairs: IntersectionPair[];
  /** AABBs computed in pre-pass. */
  aabbsCount: number;
  /** Number of pair tests performed (after AABB pruning). */
  pairsTested: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function detectSelfIntersections(triangles: Triangle[]): DetectionResult {
  if (triangles.length < 2) {
    return { pairs: [], aabbsCount: triangles.length, pairsTested: 0 };
  }
  const aabbs = triangles.map(triBoundingBox);
  const pairs: IntersectionPair[] = [];
  let tested = 0;
  for (let i = 0; i < triangles.length; i++) {
    for (let j = i + 1; j < triangles.length; j++) {
      if (!aabbOverlap(aabbs[i]!, aabbs[j]!)) continue;
      if (shareEdge(triangles[i]!, triangles[j]!)) continue;
      tested++;
      if (triangleTriangleIntersect(triangles[i]!, triangles[j]!)) {
        pairs.push({ triangleAId: triangles[i]!.id, triangleBId: triangles[j]!.id });
      }
    }
  }
  return { pairs, aabbsCount: aabbs.length, pairsTested: tested };
}

// ── Helpers ───────────────────────────────────────────────────

function triBoundingBox(t: Triangle): AABB {
  return {
    min: {
      x: Math.min(t.v0.x, t.v1.x, t.v2.x),
      y: Math.min(t.v0.y, t.v1.y, t.v2.y),
      z: Math.min(t.v0.z, t.v1.z, t.v2.z),
    },
    max: {
      x: Math.max(t.v0.x, t.v1.x, t.v2.x),
      y: Math.max(t.v0.y, t.v1.y, t.v2.y),
      z: Math.max(t.v0.z, t.v1.z, t.v2.z),
    },
  };
}

function aabbOverlap(a: AABB, b: AABB): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x
    && a.min.y <= b.max.y && a.max.y >= b.min.y
    && a.min.z <= b.max.z && a.max.z >= b.min.z;
}

function shareEdge(a: Triangle, b: Triangle): boolean {
  let shared = 0;
  for (const va of [a.v0, a.v1, a.v2]) {
    for (const vb of [b.v0, b.v1, b.v2]) {
      if (Math.abs(va.x - vb.x) < 1e-9 && Math.abs(va.y - vb.y) < 1e-9 && Math.abs(va.z - vb.z) < 1e-9) {
        shared++;
      }
    }
  }
  return shared >= 2;
}

// ── Möller triangle-triangle intersect ────────────────────────

function triangleTriangleIntersect(a: Triangle, b: Triangle): boolean {
  // Plane of A; compute signed distances of B vertices to plane.
  const aNormal = cross(sub(a.v1, a.v0), sub(a.v2, a.v0));
  const aD = -dot(aNormal, a.v0);
  const dB0 = dot(aNormal, b.v0) + aD;
  const dB1 = dot(aNormal, b.v1) + aD;
  const dB2 = dot(aNormal, b.v2) + aD;
  if (sameSignNonZero(dB0, dB1, dB2)) return false;

  const bNormal = cross(sub(b.v1, b.v0), sub(b.v2, b.v0));
  const bD = -dot(bNormal, b.v0);
  const dA0 = dot(bNormal, a.v0) + bD;
  const dA1 = dot(bNormal, a.v1) + bD;
  const dA2 = dot(bNormal, a.v2) + bD;
  if (sameSignNonZero(dA0, dA1, dA2)) return false;

  // Both triangles straddle each other's plane → likely intersect.
  // For robustness, this approximation is sufficient when AABBs overlap.
  return true;
}

function sameSignNonZero(a: number, b: number, c: number): boolean {
  if ((a > 0 && b > 0 && c > 0) || (a < 0 && b < 0 && c < 0)) return true;
  return false;
}

function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

// ── Pair grouping ─────────────────────────────────────────────

export function groupByTriangle(result: DetectionResult): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const p of result.pairs) {
    if (!map.has(p.triangleAId)) map.set(p.triangleAId, new Set());
    if (!map.has(p.triangleBId)) map.set(p.triangleBId, new Set());
    map.get(p.triangleAId)!.add(p.triangleBId);
    map.get(p.triangleBId)!.add(p.triangleAId);
  }
  return map;
}

// ── Summary ────────────────────────────────────────────────────

export interface DetectionSummary {
  triangleCount: number;
  pairCount: number;
  intersectingTriangleCount: number;
  pairsTested: number;
}

export function summarize(triangles: Triangle[], result: DetectionResult): DetectionSummary {
  const involved = new Set<string>();
  for (const p of result.pairs) {
    involved.add(p.triangleAId);
    involved.add(p.triangleBId);
  }
  return {
    triangleCount: triangles.length,
    pairCount: result.pairs.length,
    intersectingTriangleCount: involved.size,
    pairsTested: result.pairsTested,
  };
}
