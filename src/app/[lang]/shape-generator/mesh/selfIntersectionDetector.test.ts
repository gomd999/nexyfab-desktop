import { describe, it, expect } from 'vitest';
import {
  detectSelfIntersections,
  groupByTriangle,
  summarize,
  type Triangle,
} from './selfIntersectionDetector';

const t1: Triangle = {
  id: 't1',
  v0: { x: 0, y: 0, z: 0 },
  v1: { x: 10, y: 0, z: 0 },
  v2: { x: 5, y: 10, z: 0 },
};

// Distant triangle, no overlap.
const t2: Triangle = {
  id: 't2',
  v0: { x: 100, y: 100, z: 100 },
  v1: { x: 110, y: 100, z: 100 },
  v2: { x: 105, y: 110, z: 100 },
};

// Triangle crossing through t1 (different plane).
const t3: Triangle = {
  id: 't3',
  v0: { x: 5, y: 5, z: -5 },
  v1: { x: 5, y: 5, z: 5 },
  v2: { x: 8, y: 5, z: 0 },
};

describe('detectSelfIntersections', () => {
  it('empty input → no pairs', () => {
    expect(detectSelfIntersections([]).pairs).toEqual([]);
  });

  it('single triangle → no pairs', () => {
    expect(detectSelfIntersections([t1]).pairs).toEqual([]);
  });

  it('distant triangles → AABB prune, no test', () => {
    const r = detectSelfIntersections([t1, t2]);
    expect(r.pairs).toEqual([]);
    expect(r.pairsTested).toBe(0);
  });

  it('crossing triangles detected', () => {
    const r = detectSelfIntersections([t1, t3]);
    expect(r.pairs.length).toBeGreaterThan(0);
  });

  it('triangles sharing an edge → skipped (not self-intersect)', () => {
    const edgeMate: Triangle = {
      id: 'edgeMate',
      v0: t1.v0,
      v1: t1.v1,
      v2: { x: 5, y: -10, z: 0 },
    };
    const r = detectSelfIntersections([t1, edgeMate]);
    expect(r.pairs).toEqual([]);
  });

  it('aabbsCount tracks input size', () => {
    const r = detectSelfIntersections([t1, t2, t3]);
    expect(r.aabbsCount).toBe(3);
  });

  it('pairsTested ≤ N(N-1)/2', () => {
    const r = detectSelfIntersections([t1, t2, t3]);
    expect(r.pairsTested).toBeLessThanOrEqual(3);
  });

  it('two coplanar triangles in same plane do not flag (Möller plane test)', () => {
    const coplanar: Triangle = {
      id: 'cop',
      v0: { x: 20, y: 0, z: 0 },
      v1: { x: 30, y: 0, z: 0 },
      v2: { x: 25, y: 10, z: 0 },
    };
    // t1 and coplanar both at z=0, no overlap in XY.
    const r = detectSelfIntersections([t1, coplanar]);
    expect(r.pairs).toEqual([]);
  });
});

describe('groupByTriangle', () => {
  it('builds adjacency from pairs', () => {
    const result = detectSelfIntersections([t1, t3]);
    const groups = groupByTriangle(result);
    expect(groups.has('t1')).toBe(true);
    expect(groups.get('t1')!.has('t3')).toBe(true);
  });

  it('empty result → empty map', () => {
    const groups = groupByTriangle({ pairs: [], aabbsCount: 0, pairsTested: 0 });
    expect(groups.size).toBe(0);
  });
});

describe('summarize', () => {
  it('counts intersecting triangles', () => {
    const r = detectSelfIntersections([t1, t3]);
    const s = summarize([t1, t3], r);
    expect(s.triangleCount).toBe(2);
    expect(s.intersectingTriangleCount).toBe(2);
  });

  it('empty mesh → zero', () => {
    const r = detectSelfIntersections([]);
    const s = summarize([], r);
    expect(s.triangleCount).toBe(0);
  });
});
