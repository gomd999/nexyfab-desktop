/**
 * octree.ts — Spatial index for large assemblies.
 *
 * Once an assembly grows past a few hundred parts, every selection /
 * picking / interference query becomes a linear scan: O(N) per click.
 * For 10k parts that's milliseconds — fine until you string several
 * queries together (mouse move + hover + ray pick) and the UI starts
 * dropping frames.
 *
 * An octree gives O(log N + k) where k is the number of overlapping
 * AABBs at the query point. Build is O(N log N) which we do once per
 * assembly load and update incrementally on insert / move.
 *
 * Design:
 *   - Each node owns an AABB and either children (8 octants) or a
 *     leaf list of (id, AABB) entries.
 *   - Subdivision happens when a leaf passes `maxLeafSize`; rebalance
 *     is automatic.
 *   - Query API: `queryPoint`, `queryRay`, `queryAabb`, `queryFrustum`.
 *
 * Out of scope: 3-D BVH / kd-tree — octree is good enough for AABB-
 * level queries at NexyFab's part counts. Triangle-level picking
 * (precise face selection) layers on top via `BVHforGeometry`.
 */

export interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
}

export interface OctreeEntry {
  /** Stable id of the part / mesh being indexed. */
  id: string;
  /** World-space AABB of the part. */
  aabb: Aabb;
}

interface OctreeNode {
  aabb: Aabb;
  /** Leaf entries when `children === null`; otherwise empty. */
  entries: OctreeEntry[];
  children: OctreeNode[] | null;
  depth: number;
}

export interface OctreeOptions {
  /** Max entries before a leaf subdivides. Default 16. */
  maxLeafSize?: number;
  /** Hard depth cap to prevent pathological subdivision. Default 12. */
  maxDepth?: number;
}

/** Build the root AABB enclosing every entry. */
function rootAabb(entries: OctreeEntry[]): Aabb {
  if (entries.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const e of entries) {
    for (let i = 0; i < 3; i++) {
      if (e.aabb.min[i] < min[i]) min[i] = e.aabb.min[i];
      if (e.aabb.max[i] > max[i]) max[i] = e.aabb.max[i];
    }
  }
  return { min, max };
}

function aabbCenter(a: Aabb): [number, number, number] {
  return [
    (a.min[0] + a.max[0]) * 0.5,
    (a.min[1] + a.max[1]) * 0.5,
    (a.min[2] + a.max[2]) * 0.5,
  ];
}

function aabbOverlap(a: Aabb, b: Aabb): boolean {
  return a.min[0] <= b.max[0] && a.max[0] >= b.min[0]
      && a.min[1] <= b.max[1] && a.max[1] >= b.min[1]
      && a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
}

function aabbContainsPoint(a: Aabb, p: [number, number, number]): boolean {
  return p[0] >= a.min[0] && p[0] <= a.max[0]
      && p[1] >= a.min[1] && p[1] <= a.max[1]
      && p[2] >= a.min[2] && p[2] <= a.max[2];
}

function makeChildAabbs(parent: Aabb): Aabb[] {
  const c = aabbCenter(parent);
  const out: Aabb[] = [];
  for (let i = 0; i < 8; i++) {
    const xMin = (i & 1) ? c[0] : parent.min[0];
    const xMax = (i & 1) ? parent.max[0] : c[0];
    const yMin = (i & 2) ? c[1] : parent.min[1];
    const yMax = (i & 2) ? parent.max[1] : c[1];
    const zMin = (i & 4) ? c[2] : parent.min[2];
    const zMax = (i & 4) ? parent.max[2] : c[2];
    out.push({ min: [xMin, yMin, zMin], max: [xMax, yMax, zMax] });
  }
  return out;
}

/** Whether `inner` lies fully inside `outer`. Entries that straddle
 *  octant boundaries stay at the parent so each entry has exactly one
 *  home — keeps `size()` accurate without a dedup pass. */
function aabbContains(outer: Aabb, inner: Aabb): boolean {
  return inner.min[0] >= outer.min[0] && inner.max[0] <= outer.max[0]
      && inner.min[1] >= outer.min[1] && inner.max[1] <= outer.max[1]
      && inner.min[2] >= outer.min[2] && inner.max[2] <= outer.max[2];
}

