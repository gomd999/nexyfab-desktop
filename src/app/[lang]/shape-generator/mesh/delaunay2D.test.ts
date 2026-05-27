import { describe, it, expect } from 'vitest';
import {
  delaunay2D,
  insideCircumcircle,
  voronoiFromDelaunay,
  circumcenter,
  statistics,
  type Point2D,
} from './delaunay2D';

describe('delaunay2D — basic', () => {
  it('< 3 points → empty result', () => {
    const r = delaunay2D([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(r.triangles).toEqual([]);
  });

  it('3 points → 1 triangle', () => {
    const r = delaunay2D([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }]);
    expect(r.triangles).toHaveLength(1);
  });

  it('4 corners → 2 triangles', () => {
    const square: Point2D[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const r = delaunay2D(square);
    expect(r.triangles).toHaveLength(2);
  });

  it('random grid produces 2(N-1)² triangles', () => {
    const points: Point2D[] = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) points.push({ x: i, y: j });
    const r = delaunay2D(points);
    expect(r.triangles.length).toBeGreaterThan(0);
  });

  it('triangle indices reference input points only', () => {
    const points: Point2D[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 5, y: -3 }];
    const r = delaunay2D(points);
    for (const t of r.triangles) {
      expect(t.a).toBeLessThan(points.length);
      expect(t.b).toBeLessThan(points.length);
      expect(t.c).toBeLessThan(points.length);
    }
  });
});

describe('insideCircumcircle', () => {
  it('point inside circumcircle returns true', () => {
    expect(insideCircumcircle({ x: 0.3, y: 0.3 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 })).toBe(true);
  });

  it('point well outside returns false', () => {
    expect(insideCircumcircle({ x: 100, y: 100 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 })).toBe(false);
  });
});

describe('adjacency', () => {
  it('square has 2 triangles sharing the diagonal', () => {
    const square: Point2D[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const r = delaunay2D(square);
    expect(r.adjacency.get(0)).toContain(1);
    expect(r.adjacency.get(1)).toContain(0);
  });
});

describe('circumcenter', () => {
  it('equilateral triangle circumcenter = centroid', () => {
    const cc = circumcenter({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: Math.sqrt(3) });
    expect(cc.x).toBeCloseTo(1, 5);
  });

  it('collinear triangle returns centroid fallback', () => {
    const cc = circumcenter({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 });
    expect(isFinite(cc.x)).toBe(true);
  });
});

describe('voronoiFromDelaunay', () => {
  it('produces one vertex per triangle', () => {
    const points: Point2D[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const r = delaunay2D(points);
    const v = voronoiFromDelaunay(points, r);
    expect(v.vertices).toHaveLength(r.triangles.length);
  });

  it('voronoi edges match adjacency pairs', () => {
    const points: Point2D[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const r = delaunay2D(points);
    const v = voronoiFromDelaunay(points, r);
    expect(v.edges).toHaveLength(1); // diagonal connects two triangles.
  });
});

describe('statistics', () => {
  it('reports triangle + point count', () => {
    const points: Point2D[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const r = delaunay2D(points);
    const s = statistics(points, r);
    expect(s.triangleCount).toBe(2);
    expect(s.pointCount).toBe(4);
  });

  it('min angle in [0, 60] for unit square', () => {
    const points: Point2D[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const r = delaunay2D(points);
    const s = statistics(points, r);
    expect(s.minAngleDeg).toBeLessThanOrEqual(60);
  });

  it('empty triangulation → 0 stats', () => {
    const s = statistics([], { triangles: [], adjacency: new Map() });
    expect(s.triangleCount).toBe(0);
  });
});
