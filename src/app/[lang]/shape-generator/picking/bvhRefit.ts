/**
 * bvhRefit.ts — Incremental BVH refit for animated meshes.
 *
 * `picking/rayCastPicker.ts` builds a BVH once at mesh load. When
 * vertices move (skinning, drape, FEA visualisation), the tree
 * structure is still correct but every node's AABB is stale.
 *
 * Rebuilding the BVH from scratch is O(n log n). **Refitting** —
 * recomputing AABBs bottom-up without changing topology — is O(n)
 * and good enough for any deformation that doesn't change connectivity
 * too dramatically.
 *
 * Refit modes:
 *
 *   - **Strict refit** — preserves topology, recomputes bounds only.
 *     Fast (one pass). Tree quality degrades if vertices move far.
 *   - **Quality monitor** — track an "imbalance score"; if it crosses
 *     a threshold, signal the caller to do a full rebuild.
 *   - **Selective rebuild** — rebuild only subtrees whose imbalance
 *     score exceeds the threshold.
 */

export type Vec3 = [number, number, number];

export interface AABB {
  min: Vec3;
  max: Vec3;
}

/** BVH node (must match the picking module's structure). */
export interface BvhNode {
  bounds: AABB;
  /** Leaf only. */
  triangleIndices?: number[];
  left?: BvhNode;
  right?: BvhNode;
}

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

// ── Refit ──────────────────────────────────────────────────────

/** Recompute every node's AABB to match the current vertex positions.
 *  Tree structure unchanged. */
export function refitBvh(node: BvhNode, mesh: MeshArrays): AABB {
  if (node.triangleIndices) {
    node.bounds = computeTrianglesBounds(node.triangleIndices, mesh);
    return node.bounds;
  }
  const lb = node.left ? refitBvh(node.left, mesh) : null;
  const rb = node.right ? refitBvh(node.right, mesh) : null;
  if (lb && rb) node.bounds = mergeBounds(lb, rb);
  else if (lb) node.bounds = lb;
  else if (rb) node.bounds = rb;
  return node.bounds;
}

