import { describe, it, expect } from 'vitest';
import {
  offsetPolygon,
  offsetIncremental,
  isCounterClockwise,
  polygonArea,
  polygonPerimeter,
  hasSelfIntersection,
  compareBeforeAfter,
  type Point2D,
} from './polygonOffset2D';

function square(size: number): Point2D[] {
  return [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ];
}

describe('offsetPolygon — outset', () => {
  it('positive offset expands square area', () => {
    const before = square(10);
    const after = offsetPolygon(before, { distance: 1, join: 'miter' });
    expect(polygonArea(after)).toBeGreaterThan(polygonArea(before));
  });

  it('output has same vertex count for square + miter', () => {
    const after = offsetPolygon(square(10), { distance: 1, join: 'miter' });
    expect(after.length).toBe(4);
  });

  it('round join adds arc vertices at corners', () => {
    const after = offsetPolygon(square(10), { distance: 1, join: 'round', arcDivisions: 4 });
    expect(after.length).toBeGreaterThan(4);
  });

  it('bevel adds 1 extra vertex per corner', () => {
    const after = offsetPolygon(square(10), { distance: 1, join: 'bevel' });
    // 4 corners × 2 points each = 8.
    expect(after.length).toBe(8);
  });
});

describe('offsetPolygon — inset', () => {
  it('negative offset shrinks square area', () => {
    const before = square(10);
    const after = offsetPolygon(before, { distance: -1, join: 'miter' });
    expect(polygonArea(after)).toBeLessThan(polygonArea(before));
  });
});

describe('offsetPolygon — edge cases', () => {
  it('polygon with < 3 vertices → empty', () => {
    expect(offsetPolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([]);
  });

  it('miter limit triggers bevel for tight corners', () => {
    const tightCorner: Point2D[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 11, y: 5 },
      { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const after = offsetPolygon(tightCorner, { distance: 1, join: 'miter', miterLimit: 0.5 });
    // With tight miter limit, bevel fallback adds extra vertices.
    expect(after.length).toBeGreaterThan(tightCorner.length);
  });
});

describe('offsetIncremental', () => {
  it('large distance via steps gives similar area to direct offset', () => {
    const before = square(10);
    const direct = offsetPolygon(before, { distance: 2, join: 'miter' });
    const inc = offsetIncremental(before, 2, 5, { join: 'miter' });
    expect(polygonArea(inc)).toBeCloseTo(polygonArea(direct), 0);
  });
});

describe('isCounterClockwise', () => {
  it('CCW square detected', () => {
    expect(isCounterClockwise(square(10))).toBe(true);
  });

  it('CW square detected', () => {
    expect(isCounterClockwise(square(10).reverse())).toBe(false);
  });
});

describe('polygonArea + polygonPerimeter', () => {
  it('square area = side²', () => {
    expect(polygonArea(square(5))).toBe(25);
  });

  it('square perimeter = 4·side', () => {
    expect(polygonPerimeter(square(5))).toBe(20);
  });

  it('orientation does not change area', () => {
    expect(polygonArea(square(5))).toBe(polygonArea(square(5).reverse()));
  });
});

describe('hasSelfIntersection', () => {
  it('square does not self-intersect', () => {
    expect(hasSelfIntersection(square(10))).toBe(false);
  });

  it('bowtie polygon self-intersects', () => {
    const bowtie: Point2D[] = [
      { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 },
    ];
    expect(hasSelfIntersection(bowtie)).toBe(true);
  });
});

describe('compareBeforeAfter', () => {
  it('reports area + perimeter shifts', () => {
    const before = square(10);
    const after = offsetPolygon(before, { distance: 1, join: 'miter' });
    const stats = compareBeforeAfter(before, after);
    expect(stats.outputArea).toBeGreaterThan(stats.inputArea);
    expect(stats.outputPerimeter).toBeGreaterThan(stats.inputPerimeter);
  });
});
