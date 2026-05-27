import { describe, it, expect } from 'vitest';
import {
  simulateToolpath,
  buildStockMask,
  summarizeResidualStock,
  computeMRR,
  compareToTarget,
  type ToolpathMove,
  type StockBlock,
} from './toolpathSimulator';

const smallStock: StockBlock = {
  min: [0, 0, 0],
  max: [10, 10, 5],
  voxelSizeMm: 1,
};

describe('buildStockMask', () => {
  it('all voxels start as 1 (full material)', () => {
    const { mask, dims } = buildStockMask(smallStock);
    expect(dims).toEqual({ nx: 10, ny: 10, nz: 5 });
    expect(mask.length).toBe(500);
    expect(mask.every(v => v === 1)).toBe(true);
  });
});

describe('simulateToolpath', () => {
  it('rapid moves do not remove material', () => {
    const moves: ToolpathMove[] = [
      { kind: 'rapid', start: [2, 2, 5], end: [8, 8, 5], tool: { kind: 'flat', radiusMm: 1 } },
    ];
    const r = simulateToolpath(smallStock, moves);
    expect(r.volumeRemovedMm3).toBe(0);
    expect(r.rapidDistanceMm).toBeGreaterThan(0);
  });

  it('cut move removes voxels along the path', () => {
    const moves: ToolpathMove[] = [
      { kind: 'cut', start: [2, 5, 2], end: [8, 5, 2], tool: { kind: 'flat', radiusMm: 1 } },
    ];
    const r = simulateToolpath(smallStock, moves);
    expect(r.volumeRemovedMm3).toBeGreaterThan(0);
  });

  it('larger tool removes more material', () => {
    const small: ToolpathMove[] = [
      { kind: 'cut', start: [2, 5, 2], end: [8, 5, 2], tool: { kind: 'flat', radiusMm: 0.5 } },
    ];
    const big: ToolpathMove[] = [
      { kind: 'cut', start: [2, 5, 2], end: [8, 5, 2], tool: { kind: 'flat', radiusMm: 2 } },
    ];
    expect(simulateToolpath(smallStock, big).volumeRemovedMm3).toBeGreaterThan(
      simulateToolpath(smallStock, small).volumeRemovedMm3,
    );
  });

  it('cuttingDistance reported', () => {
    const moves: ToolpathMove[] = [
      { kind: 'cut', start: [0, 0, 0], end: [10, 0, 0], tool: { kind: 'flat', radiusMm: 1 } },
    ];
    expect(simulateToolpath(smallStock, moves).cuttingDistanceMm).toBeCloseTo(10, 5);
  });

  it('feedRate populates estimatedTimeSec', () => {
    const moves: ToolpathMove[] = [
      { kind: 'cut', start: [0, 0, 0], end: [10, 0, 0], tool: { kind: 'flat', radiusMm: 1 }, feedRateMmPerMin: 100 },
    ];
    const r = simulateToolpath(smallStock, moves);
    expect(r.estimatedTimeSec).toBeCloseTo(6, 1); // 10mm / 100mm/min × 60s
  });

  it('empty toolpath → empty result', () => {
    const r = simulateToolpath(smallStock, []);
    expect(r.volumeRemovedMm3).toBe(0);
    expect(r.cuttingDistanceMm).toBe(0);
  });

  it('ball tool digs into voxels below tip', () => {
    const moves: ToolpathMove[] = [
      { kind: 'cut', start: [5, 5, 3], end: [5, 5, 3], tool: { kind: 'ball', radiusMm: 2 } },
    ];
    const r = simulateToolpath(smallStock, moves);
    expect(r.volumeRemovedMm3).toBeGreaterThan(0);
  });
});

describe('summarizeResidualStock', () => {
  it('initial stock is fully present', () => {
    const r = simulateToolpath(smallStock, []);
    const s = summarizeResidualStock(r, smallStock);
    expect(s.remainingFraction).toBe(1);
  });

  it('after material removal, fraction < 1', () => {
    const moves: ToolpathMove[] = [
      { kind: 'cut', start: [2, 5, 2], end: [8, 5, 2], tool: { kind: 'flat', radiusMm: 1 } },
    ];
    const r = simulateToolpath(smallStock, moves);
    const s = summarizeResidualStock(r, smallStock);
    expect(s.remainingFraction).toBeLessThan(1);
  });
});

describe('computeMRR', () => {
  it('zero time → zero MRR', () => {
    const r = computeMRR({
      voxels: new Uint8Array(0),
      dimensions: { nx: 0, ny: 0, nz: 0 },
      volumeRemovedMm3: 100,
      cuttingDistanceMm: 0,
      rapidDistanceMm: 0,
      estimatedTimeSec: 0,
    });
    expect(r.mrrMm3PerMin).toBe(0);
  });

  it('with cuts + time → positive MRR', () => {
    const r = computeMRR({
      voxels: new Uint8Array(0),
      dimensions: { nx: 0, ny: 0, nz: 0 },
      volumeRemovedMm3: 100,
      cuttingDistanceMm: 50,
      rapidDistanceMm: 50,
      estimatedTimeSec: 60,
    });
    expect(r.mrrMm3PerMin).toBeCloseTo(100, 5);
    expect(r.cuttingFraction).toBeCloseTo(0.5, 5);
  });
});

describe('compareToTarget', () => {
  it('exact match → 100% accuracy', () => {
    const sim = new Uint8Array([1, 1, 0, 0]);
    const tgt = new Uint8Array([1, 1, 0, 0]);
    const r = compareToTarget(sim, tgt);
    expect(r.accuracyFraction).toBe(1);
    expect(r.gougedVoxels).toBe(0);
  });

  it('gouged voxels reported', () => {
    const sim = new Uint8Array([0, 0, 0, 0]); // everything removed
    const tgt = new Uint8Array([1, 1, 0, 0]); // 2 should be part
    const r = compareToTarget(sim, tgt);
    expect(r.gougedVoxels).toBe(2);
  });

  it('under-machined voxels reported', () => {
    const sim = new Uint8Array([1, 1, 1, 1]); // nothing removed
    const tgt = new Uint8Array([1, 1, 0, 0]); // 2 should be removed
    const r = compareToTarget(sim, tgt);
    expect(r.underMachinedVoxels).toBe(2);
  });

  it('length mismatch throws', () => {
    expect(() => compareToTarget(new Uint8Array(2), new Uint8Array(4))).toThrow();
  });
});