function computeTrianglesBounds(triIndices: number[], mesh: MeshArrays): AABB {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of triIndices) {
    for (let v = 0; v < 3; v++) {
      const idx = mesh.indices[t * 3 + v]!;
      const x = mesh.positions[idx * 3]!;
      const y = mesh.positions[idx * 3 + 1]!;
      const z = mesh.positions[idx * 3 + 2]!;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function mergeBounds(a: AABB, b: AABB): AABB {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

// ── Quality monitoring ─────────────────────────────────────────

export interface ImbalanceStats {
  /** Sum of all node surface areas (SAH proxy). */
  totalSurfaceArea: number;
  /** Ratio of total to leaf-bound surface area. Higher = stale tree. */
  surfaceAreaInflation: number;
  /** Max depth of the tree. */
  maxDepth: number;
  /** Triangles per leaf range. */
  trianglesPerLeaf: { min: number; max: number; mean: number };
}

export function imbalanceStats(root: BvhNode): ImbalanceStats {
  let totalSurface = 0;
  let leafSurface = 0;
  let maxDepth = 0;
  let leafCount = 0;
  let minTri = Infinity;
  let maxTri = 0;
  let totalTri = 0;
  function walk(node: BvhNode, depth: number): void {
    if (depth > maxDepth) maxDepth = depth;
    totalSurface += surfaceArea(node.bounds);
    if (node.triangleIndices) {
      leafSurface += surfaceArea(node.bounds);
      leafCount++;
      const n = node.triangleIndices.length;
      if (n < minTri) minTri = n;
      if (n > maxTri) maxTri = n;
      totalTri += n;
    }
    if (node.left) walk(node.left, depth + 1);
    if (node.right) walk(node.right, depth + 1);
  }
  walk(root, 0);
  return {
    totalSurfaceArea: totalSurface,
    surfaceAreaInflation: leafSurface > 0 ? totalSurface / leafSurface : 1,
    maxDepth,
    trianglesPerLeaf: {
      min: leafCount > 0 ? minTri : 0,
      max: maxTri,
      mean: leafCount > 0 ? totalTri / leafCount : 0,
    },
  };
}

function surfaceArea(b: AABB): number {
  const dx = b.max[0] - b.min[0];
  const dy = b.max[1] - b.min[1];
  const dz = b.max[2] - b.min[2];
  return 2 * (dx * dy + dy * dz + dx * dz);
}

// ── Refit + advise rebuild ─────────────────────────────────────

export interface RefitDecision {
  /** Latest stats after refit. */
  stats: ImbalanceStats;
  /** True if the SAH inflation exceeded threshold → caller should rebuild. */
  recommendRebuild: boolean;
  /** Reason text. */
  reason: string;
}

export interface RefitOptions {
  /** Inflation ratio above which we recommend rebuild. Default 2. */
  rebuildThreshold: number;
}

export const DEFAULT_REFIT_OPTIONS: RefitOptions = {
  rebuildThreshold: 2,
};

export function refitWithAdvice(root: BvhNode, mesh: MeshArrays, opts: Partial<RefitOptions> = {}): RefitDecision {
  const o = { ...DEFAULT_REFIT_OPTIONS, ...opts };
  refitBvh(root, mesh);
  const stats = imbalanceStats(root);
  const rebuild = stats.surfaceAreaInflation > o.rebuildThreshold;
  return {
    stats,
    recommendRebuild: rebuild,
    reason: rebuild
      ? `SAH inflation ${stats.surfaceAreaInflation.toFixed(2)} > ${o.rebuildThreshold} — rebuild advised`
      : `SAH inflation ${stats.surfaceAreaInflation.toFixed(2)} acceptable`,
  };
}

// ── Selective subtree rebuild ──────────────────────────────────

/** Find subtrees that should be rebuilt because they're poorly balanced
 *  after refit. Returns a list of nodes whose parents should rebuild them. */
export function findStaleSubtrees(root: BvhNode, threshold: number = 3): BvhNode[] {
  const stale: BvhNode[] = [];
  function walk(node: BvhNode): void {
    if (!node.triangleIndices) {
      const stats = imbalanceStats(node);
      if (stats.surfaceAreaInflation > threshold) {
        stale.push(node);
        return; // skip going deeper
      }
      if (node.left) walk(node.left);
      if (node.right) walk(node.right);
    }
  }
  walk(root);
  return stale;
}

// ── Build helpers (re-export style) ────────────────────────────

/** Rebuild a subtree from its triangle indices. Used when refit advice
 *  says a subtree should be rebuilt. */
export function rebuildSubtree(node: BvhNode, mesh: MeshArrays, leafSize: number = 8): void {
  const triIndices = collectAllTriangles(node);
  const newRoot = buildFresh(triIndices, mesh, leafSize);
  // Clear stale fields before merging (so a previously-leaf node can become internal).
  node.triangleIndices = undefined;
  node.left = undefined;
  node.right = undefined;
  Object.assign(node, newRoot);
}

function collectAllTriangles(node: BvhNode): number[] {
  if (node.triangleIndices) return node.triangleIndices.slice();
  const out: number[] = [];
  if (node.left) out.push(...collectAllTriangles(node.left));
  if (node.right) out.push(...collectAllTriangles(node.right));
  return out;
}

function buildFresh(triIndices: number[], mesh: MeshArrays, leafSize: number): BvhNode {
  const bounds = computeTrianglesBounds(triIndices, mesh);
  if (triIndices.length <= leafSize) {
    return { bounds, triangleIndices: triIndices };
  }
  // Pick longest axis.
  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  const axis = dx >= dy && dx >= dz ? 0 : (dy >= dz ? 1 : 2);
  triIndices.sort((a, b) => triangleCentroidAxis(a, mesh, axis) - triangleCentroidAxis(b, mesh, axis));
  const mid = Math.floor(triIndices.length / 2);
  return {
    bounds,
    left: buildFresh(triIndices.slice(0, mid), mesh, leafSize),
    right: buildFresh(triIndices.slice(mid), mesh, leafSize),
  };
}

function triangleCentroidAxis(t: number, mesh: MeshArrays, axis: number): number {
  const i0 = mesh.indices[t * 3]!;
  const i1 = mesh.indices[t * 3 + 1]!;
  const i2 = mesh.indices[t * 3 + 2]!;
  return (mesh.positions[i0 * 3 + axis]! + mesh.positions[i1 * 3 + axis]! + mesh.positions[i2 * 3 + axis]!) / 3;
}
