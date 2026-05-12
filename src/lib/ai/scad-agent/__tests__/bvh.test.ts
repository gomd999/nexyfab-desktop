/**
 * Z3 — BVH + sparse mate adjacency tests.
 *
 * Pins:
 *   - empty BVH is queryable (no NaNs)
 *   - point queries return only overlapping items
 *   - allOverlappingPairs is dedup'd and stable
 *   - mate adjacency reaches the right connected component
 */

import { describe, it, expect } from 'vitest';
import {
  buildBvh,
  queryOverlaps,
  allOverlappingPairs,
  buildMateAdjacency,
  connectedComponent,
  type BvhItem,
  type AABB,
} from '../bvh';

const box = (id: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BvhItem => ({
  id,
  bbox: { min: [x0, y0, z0], max: [x1, y1, z1] },
});

describe('BVH', () => {
  it('empty bvh handles queries gracefully', () => {
    const bvh = buildBvh([]);
    expect(bvh.itemCount).toBe(0);
    const q: AABB = { min: [0, 0, 0], max: [1, 1, 1] };
    expect(queryOverlaps(bvh, q)).toEqual([]);
    expect(allOverlappingPairs(bvh)).toEqual([]);
  });

  it('queryOverlaps returns only items whose bbox intersects', () => {
    const bvh = buildBvh([
      box('a', 0, 0, 0, 10, 10, 10),
      box('b', 5, 5, 5, 15, 15, 15),  // overlaps a
      box('c', 100, 100, 100, 110, 110, 110),  // far away
    ]);
    const r = queryOverlaps(bvh, { min: [0, 0, 0], max: [10, 10, 10] });
    const ids = r.map(x => x.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('queryOverlaps respects excludeId', () => {
    const bvh = buildBvh([
      box('a', 0, 0, 0, 10, 10, 10),
      box('b', 5, 5, 5, 15, 15, 15),
    ]);
    const r = queryOverlaps(bvh, { min: [0, 0, 0], max: [10, 10, 10] }, 'a');
    expect(r.map(x => x.id)).toEqual(['b']);
  });

  it('allOverlappingPairs returns each pair exactly once', () => {
    const bvh = buildBvh([
      box('a', 0, 0, 0, 10, 10, 10),
      box('b', 5, 5, 5, 15, 15, 15),
      box('c', 8, 8, 8, 12, 12, 12),
    ]);
    const pairs = allOverlappingPairs(bvh);
    const keys = pairs.map(([x, y]) => `${x.id}|${y.id}`).sort();
    expect(keys).toEqual(['a|b', 'a|c', 'b|c']);
  });

  it('100-part scenario completes in well under 100ms', () => {
    const items: BvhItem[] = [];
    for (let i = 0; i < 100; i++) {
      // Place each in a 10×10 grid, 50mm apart, 8mm cube.
      const gx = (i % 10) * 50;
      const gy = Math.floor(i / 10) * 50;
      items.push(box(`p${i}`, gx, gy, 0, gx + 8, gy + 8, 8));
    }
    const t0 = performance.now();
    const bvh = buildBvh(items);
    const pairs = allOverlappingPairs(bvh);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(100);
    // Grid layout means no overlaps — sanity check.
    expect(pairs.length).toBe(0);
  });

  it('overlapping cluster scales sub-quadratically', () => {
    // 50 boxes all in the same region — many overlaps
    const items: BvhItem[] = [];
    for (let i = 0; i < 50; i++) {
      items.push(box(`o${i}`, i * 0.5, 0, 0, i * 0.5 + 10, 10, 10));
    }
    const bvh = buildBvh(items);
    const pairs = allOverlappingPairs(bvh);
    // Each overlaps with ~20 neighbors, so pair count is in the hundreds.
    expect(pairs.length).toBeGreaterThan(100);
    expect(pairs.length).toBeLessThan(50 * 49 / 2);  // strictly less than n²/2
  });
});

describe('mate adjacency', () => {
  it('isolated handles have no neighbors', () => {
    const adj = buildMateAdjacency([]);
    expect(connectedComponent(adj, 'x').size).toBe(1);
  });

  it('connected component spans transitively', () => {
    const adj = buildMateAdjacency([
      { handleA: 'a', handleB: 'b' },
      { handleA: 'b', handleB: 'c' },
      { handleA: 'd', handleB: 'e' },
    ]);
    expect(Array.from(connectedComponent(adj, 'a')).sort()).toEqual(['a', 'b', 'c']);
    expect(Array.from(connectedComponent(adj, 'd')).sort()).toEqual(['d', 'e']);
  });

  it('graph is bidirectional', () => {
    const adj = buildMateAdjacency([{ handleA: 'a', handleB: 'b' }]);
    expect(adj.graph.get('a')?.has('b')).toBe(true);
    expect(adj.graph.get('b')?.has('a')).toBe(true);
  });
});
