/**
 * lazyLoad.ts — LRU cache for part geometries under a memory budget.
 *
 * Loading every part's geometry eagerly works up to a few hundred
 * parts. Past that the GPU + heap fill up and the tab crashes. The
 * fix: keep an LRU cache of recently-used geometries, evict the
 * least-recently-used when memory exceeds budget.
 *
 * The "memory cost" of a geometry is estimated from triangle + vertex
 * counts. Real numbers depend on attribute layout, but the relative
 * ordering is what matters for eviction.
 *
 * Out of scope: GPU buffer disposal (the renderer integration calls
 * `geometry.dispose()` on evicted entries — this module just decides
 * which to evict).
 */

export interface GeometrySize {
  vertexCount: number;
  triangleCount: number;
}

/** Approximate bytes consumed by a geometry with the given counts.
 *  Standard layout: position (3 floats) + normal (3 floats) + index
 *  (uint32) per vertex/tri. */
export function estimateBytes(size: GeometrySize): number {
  const vertexBytes = size.vertexCount * (3 * 4 + 3 * 4); // pos + normal
  const indexBytes = size.triangleCount * 3 * 4;          // uint32 indices
  return vertexBytes + indexBytes;
}

interface CacheEntry {
  size: GeometrySize;
  bytes: number;
  /** Monotonic counter — bumped on every access. */
  lastUsed: number;
}

export interface LazyLoadOptions {
  /** Memory budget in bytes. Default 256 MB. */
  budgetBytes?: number;
}

export class GeometryLruCache {
  private readonly map = new Map<string, CacheEntry>();
  private nextSeq = 1;
  private totalBytes = 0;
  private readonly budgetBytes: number;
  /** Evicted ids since last query — drains on `consumeEvictions`. */
  private evicted: string[] = [];

  constructor(opts: LazyLoadOptions = {}) {
    this.budgetBytes = opts.budgetBytes ?? 256 * 1024 * 1024;
  }

  /** Record a part as loaded with its geometry size. */
  put(id: string, size: GeometrySize): void {
    const bytes = estimateBytes(size);
    const prev = this.map.get(id);
    if (prev) this.totalBytes -= prev.bytes;
    this.map.set(id, { size, bytes, lastUsed: this.nextSeq++ });
    this.totalBytes += bytes;
    this.evictIfOver();
  }

  /** Mark a part as accessed (bumps its LRU position). */
  touch(id: string): boolean {
    const entry = this.map.get(id);
    if (!entry) return false;
    entry.lastUsed = this.nextSeq++;
    return true;
  }

  /** Whether the part is currently in cache. */
  has(id: string): boolean {
    return this.map.has(id);
  }

  /** Manually remove a part. Returns true when removed. */
  remove(id: string): boolean {
    const entry = this.map.get(id);
    if (!entry) return false;
    this.totalBytes -= entry.bytes;
    this.map.delete(id);
    return true;
  }

  /** Drain the eviction queue — caller disposes the GPU buffers for
   *  each id returned, then drops them from the renderer state. */
  consumeEvictions(): string[] {
    const out = this.evicted;
    this.evicted = [];
    return out;
  }

  /** Current memory usage. */
  bytesInUse(): number { return this.totalBytes; }
  /** Configured budget for callers' info panels. */
  budget(): number { return this.budgetBytes; }
  /** Cache occupancy (0..1+; >1 means over-budget mid-eviction). */
  occupancy(): number { return this.totalBytes / this.budgetBytes; }
  size(): number { return this.map.size; }

  private evictIfOver(): void {
    if (this.totalBytes <= this.budgetBytes) return;
    // Sort by lastUsed ascending — oldest first.
    const sorted = [...this.map.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [id, entry] of sorted) {
      if (this.totalBytes <= this.budgetBytes) break;
      this.totalBytes -= entry.bytes;
      this.map.delete(id);
      this.evicted.push(id);
    }
  }
}
