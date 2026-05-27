import { describe, it, expect } from 'vitest';
import {
  detectRestMaterial,
  filterRegions,
  computeUncutFraction,
  summarize,
  type OccupancyGrid,
  type Cell,
} from './restMachiningDetector';

function grid(cellsX: number, cellsY: number, cells: number[], pitchMm: number = 1): OccupancyGrid {
  return {
    cellsX,
    cellsY,
    pitchMm,
    origin: { x: 0, y: 0 },
    cells: cells.map(c => (c === 1 ? 1 : 0) as Cell),
  };
}

describe('detectRestMaterial', () => {
  it('all machined → no regions', () => {
    const g = grid(3, 3, [1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(detectRestMaterial(g)).toEqual([]);
  });

  it('all uncut → one big region', () => {
    const g = grid(3, 3, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const regions = detectRestMaterial(g);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.cellCount).toBe(9);
  });

  it('two disconnected pockets → 2 regions', () => {
    // x x x x x x x
    // x O x x x O x
    // x x x x x x x  ← O = uncut
    const cells = [
      1, 1, 1, 1, 1, 1, 1,
      1, 0, 1, 1, 1, 0, 1,
      1, 1, 1, 1, 1, 1, 1,
    ];
    const g = grid(7, 3, cells);
    expect(detectRestMaterial(g)).toHaveLength(2);
  });

  it('AABB reflects region extent', () => {
    const cells = [
      1, 1, 1,
      1, 0, 0,
      1, 0, 0,
    ];
    const g = grid(3, 3, cells, 1);
    const region = detectRestMaterial(g)[0]!;
    expect(region.bbox.minX).toBeCloseTo(1, 5);
    expect(region.bbox.maxX).toBeCloseTo(3, 5);
  });

  it('inscribed radius = min(width,height)/2 × pitch', () => {
    const cells = [
      0, 0, 0,
      0, 0, 0,
      0, 0, 0,
    ];
    const g = grid(3, 3, cells, 2);
    const region = detectRestMaterial(g)[0]!;
    expect(region.inscribedRadiusMm).toBeCloseTo(3, 5);
  });

  it('recommendedToolDiameter is inscribedRadius × 1.8', () => {
    const g = grid(2, 2, [0, 0, 0, 0], 1);
    const region = detectRestMaterial(g)[0]!;
    expect(region.recommendedToolDiameterMm).toBeCloseTo(region.inscribedRadiusMm * 1.8, 3);
  });

  it('areaMm2 = cellCount × pitch²', () => {
    const g = grid(2, 2, [0, 0, 0, 0], 2);
    const region = detectRestMaterial(g)[0]!;
    expect(region.areaMm2).toBe(4 * 4); // 4 cells × 4 mm²
  });
});

describe('filterRegions', () => {
  it('drops regions below threshold', () => {
    const cells = [
      1, 1, 1,
      1, 0, 1,
      1, 1, 1,
    ];
    const g = grid(3, 3, cells, 1);
    const all = detectRestMaterial(g);
    expect(all).toHaveLength(1);
    expect(filterRegions(all, 2)).toHaveLength(0);
    expect(filterRegions(all, 0.5)).toHaveLength(1);
  });
});

describe('computeUncutFraction', () => {
  it('all uncut → 1', () => {
    expect(computeUncutFraction(grid(2, 2, [0, 0, 0, 0]))).toBe(1);
  });

  it('all machined → 0', () => {
    expect(computeUncutFraction(grid(2, 2, [1, 1, 1, 1]))).toBe(0);
  });

  it('half-and-half → 0.5', () => {
    expect(computeUncutFraction(grid(2, 2, [0, 0, 1, 1]))).toBe(0.5);
  });
});

describe('summarize', () => {
  it('empty → Infinity smallest tool', () => {
    const s = summarize([]);
    expect(s.regionCount).toBe(0);
    expect(s.smallestRecommendedToolMm).toBe(Infinity);
  });

  it('reports total area + largest', () => {
    const g = grid(7, 3, [
      1, 1, 1, 1, 1, 1, 1,
      1, 0, 1, 1, 0, 0, 1,
      1, 1, 1, 1, 1, 1, 1,
    ], 1);
    const regions = detectRestMaterial(g);
    const s = summarize(regions);
    expect(s.regionCount).toBe(2);
    expect(s.largestRegionAreaMm2).toBeGreaterThanOrEqual(s.totalUncutAreaMm2 / 2);
  });
});
