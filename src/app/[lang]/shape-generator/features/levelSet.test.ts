import { describe, it, expect } from 'vitest';
import {
  createGrid,
  sampleFromSdf,
  reinitialise,
  advect,
  unionGrids,
  intersectGrids,
  subtractGrids,
  computeStats,
  gridSample,
} from './levelSet';

describe('createGrid', () => {
  it('allocates correct number of cells', () => {
    const g = createGrid(4, 5, 6, 1);
    expect(g.values.length).toBe(120);
  });

  it('default origin = (0,0,0)', () => {
    const g = createGrid(2, 2, 2, 1);
    expect(g.origin).toEqual([0, 0, 0]);
  });
});

describe('sampleFromSdf', () => {
  it('sphere SDF fills grid', () => {
    const g = createGrid(8, 8, 8, 1);
    sampleFromSdf(g, (x, y, z) => Math.hypot(x - 4, y - 4, z - 4) - 2);
    // Center should be negative (inside sphere).
    expect(gridSample(g, 4, 4, 4)).toBeLessThan(0);
  });

  it('corner outside sphere is positive', () => {
    const g = createGrid(8, 8, 8, 1);
    sampleFromSdf(g, (x, y, z) => Math.hypot(x - 4, y - 4, z - 4) - 2);
    expect(gridSample(g, 0, 0, 0)).toBeGreaterThan(0);
  });
});

describe('reinitialise', () => {
  it('runs without throwing on a sphere grid', () => {
    const g = createGrid(8, 8, 8, 1);
    sampleFromSdf(g, (x, y, z) => Math.hypot(x - 4, y - 4, z - 4) - 2);
    expect(() => reinitialise(g, 1)).not.toThrow();
  });
});

describe('advect', () => {
  it('zero velocity preserves field', () => {
    const g = createGrid(4, 4, 4, 1);
    sampleFromSdf(g, () => 0.5);
    const before = Array.from(g.values);
    advect(g, () => [0, 0, 0], 0.1);
    expect(Array.from(g.values)).toEqual(before);
  });

  it('uniform x-velocity shifts the field', () => {
    const g = createGrid(8, 1, 1, 1);
    for (let i = 0; i < 8; i++) g.values[i] = i;
    advect(g, () => [1, 0, 0], 1);
    // Each cell takes its previous neighbour value.
    expect(g.values[2]).toBeCloseTo(1, 5);
  });
});

describe('boolean ops on grids', () => {
  it('unionGrids = min', () => {
    const a = createGrid(2, 1, 1, 1);
    const b = createGrid(2, 1, 1, 1);
    a.values[0] = -1; a.values[1] = 2;
    b.values[0] = 0; b.values[1] = -3;
    unionGrids(a, b);
    expect(a.values[0]).toBe(-1);
    expect(a.values[1]).toBe(-3);
  });

  it('intersectGrids = max', () => {
    const a = createGrid(2, 1, 1, 1);
    const b = createGrid(2, 1, 1, 1);
    a.values[0] = -1; a.values[1] = 2;
    b.values[0] = 0; b.values[1] = -3;
    intersectGrids(a, b);
    expect(a.values[0]).toBe(0);
    expect(a.values[1]).toBe(2);
  });

  it('subtractGrids: max(a, -b)', () => {
    const a = createGrid(1, 1, 1, 1);
    const b = createGrid(1, 1, 1, 1);
    a.values[0] = -1; b.values[0] = -2;
    subtractGrids(a, b);
    expect(a.values[0]).toBe(2); // max(-1, 2)
  });
});

describe('computeStats', () => {
  it('sphere stats', () => {
    const g = createGrid(8, 8, 8, 1);
    sampleFromSdf(g, (x, y, z) => Math.hypot(x - 4, y - 4, z - 4) - 2);
    const stats = computeStats(g);
    expect(stats.minPhi).toBeLessThan(0);
    expect(stats.maxPhi).toBeGreaterThan(0);
    expect(stats.approxVolumeMm3).toBeGreaterThan(0);
  });

  it('narrow band reports cells near surface', () => {
    const g = createGrid(8, 8, 8, 1);
    sampleFromSdf(g, (x, y, z) => Math.hypot(x - 4, y - 4, z - 4) - 2);
    expect(computeStats(g).narrowBandCount).toBeGreaterThan(0);
  });
});
