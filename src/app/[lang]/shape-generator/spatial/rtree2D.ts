/**
 * rtree2D.ts — R-tree spatial index for 2D rectangles.
 *
 * For 2D drawings with thousands of entities (CAM toolpaths, drawings
 * with N balloons, PCB pads), a linear scan to answer "what's inside
 * this selection box?" becomes the bottleneck. R-trees answer
 * window-query / nearest-neighbour in O(log n) average.
 *
 * Quick design:
 *
 *   - Bulk-load via Sort-Tile-Recursive (STR) for the initial build.
 *     Best leaf packing; ~O(n log n) build.
 *   - Dynamic insert / delete via the simple split-on-overflow rule.
 *     Lower quality but fine for moderate updates.
 *   - Search queries: window (bbox intersect), point (containment),
 *     k-nearest by traversal with priority queue.
 */

export interface BBox2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RTreeEntry<TValue = unknown> {
  bbox: BBox2D;
  value: TValue;
}

interface RTreeNode<TValue> {
  bbox: BBox2D;
  /** Leaf only: stored entries. */
  entries?: RTreeEntry<TValue>[];
  /** Internal: child nodes. */
  children?: RTreeNode<TValue>[];
}

export interface RTreeOptions {
  /** Max entries per node before split. */
  maxEntries: number;
  /** Min entries (typically 0.4 × max). */
  minEntries: number;
}

export const DEFAULT_RTREE_OPTIONS: RTreeOptions = {
  maxEntries: 9,
  minEntries: 4,
};

// ── R-tree class ───────────────────────────────────────────────

export class RTree2D<TValue = unknown> {
  private root: RTreeNode<TValue>;
  private options: RTreeOptions;

  constructor(options: Partial<RTreeOptions> = {}) {
    this.options = { ...DEFAULT_RTREE_OPTIONS, ...options };
    this.root = { bbox: emptyBbox(), entries: [] };
  }

  // ── Bulk load (STR) ───────────────────────────────────────────

  load(entries: RTreeEntry<TValue>[]): void {
    if (entries.length === 0) {
      this.root = { bbox: emptyBbox(), entries: [] };
      return;
    }
    this.root = buildStr(entries, this.options);
  }

  // ── Single insert ─────────────────────────────────────────────

  insert(entry: RTreeEntry<TValue>): void {
    this.insertRecursive(this.root, entry, 0);
    // If root overflowed → split.
    if (this.root.entries && this.root.entries.length > this.options.maxEntries) {
      this.splitRoot();
    }
  }

  private insertRecursive(node: RTreeNode<TValue>, entry: RTreeEntry<TValue>, _depth: number): void {
    void _depth;
    if (node.entries) {
      node.entries.push(entry);
      node.bbox = expandBbox(node.bbox, entry.bbox);
      return;
    }
    if (node.children) {
      // Choose subtree with least area enlargement.
      let bestIdx = 0;
      let bestEnlargement = Infinity;
      for (let i = 0; i < node.children.length; i++) {
        const enlarged = expandBbox(node.children[i]!.bbox, entry.bbox);
        const enlargement = bboxArea(enlarged) - bboxArea(node.children[i]!.bbox);
        if (enlargement < bestEnlargement) {
          bestEnlargement = enlargement;
          bestIdx = i;
        }
      }
      this.insertRecursive(node.children[bestIdx]!, entry, _depth + 1);
      node.bbox = expandBbox(node.bbox, entry.bbox);
    }
  }

  private splitRoot(): void {
    const entries = this.root.entries!;
    const mid = Math.ceil(entries.length / 2);
    entries.sort((a, b) => a.bbox.minX - b.bbox.minX);
    const left: RTreeNode<TValue> = {
      bbox: entriesBbox(entries.slice(0, mid)),
      entries: entries.slice(0, mid),
    };
    const right: RTreeNode<TValue> = {
      bbox: entriesBbox(entries.slice(mid)),
      entries: entries.slice(mid),
    };
    this.root = {
      bbox: expandBbox(left.bbox, right.bbox),
      children: [left, right],
    };
  }

  // ── Queries ───────────────────────────────────────────────────

  search(window: BBox2D): RTreeEntry<TValue>[] {
    const result: RTreeEntry<TValue>[] = [];
    searchNode(this.root, window, result);
    return result;
  }

  /** Test if any entry's bbox contains the point. */
  containsPoint(x: number, y: number): RTreeEntry<TValue>[] {
    return this.search({ minX: x, minY: y, maxX: x, maxY: y });
  }

  /** k-nearest entries to (x, y) (by bbox center distance). */
  kNearest(x: number, y: number, k: number): RTreeEntry<TValue>[] {
    // All entries → sort by center distance. For small/medium datasets
    // this is faster than a heap-based traversal; for huge sets switch
    // to incremental NN.
    const all: RTreeEntry<TValue>[] = [];
    collectAll(this.root, all);
    all.sort((a, b) => {
      const dA = pointToBboxSqDist(x, y, a.bbox);
      const dB = pointToBboxSqDist(x, y, b.bbox);
      return dA - dB;
    });
    return all.slice(0, k);
  }

