/**
 * rayCastPicker.ts — Mesh ray-cast for interactive picking.
 *
 * Click on the viewport → ray from camera → first triangle hit →
 * underlying face id. Used for:
 *
 *   - Click-to-select features (extrude, fillet).
 *   - Hover tooltips with face area + GD&T data.
 *   - Marquee selection (rect in screen space → frustum vs mesh).
 *
 * The implementation:
 *   - **Broad phase**: optional AABB tree built once per mesh; ray
 *     against AABB is fast.
 *   - **Narrow phase**: Möller-Trumbore ray-triangle intersection.
 *   - Returns the nearest hit along the ray (smallest t > 0).
 *
 * For pixel-perfect selection, attach `triangleFaceIds` per triangle
 * so the picker can return the originating face id, not just a
 * triangle index.
 */

export type Vec3 = [number, number, number];

export interface MeshArrays {
  positions: number[];
  indices: number[];
  /** Optional per-triangle source face id. */
  triangleFaceIds?: string[];
}

export interface Ray {
  origin: Vec3;
  /** Normalized direction. */
  direction: Vec3;
}

export interface PickResult {
  /** Triangle index in the mesh. */
  triangleIndex: number;
  /** Originating face id (if triangleFaceIds provided). */
  faceId?: string;
  /** Hit point in world space. */
  hitPointMm: Vec3;
  /** Distance along the ray. */
  distanceMm: number;
  /** Barycentric coordinates on the triangle (u, v, 1 - u - v). */
  barycentric: [number, number, number];
}

// ── Top-level entry ─────────────────────────────────────────────

export function castRay(mesh: MeshArrays, ray: Ray): PickResult | null {
  const dir = normalize(ray.direction);
  const triCount = mesh.indices.length / 3;
  let bestT = Infinity;
  let bestResult: PickResult | null = null;
  for (let t = 0; t < triCount; t++) {
    const hit = rayTriangle(mesh, t, ray.origin, dir);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      bestResult = {
        triangleIndex: t,
        faceId: mesh.triangleFaceIds?.[t],
        hitPointMm: [
          ray.origin[0] + dir[0] * hit.t,
          ray.origin[1] + dir[1] * hit.t,
          ray.origin[2] + dir[2] * hit.t,
        ],
        distanceMm: hit.t,
        barycentric: [hit.u, hit.v, 1 - hit.u - hit.v],
      };
    }
  }
  return bestResult;
}

// ── Möller-Trumbore ─────────────────────────────────────────────

function rayTriangle(mesh: MeshArrays, t: number, origin: Vec3, dir: Vec3): { t: number; u: number; v: number } | null {
  const i0 = mesh.indices[t * 3]!;
  const i1 = mesh.indices[t * 3 + 1]!;
  const i2 = mesh.indices[t * 3 + 2]!;
  const v0: Vec3 = [mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 1]!, mesh.positions[i0 * 3 + 2]!];
  const v1: Vec3 = [mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i1 * 3 + 2]!];
  const v2: Vec3 = [mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 1]!, mesh.positions[i2 * 3 + 2]!];
  const e1: Vec3 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e2: Vec3 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
  const h = cross(dir, e2);
  const a = dot(e1, h);
  if (Math.abs(a) < 1e-9) return null;
  const f = 1 / a;
  const s: Vec3 = [origin[0] - v0[0], origin[1] - v0[1], origin[2] - v0[2]];
  const u = f * dot(s, h);
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1);
  const v = f * dot(dir, q);
  if (v < 0 || u + v > 1) return null;
  const tHit = f * dot(e2, q);
  if (tHit < 1e-9) return null;
  return { t: tHit, u, v };
}

// ── AABB broad phase ────────────────────────────────────────────

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export interface BvhNode {
  bounds: AABB;
  /** Leaf only: triangle indices contained. */
  triangleIndices?: number[];
  left?: BvhNode;
  right?: BvhNode;
}

export function buildBvh(mesh: MeshArrays, leafSize: number = 8): BvhNode {
  const triCount = mesh.indices.length / 3;
  const triIndices = Array.from({ length: triCount }, (_, i) => i);
  const triBounds = triIndices.map(t => triangleBounds(mesh, t));
  return buildBvhRecursive(triIndices, triBounds, leafSize);
}