function subdivide(node: OctreeNode, opts: Required<OctreeOptions>): void {
  if (node.depth >= opts.maxDepth) return;
  if (node.children !== null) return;
  const childAabbs = makeChildAabbs(node.aabb);
  const children: OctreeNode[] = childAabbs.map(b => ({
    aabb: b,
    entries: [],
    children: null,
    depth: node.depth + 1,
  }));
  const stayed: OctreeEntry[] = [];
  for (const e of node.entries) {
    let placedChild: OctreeNode | null = null;
    for (const child of children) {
      if (aabbContains(child.aabb, e.aabb)) {
        placedChild = child;
        break;
      }
    }
    if (placedChild) placedChild.entries.push(e);
    else stayed.push(e);
  }
  node.entries = stayed;
  node.children = children;
  // Recurse into any child that already over-spilled.
  for (const child of children) {
    if (child.entries.length > opts.maxLeafSize) subdivide(child, opts);
  }
}

export class Octree {
  private root: OctreeNode;
  private opts: Required<OctreeOptions>;

  constructor(entries: OctreeEntry[] = [], opts: OctreeOptions = {}) {
    this.opts = {
      maxLeafSize: opts.maxLeafSize ?? 16,
      maxDepth: opts.maxDepth ?? 12,
    };
    this.root = {
      aabb: rootAabb(entries),
      entries: [...entries],
      children: null,
      depth: 0,
    };
    if (this.root.entries.length > this.opts.maxLeafSize) {
      subdivide(this.root, this.opts);
    }
  }

  /** Insert a single entry. May trigger subdivision. */
  insert(entry: OctreeEntry): void {
    // Expand root AABB if needed.
    for (let i = 0; i < 3; i++) {
      if (entry.aabb.min[i] < this.root.aabb.min[i]) this.root.aabb.min[i] = entry.aabb.min[i];
      if (entry.aabb.max[i] > this.root.aabb.max[i]) this.root.aabb.max[i] = entry.aabb.max[i];
    }
    this.insertInto(this.root, entry);
  }

  private insertInto(node: OctreeNode, entry: OctreeEntry): void {
    if (node.children === null) {
      node.entries.push(entry);
      if (node.entries.length > this.opts.maxLeafSize && node.depth < this.opts.maxDepth) {
        subdivide(node, this.opts);
      }
      return;
    }
    // Place in the single child that fully contains the entry; else
    // store at the current (straddling) node.
    for (const child of node.children) {
      if (aabbContains(child.aabb, entry.aabb)) {
        this.insertInto(child, entry);
        return;
      }
    }
    node.entries.push(entry);
  }

  /** Remove an entry by id. Linear within the matching leaf. */
  remove(id: string): boolean {
    return this.removeFrom(this.root, id);
  }

  private removeFrom(node: OctreeNode, id: string): boolean {
    const idx = node.entries.findIndex(e => e.id === id);
    if (idx !== -1) {
      node.entries.splice(idx, 1);
      return true;
    }
    if (node.children) {
      for (const child of node.children) {
        if (this.removeFrom(child, id)) return true;
      }
    }
    return false;
  }

  /** Collect every entry whose AABB contains the point. */
  queryPoint(p: [number, number, number]): OctreeEntry[] {
    const out: OctreeEntry[] = [];
    this.queryPointInto(this.root, p, out);
    return out;
  }

  private queryPointInto(node: OctreeNode, p: [number, number, number], out: OctreeEntry[]): void {
    if (!aabbContainsPoint(node.aabb, p)) return;
    for (const e of node.entries) {
      if (aabbContainsPoint(e.aabb, p)) out.push(e);
    }
    if (node.children) {
      for (const child of node.children) this.queryPointInto(child, p, out);
    }
  }

  /** Collect every entry whose AABB overlaps the query AABB. */
  queryAabb(query: Aabb): OctreeEntry[] {
    const out: OctreeEntry[] = [];
    this.queryAabbInto(this.root, query, out);
    return out;
  }

  private queryAabbInto(node: OctreeNode, query: Aabb, out: OctreeEntry[]): void {
    if (!aabbOverlap(node.aabb, query)) return;
    for (const e of node.entries) {
      if (aabbOverlap(e.aabb, query)) out.push(e);
    }
    if (node.children) {
      for (const child of node.children) this.queryAabbInto(child, query, out);
    }
  }

  /** Number of entries indexed. */
  size(): number {
    return this.countSize(this.root);
  }

  private countSize(node: OctreeNode): number {
    let n = node.entries.length;
    if (node.children) for (const c of node.children) n += this.countSize(c);
    return n;
  }
}
