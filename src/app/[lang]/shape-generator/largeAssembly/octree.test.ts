import { describe, it, expect } from 'vitest';
import { Octree, type OctreeEntry, type Aabb } from './octree';

function box(id: string, x: number, y: number, z: number, size = 1): OctreeEntry {
  return {
    id,
    aabb: {
      min: [x - size / 2, y - size / 2, z - size / 2],
      max: [x + size / 2, y + size / 2, z + size / 2],
    },
  };
}

describe('Octree · size + insert', () => {
  it('size reflects inserted entries', () => {
    const t = new Octree([box('a', 0, 0, 0)]);
    expect(t.size()).toBe(1);
    t.insert(box('b', 5, 0, 0));
    expect(t.size()).toBe(2);
  });

  it('size grows with bulk-construction', () => {
    const entries: OctreeEntry[] = [];
    for (let i = 0; i < 100; i++) entries.push(box(`e${i}`, i, 0, 0));
    const t = new Octree(entries);
    expect(t.size()).toBe(100);
  });
});

describe('Octree · queryPoint', () => {
  it('returns the entry whose AABB contains the point', () => {
    const t = new Octree([box('a', 0, 0, 0), box('b', 10, 0, 0)]);
    const found = t.queryPoint([0, 0, 0]).map(e => e.id);
    expect(found).toEqual(['a']);
  });

  it('returns all overlapping entries when boxes are stacked', () => {
    // Both boxes contain origin.
    const t = new Octree([box('a', 0, 0, 0, 10), box('b', 0, 0, 0, 5)]);
    const found = t.queryPoint([0, 0, 0]).map(e => e.id).sort();
    expect(found).toEqual(['a', 'b']);
  });

  it('returns empty for a point outside everything', () => {
    const t = new Octree([box('a', 0, 0, 0)]);
    expect(t.queryPoint([1000, 0, 0])).toEqual([]);
  });
});

describe('Octree · queryAabb', () => {
  it('returns entries overlapping the query AABB', () => {
    const t = new Octree([
      box('a', 0, 0, 0),
      box('b', 5, 0, 0),
      box('c', 100, 0, 0),
    ]);
    const query: Aabb = { min: [-2, -2, -2], max: [7, 2, 2] };
    const found = t.queryAabb(query).map(e => e.id).sort();
    expect(found).toEqual(['a', 'b']);
  });

  it('returns empty when the query AABB is outside the tree extent', () => {
    const t = new Octree([box('a', 0, 0, 0)]);
    expect(t.queryAabb({ min: [1000, 1000, 1000], max: [1001, 1001, 1001] })).toEqual([]);
  });
});

describe('Octree · remove', () => {
  it('removes a specific entry by id', () => {
    const t = new Octree([box('a', 0, 0, 0), box('b', 5, 0, 0)]);
    expect(t.remove('a')).toBe(true);
    expect(t.size()).toBe(1);
    expect(t.queryPoint([0, 0, 0])).toEqual([]);
  });

  it('returns false when id not present', () => {
    const t = new Octree([box('a', 0, 0, 0)]);
    expect(t.remove('ghost')).toBe(false);
  });
});

describe('Octree · subdivision under load', () => {
  it('correctly indexes 1000 randomly distributed entries', () => {
    const entries: OctreeEntry[] = [];
    for (let i = 0; i < 1000; i++) {
      entries.push(box(`e${i}`,
        (i % 10) * 5,
        Math.floor(i / 10) % 10 * 5,
        Math.floor(i / 100) * 5,
      ));
    }
    const t = new Octree(entries, { maxLeafSize: 8 });
    expect(t.size()).toBe(1000);
    // Query a corner — should find at least one entry quickly.
    expect(t.queryPoint([0, 0, 0]).length).toBeGreaterThan(0);
  });
});

describe('Octree · custom options', () => {
  it('respects custom maxLeafSize', () => {
    const t = new Octree(
      Array.from({ length: 50 }, (_, i) => box(`e${i}`, i, 0, 0)),
      { maxLeafSize: 4 },
    );
    expect(t.size()).toBe(50);
  });

  it('respects maxDepth cap (no infinite recursion on coincident entries)', () => {
    // 30 entries all at origin — would subdivide forever without cap.
    const entries = Array.from({ length: 30 }, (_, i) => box(`e${i}`, 0, 0, 0, 0.1));
    const t = new Octree(entries, { maxLeafSize: 4, maxDepth: 5 });
    expect(t.size()).toBe(30);
  });
});