function buildBvhRecursive(triIndices: number[], triBounds: AABB[], leafSize: number): BvhNode {
  const bounds = mergeBounds(triIndices.map(i => triBounds[i]!));
  if (triIndices.length <= leafSize) {
    return { bounds, triangleIndices: triIndices };
  }
  // Split along the longest axis.
  const axis = longestAxis(bounds);
  const sorted = triIndices.slice().sort((a, b) => {
    const ca = (triBounds[a]!.min[axis] + triBounds[a]!.max[axis]) / 2;
    const cb = (triBounds[b]!.min[axis] + triBounds[b]!.max[axis]) / 2;
    return ca - cb;
  });
  const mid = Math.floor(sorted.length / 2);
  return {
    bounds,
    left: buildBvhRecursive(sorted.slice(0, mid), triBounds, leafSize),
    right: buildBvhRecursive(sorted.slice(mid), triBounds, leafSize),
  };
}

/** Cast ray using BVH for speed. O(log n) average. */
export function castRayBvh(mesh: MeshArrays, bvh: BvhNode, ray: Ray): PickResult | null {
  const dir = normalize(ray.direction);
  const candidates = collectCandidates(bvh, ray.origin, dir);
  let bestT = Infinity;
  let best: PickResult | null = null;
  for (const t of candidates) {
    const hit = rayTriangle(mesh, t, ray.origin, dir);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      best = {
        triangleIndex: t,
        faceId: mesh.triangleFaceIds?.[t],
        hitPointMm: [
          ray.origin[0] + dir[0] * hit.t,
          ray.origin[1] + dir[1] * hit.t,
          ray.origin[2] + dir[2] * hit.t,
        ],
        distanceMm: hit.t,
        barycentric: [hit.u, hit.v, 1 - hit.u - hit.v],
      };
    }
  }
  return best;
}

function collectCandidates(node: BvhNode, origin: Vec3, dir: Vec3): number[] {
  if (!rayAabbHit(node.bounds, origin, dir)) return [];
  if (node.triangleIndices) return node.triangleIndices.slice();
  const left = node.left ? collectCandidates(node.left, origin, dir) : [];
  const right = node.right ? collectCandidates(node.right, origin, dir) : [];
  return [...left, ...right];
}

function rayAabbHit(box: AABB, origin: Vec3, dir: Vec3): boolean {
  let tMin = -Infinity, tMax = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const invD = 1 / dir[axis]!;
    let t0 = (box.min[axis]! - origin[axis]!) * invD;
    let t1 = (box.max[axis]! - origin[axis]!) * invD;
    if (invD < 0) [t0, t1] = [t1, t0];
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMax < tMin) return false;
  }
  return tMax > 0;
}

// ── AABB helpers ────────────────────────────────────────────────

function triangleBounds(mesh: MeshArrays, t: number): AABB {
  const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const idx of [i0, i1, i2]) {
    const x = mesh.positions[idx * 3]!, y = mesh.positions[idx * 3 + 1]!, z = mesh.positions[idx * 3 + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function mergeBounds(boxes: AABB[]): AABB {
  if (boxes.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let i = 0; i < 3; i++) {
      if (b.min[i]! < min[i]!) min[i] = b.min[i]!;
      if (b.max[i]! > max[i]!) max[i] = b.max[i]!;
    }
  }
  return { min, max };
}

function longestAxis(box: AABB): number {
  const dx = box.max[0]! - box.min[0]!;
  const dy = box.max[1]! - box.min[1]!;
  const dz = box.max[2]! - box.min[2]!;
  if (dx > dy && dx > dz) return 0;
  if (dy > dz) return 1;
  return 2;
}

// ── Screen-space → ray ─────────────────────────────────────────

export interface Camera {
  positionMm: Vec3;
  /** Forward vector (camera looking direction). */
  forward: Vec3;
  /** Up vector. */
  up: Vec3;
  /** Vertical field of view in radians. */
  fovYRad: number;
  /** Viewport aspect ratio (width / height). */
  aspect: number;
}

/** Convert NDC (-1..1) to a world-space ray. */
export function screenToRay(camera: Camera, ndcX: number, ndcY: number): Ray {
  const fwd = normalize(camera.forward);
  const right = normalize(cross(fwd, camera.up));
  const up = normalize(cross(right, fwd));
  const halfHeight = Math.tan(camera.fovYRad / 2);
  const halfWidth = halfHeight * camera.aspect;
  const dir: Vec3 = [
    fwd[0] + right[0] * ndcX * halfWidth + up[0] * ndcY * halfHeight,
    fwd[1] + right[1] * ndcX * halfWidth + up[1] * ndcY * halfHeight,
    fwd[2] + right[2] * ndcX * halfWidth + up[2] * ndcY * halfHeight,
  ];
  return { origin: camera.positionMm, direction: normalize(dir) };
}

// ── Vector helpers ──────────────────────────────────────────────

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
