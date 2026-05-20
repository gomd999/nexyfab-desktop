import { describe, it, expect } from 'vitest';
import {
  triangulate,
  signedArea,
  isCounterClockwise,
  summarize,
  type Point2D,
  type PolygonWithHoles,
} from './earClippingTriangulation';

function square(size: number): Point2D[] {
  return [
    { x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size },
  ];
}

function hole(size: number, offset: number): Point2D[] {
  return [
    { x: offset, y: offset },
    { x: offset, y: offset + size },
    { x: offset + size, y: offset + size },
    { x: offset + size, y: offset },
  ];
}

describe('signedArea + isCounterClockwise', () => {
  it('CCW square has positive signed area', () => {
    expect(signedArea(square(5))).toBeGreaterThan(0);
    expect(isCounterClockwise(square(5))).toBe(true);
  });

  it('CW polygon has negative signed area', () => {
    expect(isCounterClockwise(square(5).reverse())).toBe(false);
  });
});

describe('triangulate — simple polygon', () => {
  it('square produces 2 triangles', () => {
    const r = triangulate({ outer: square(10), holes: [] });
    expect(r.triangles).toHaveLength(2);
  });

  it('< 3 vertices → warning + empty result', () => {
    const r = triangulate({ outer: [{ x: 0, y: 0 }, { x: 1, y: 1 }], holes: [] });
    expect(r.triangles).toHaveLength(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('concave polygon (L-shape) triangulates', () => {
    const L: Point2D[] = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 },
      { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 },
    ];
    const r = triangulate({ outer: L, holes: [] });
    expect(r.triangles.length).toBeGreaterThanOrEqual(4);
  });

  it('all triangle indices reference valid points', () => {
    const r = triangulate({ outer: square(10), holes: [] });
    for (const t of r.triangles) {
      expect(t.a).toBeLessThan(r.points.length);
      expect(t.b).toBeLessThan(r.points.length);
      expect(t.c).toBeLessThan(r.points.length);
    }
  });
});

describe('triangulate — orientation', () => {
  it('CCW input preserved', () => {
    const r = triangulate({ outer: square(10), holes: [] });
    expect(r.triangles.length).toBe(2);
  });

  it('CW input flipped to CCW', () => {
    const r = triangulate({ outer: square(10).reverse(), holes: [] });
    expect(r.triangles.length).toBe(2);
  });
});

describe('triangulate — with holes', () => {
  it('square with one hole produces > 2 triangles', () => {
    const poly: PolygonWithHoles = {
      outer: square(10),
      holes: [hole(3, 3)],
    };
    const r = triangulate(poly);
    expect(r.triangles.length).toBeGreaterThan(2);
  });

  it('points include outer + hole vertices', () => {
    const poly: PolygonWithHoles = {
      outer: square(10),
      holes: [hole(3, 3)],
    };
    const r = triangulate(poly);
    expect(r.points.length).toBeGreaterThanOrEqual(8);
  });

  it('multiple holes', () => {
    const poly: PolygonWithHoles = {
      outer: square(20),
      holes: [hole(2, 2), hole(2, 12)],
    };
    const r = triangulate(poly);
    expect(r.triangles.length).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports outer + hole area', () => {
    const poly: PolygonWithHoles = {
      outer: square(10), holes: [hole(3, 3)],
    };
    const r = triangulate(poly);
    const s = summarize(poly, r);
    expect(s.outerArea).toBeCloseTo(100, 5);
    expect(s.holeArea).toBeCloseTo(9, 5);
    expect(s.netArea).toBeCloseTo(91, 5);
  });

  it('reports point + triangle count', () => {
    const poly: PolygonWithHoles = { outer: square(10), holes: [] };
    const r = triangulate(poly);
    const s = summarize(poly, r);
    expect(s.pointCount).toBe(4);
    expect(s.triangleCount).toBe(2);
  });
});
