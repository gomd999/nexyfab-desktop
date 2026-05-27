import { describe, it, expect } from 'vitest';
import { GeometryLruCache, estimateBytes } from './lazyLoad';

const smallSize = { vertexCount: 100, triangleCount: 200 };
const largeSize = { vertexCount: 100_000, triangleCount: 200_000 };

describe('estimateBytes', () => {
  it('scales with vertex + triangle counts', () => {
    const small = estimateBytes(smallSize);
    const large = estimateBytes(largeSize);
    expect(large).toBeGreaterThan(small * 100);
  });

  it('returns 0 for empty geometry', () => {
    expect(estimateBytes({ vertexCount: 0, triangleCount: 0 })).toBe(0);
  });
});

describe('GeometryLruCache · put + touch', () => {
  it('tracks size of inserted entries', () => {
    const cache = new GeometryLruCache({ budgetBytes: 10_000_000 });
    cache.put('a', smallSize);
    cache.put('b', smallSize);
    expect(cache.size()).toBe(2);
    expect(cache.bytesInUse()).toBe(estimateBytes(smallSize) * 2);
  });

  it('replaces a parts bytes when re-put', () => {
    const cache = new GeometryLruCache({ budgetBytes: 10_000_000 });
    cache.put('a', smallSize);
    cache.put('a', largeSize); // replace with larger
    expect(cache.size()).toBe(1);
    expect(cache.bytesInUse()).toBe(estimateBytes(largeSize));
  });

  it('touch returns false for unknown id', () => {
    const cache = new GeometryLruCache();
    expect(cache.touch('ghost')).toBe(false);
  });

  it('touch returns true for known id', () => {
    const cache = new GeometryLruCache();
    cache.put('a', smallSize);
    expect(cache.touch('a')).toBe(true);
  });
});

describe('GeometryLruCache · eviction', () => {
  it('evicts the least-recently-used part when budget exceeded', () => {
    const cache = new GeometryLruCache({
      budgetBytes: estimateBytes(largeSize) + estimateBytes(smallSize) * 2,
    });
    cache.put('big', largeSize);
    cache.put('a', smallSize);
    cache.put('b', smallSize);
    // Touch 'big' to keep it MRU; then add another small that pushes
    // over budget — should evict 'a' (LRU).
    cache.touch('big');
    cache.touch('b');
    cache.put('c', smallSize);
    const evicted = cache.consumeEvictions();
    expect(evicted).toContain('a');
    expect(cache.has('big')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  it('consumeEvictions drains the queue (idempotent)', () => {
    const cache = new GeometryLruCache({ budgetBytes: 100 });
    cache.put('a', smallSize); // over budget immediately
    expect(cache.consumeEvictions().length).toBeGreaterThanOrEqual(0);
    expect(cache.consumeEvictions()).toEqual([]); // already drained
  });
});

describe('GeometryLruCache · occupancy', () => {
  it('reports occupancy fraction relative to budget', () => {
    const cache = new GeometryLruCache({ budgetBytes: estimateBytes(largeSize) * 2 });
    cache.put('a', largeSize);
    expect(cache.occupancy()).toBeCloseTo(0.5, 2);
  });

  it('size + remove work as expected', () => {
    const cache = new GeometryLruCache();
    cache.put('a', smallSize);
    cache.put('b', smallSize);
    expect(cache.size()).toBe(2);
    expect(cache.remove('a')).toBe(true);
    expect(cache.size()).toBe(1);
    expect(cache.remove('a')).toBe(false);
  });
});