  // ── Delete ───────────────────────────────────────────────────

  remove(entry: RTreeEntry<TValue>, isEqual: (a: TValue, b: TValue) => boolean = (a, b) => a === b): boolean {
    return removeRecursive(this.root, entry, isEqual);
  }

  // ── Inspection ───────────────────────────────────────────────

  size(): number {
    return countEntries(this.root);
  }

  bounds(): BBox2D {
    return this.root.bbox;
  }

  toFlatList(): RTreeEntry<TValue>[] {
    const out: RTreeEntry<TValue>[] = [];
    collectAll(this.root, out);
    return out;
  }
}

// ── STR build ───────────────────────────────────────────────────

function buildStr<T>(entries: RTreeEntry<T>[], options: RTreeOptions): RTreeNode<T> {
  if (entries.length <= options.maxEntries) {
    return { bbox: entriesBbox(entries), entries };
  }
  // Sort by X centroid.
  entries.sort((a, b) => bboxCenterX(a.bbox) - bboxCenterX(b.bbox));
  const slicesCount = Math.ceil(Math.sqrt(entries.length / options.maxEntries));
  const perSlice = Math.ceil(entries.length / slicesCount);
  const childNodes: RTreeNode<T>[] = [];
  for (let s = 0; s < entries.length; s += perSlice) {
    const slice = entries.slice(s, s + perSlice);
    slice.sort((a, b) => bboxCenterY(a.bbox) - bboxCenterY(b.bbox));
    for (let r = 0; r < slice.length; r += options.maxEntries) {
      const leaf = slice.slice(r, r + options.maxEntries);
      childNodes.push({ bbox: entriesBbox(leaf), entries: leaf });
    }
  }
  return {
    bbox: childrenBbox(childNodes),
    children: childNodes,
  };
}

function searchNode<T>(node: RTreeNode<T>, window: BBox2D, result: RTreeEntry<T>[]): void {
  if (!bboxesIntersect(node.bbox, window)) return;
  if (node.entries) {
    for (const e of node.entries) {
      if (bboxesIntersect(e.bbox, window)) result.push(e);
    }
  }
  if (node.children) {
    for (const c of node.children) searchNode(c, window, result);
  }
}

function collectAll<T>(node: RTreeNode<T>, out: RTreeEntry<T>[]): void {
  if (node.entries) out.push(...node.entries);
  if (node.children) for (const c of node.children) collectAll(c, out);
}

function countEntries<T>(node: RTreeNode<T>): number {
  if (node.entries) return node.entries.length;
  let n = 0;
  if (node.children) for (const c of node.children) n += countEntries(c);
  return n;
}

function removeRecursive<T>(node: RTreeNode<T>, target: RTreeEntry<T>, isEqual: (a: T, b: T) => boolean): boolean {
  if (node.entries) {
    for (let i = 0; i < node.entries.length; i++) {
      if (isEqual(node.entries[i]!.value, target.value)) {
        node.entries.splice(i, 1);
        node.bbox = entriesBbox(node.entries);
        return true;
      }
    }
    return false;
  }
  if (node.children) {
    for (const c of node.children) {
      if (bboxesIntersect(c.bbox, target.bbox)) {
        if (removeRecursive(c, target, isEqual)) {
          node.bbox = childrenBbox(node.children);
          return true;
        }
      }
    }
  }
  return false;
}

// ── BBox helpers ───────────────────────────────────────────────

function emptyBbox(): BBox2D {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function expandBbox(a: BBox2D, b: BBox2D): BBox2D {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function bboxArea(b: BBox2D): number {
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

function bboxCenterX(b: BBox2D): number { return (b.minX + b.maxX) / 2; }
function bboxCenterY(b: BBox2D): number { return (b.minY + b.maxY) / 2; }

function bboxesIntersect(a: BBox2D, b: BBox2D): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

function entriesBbox<T>(entries: RTreeEntry<T>[]): BBox2D {
  if (entries.length === 0) return emptyBbox();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of entries) {
    if (e.bbox.minX < minX) minX = e.bbox.minX;
    if (e.bbox.minY < minY) minY = e.bbox.minY;
    if (e.bbox.maxX > maxX) maxX = e.bbox.maxX;
    if (e.bbox.maxY > maxY) maxY = e.bbox.maxY;
  }
  return { minX, minY, maxX, maxY };
}

function childrenBbox<T>(children: RTreeNode<T>[]): BBox2D {
  if (children.length === 0) return emptyBbox();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of children) {
    if (c.bbox.minX < minX) minX = c.bbox.minX;
    if (c.bbox.minY < minY) minY = c.bbox.minY;
    if (c.bbox.maxX > maxX) maxX = c.bbox.maxX;
    if (c.bbox.maxY > maxY) maxY = c.bbox.maxY;
  }
  return { minX, minY, maxX, maxY };
}

function pointToBboxSqDist(x: number, y: number, b: BBox2D): number {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return (cx - x) ** 2 + (cy - y) ** 2;
}
