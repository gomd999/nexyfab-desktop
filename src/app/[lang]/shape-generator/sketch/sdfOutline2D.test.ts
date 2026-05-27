import { describe, it, expect } from 'vitest';
import {
  signedDistanceToPolygon,
  signedDistanceToPolygonWithHoles,
  pointInPolygon,
  sampleSdfGrid,
  sampleGridAt,
  unionGrids2D,
  intersectGrids2D,
  subtractGrids2D,
  extractIsoline,
  isContainedIn,
  gridStats,
  type Point2D,
} from './sdfOutline2D';

function square(size: number): Point2D[] {
  return [
    { x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size },
  ];
}

describe('signedDistanceToPolygon', () => {
  it('center of square has negative SDF (inside)', () => {
    expect(signedDistanceToPolygon({ x: 5, y: 5 }, square(10))).toBeLessThan(0);
  });

  it('point outside has positive SDF', () => {
    expect(signedDistanceToPolygon({ x: 20, y: 5 }, square(10))).toBeGreaterThan(0);
  });

  it('distance equals nearest edge distance', () => {
    const d = signedDistanceToPolygon({ x: 15, y: 5 }, square(10));
    expect(Math.abs(d)).toBeCloseTo(5, 5);
  });

  it('< 3 points → infinity', () => {
    expect(signedDistanceToPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(Infinity);
  });
});

describe('signedDistanceToPolygonWithHoles', () => {
  it('inside hole returns positive (carved out)', () => {
    const poly = {
      outer: square(10),
      holes: [[
        { x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 3, y: 7 },
      ]],
    };
    const d = signedDistanceToPolygonWithHoles({ x: 5, y: 5 }, poly);
    expect(d).toBeGreaterThan(0);
  });

  it('outside hole, inside outer → negative', () => {
    const poly = {
      outer: square(10),
      holes: [[
        { x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 3, y: 7 },
      ]],
    };
    const d = signedDistanceToPolygonWithHoles({ x: 1, y: 1 }, poly);
    expect(d).toBeLessThan(0);
  });
});

describe('pointInPolygon', () => {
  it('square center', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square(10))).toBe(true);
  });

  it('outside', () => {
    expect(pointInPolygon({ x: 20, y: 5 }, square(10))).toBe(false);
  });
});

describe('sampleSdfGrid', () => {
  it('grid covers requested size', () => {
    const grid = sampleSdfGrid({ outer: square(10), holes: [] }, { x: 0, y: 0 }, { width: 10, height: 10 }, 1);
    expect(grid.nx).toBeGreaterThanOrEqual(10);
    expect(grid.values.length).toBe(grid.nx * grid.ny);
  });

  it('grid has negative interior values', () => {
    const grid = sampleSdfGrid({ outer: square(10), holes: [] }, { x: 0, y: 0 }, { width: 10, height: 10 }, 1);
    // Center cell should be negative.
    const mid = grid.values[Math.floor(grid.ny / 2) * grid.nx + Math.floor(grid.nx / 2)];
    expect(mid).toBeLessThan(0);
  });
});

describe('sampleGridAt', () => {
  it('bilinear interpolates', () => {
    const grid = sampleSdfGrid({ outer: square(10), holes: [] }, { x: 0, y: 0 }, { width: 10, height: 10 }, 1);
    const v = sampleGridAt(grid, { x: 5, y: 5 });
    expect(v).toBeLessThan(0);
  });
});

describe('grid boolean ops', () => {
  it('union takes min', () => {
    const a = sampleSdfGrid({ outer: square(10), holes: [] }, { x: 0, y: 0 }, { width: 10, height: 10 }, 1);
    const b = sampleSdfGrid({ outer: square(5), holes: [] }, { x: 0, y: 0 }, { width: 10, height: 10 }, 1);
    const before = a.values[0]!;
    const beforeB = b.values[0]!;
    unionGrids2D(a, b);
    expect(a.values[0]).toBe(Math.min(before, beforeB));
  });

  it('intersect takes max', () => {
    const a = sampleSdfGrid({ outer: square(10), holes: [] }, { x: 0, y: 0 }, { width: 10, height: 10 }, 1);
    const b = sampleSdfGrid({ outer: square(5), holes: [] }, { x: 0, y: 0 }, { width: 10, height: 10 }, 1);
    const before = a.values[0]!;
    const beforeB = b.values[0]!;
    intersectGrids2D(a, b);
    expect(a.values[0]).toBe(Math.max(before, beforeB));
  });

  it('subtract carves out shape B from A', () => {
    const a = sampleSdfGrid({ outer: square(10), holes: [] }, { x: 0, y: 0 }, { width: 10, height: 10 }, 1);
    const b = sampleSdfGrid({ outer: square(5), holes: [] }, { x: 0, y: 0 }, { width: 10, height: 10 }, 1);
    subtractGrids2D(a, b);
    // Where B was inside, a should now be positive.
    expect(sampleGridAt(a, { x: 2, y: 2 })).toBeGreaterThan(0);
  });
});

describe('extractIsoline', () => {
  it('square outline → ≥ 4 segments', () => {
    const grid = sampleSdfGrid({ outer: square(10), holes: [] }, { x: -2, y: -2 }, { width: 14, height: 14 }, 0.5);
    const segments = extractIsoline(grid, 0);
    expect(segments.length).toBeGreaterThanOrEqual(4);
  });

  it('all-outside grid → no segments', () => {
    const grid = sampleSdfGrid({ outer: square(1), holes: [] }, { x: 100, y: 100 }, { width: 5, height: 5 }, 1);
    expect(extractIsoline(grid, 0)).toHaveLength(0);
  });
});

describe('isContainedIn', () => {
  it('small square inside larger', () => {
    expect(isContainedIn(square(3).map(p => ({ x: p.x + 2, y: p.y + 2 })), square(10))).toBe(true);
  });

  it('overlapping squares → not contained', () => {
    expect(isContainedIn(square(20), square(10))).toBe(false);
  });
});

describe('gridStats', () => {
  it('reports min/max + area estimate', () => {
    const grid = sampleSdfGrid({ outer: square(10), holes: [] }, { x: 0, y: 0 }, { width: 10, height: 10 }, 1);
    const stats = gridStats(grid);
    expect(stats.minPhi).toBeLessThan(0);
    expect(stats.maxPhi).toBeGreaterThanOrEqual(0);
    expect(stats.areaMm2).toBeGreaterThan(0);
  });
});
