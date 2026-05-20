import { describe, it, expect } from 'vitest';
import { RTree2D, type RTreeEntry } from './rtree2D';

function makeEntry(id: string, minX: number, minY: number, maxX: number, maxY: number): RTreeEntry<string> {
  return { bbox: { minX, minY, maxX, maxY }, value: id };
}

describe('RTree2D — basic', () => {
  it('empty tree has size 0', () => {
    expect(new RTree2D().size()).toBe(0);
  });

  it('insert + size', () => {
    const t = new RTree2D<string>();
    t.insert(makeEntry('a', 0, 0, 1, 1));
    t.insert(makeEntry('b', 5, 5, 6, 6));
    expect(t.size()).toBe(2);
  });

  it('bulk load', () => {
    const entries = Array.from({ length: 20 }, (_, i) => makeEntry(`e${i}`, i, i, i + 1, i + 1));
    const t = new RTree2D<string>();
    t.load(entries);
    expect(t.size()).toBe(20);
  });
});

describe('RTree2D — search', () => {
  it('window query finds intersecting entries', () => {
    const t = new RTree2D<string>();
    t.insert(makeEntry('a', 0, 0, 1, 1));
    t.insert(makeEntry('b', 5, 5, 6, 6));
    t.insert(makeEntry('c', 0.5, 0.5, 1.5, 1.5));
    const results = t.search({ minX: 0, minY: 0, maxX: 2, maxY: 2 });
    expect(results).toHaveLength(2);
    expect(results.map(r => r.value).sort()).toEqual(['a', 'c']);
  });

  it('point containment query', () => {
    const t = new RTree2D<string>();
    t.insert(makeEntry('a', 0, 0, 5, 5));
    t.insert(makeEntry('b', 10, 10, 15, 15));
    const results = t.containsPoint(2, 2);
    expect(results).toHaveLength(1);
    expect(results[0]!.value).toBe('a');
  });

  it('non-intersecting query returns empty', () => {
    const t = new RTree2D<string>();
    t.insert(makeEntry('a', 0, 0, 1, 1));
    expect(t.search({ minX: 100, minY: 100, maxX: 200, maxY: 200 })).toEqual([]);
  });
});

describe('RTree2D — kNearest', () => {
  it('returns k nearest by center', () => {
    const t = new RTree2D<string>();
    t.insert(makeEntry('near', 0, 0, 1, 1));
    t.insert(makeEntry('mid', 5, 5, 6, 6));
    t.insert(makeEntry('far', 100, 100, 101, 101));
    const results = t.kNearest(0, 0, 2);
    expect(results.map(r => r.value)).toEqual(['near', 'mid']);
  });

  it('k larger than dataset returns all', () => {
    const t = new RTree2D<string>();
    t.insert(makeEntry('a', 0, 0, 1, 1));
    const results = t.kNearest(0, 0, 10);
    expect(results).toHaveLength(1);
  });
});

describe('RTree2D — delete', () => {
  it('removes by value equality', () => {
    const t = new RTree2D<string>();
    t.insert(makeEntry('a', 0, 0, 1, 1));
    t.insert(makeEntry('b', 5, 5, 6, 6));
    const removed = t.remove(makeEntry('a', 0, 0, 1, 1));
    expect(removed).toBe(true);
    expect(t.size()).toBe(1);
  });

  it('remove non-existent returns false', () => {
    const t = new RTree2D<string>();
    expect(t.remove(makeEntry('nope', 0, 0, 1, 1))).toBe(false);
  });
});

describe('RTree2D — bounds + toFlatList', () => {
  it('bounds wraps all entries', () => {
    const t = new RTree2D<string>();
    t.insert(makeEntry('a', 0, 0, 1, 1));
    t.insert(makeEntry('b', 10, 5, 12, 8));
    const bounds = t.bounds();
    expect(bounds.minX).toBe(0);
    expect(bounds.maxX).toBe(12);
  });

  it('toFlatList enumerates entries', () => {
    const t = new RTree2D<string>();
    t.insert(makeEntry('a', 0, 0, 1, 1));
    t.insert(makeEntry('b', 5, 5, 6, 6));
    const list = t.toFlatList();
    expect(list).toHaveLength(2);
  });
});

describe('RTree2D — bulk load query', () => {
  it('STR-loaded tree answers window query correctly', () => {
    const entries = Array.from({ length: 50 }, (_, i) => makeEntry(`e${i}`, i, 0, i + 0.5, 1));
    const t = new RTree2D<string>();
    t.load(entries);
    const results = t.search({ minX: 5, minY: 0, maxX: 10, maxY: 2 });
    // Entries with index 5..10 intersect.
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const idx = parseInt(r.value.slice(1), 10);
      expect(idx).toBeGreaterThanOrEqual(4);
      expect(idx).toBeLessThanOrEqual(10);
    }
  });
});
