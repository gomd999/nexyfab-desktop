import { describe, it, expect } from 'vitest';
import {
  computeRemainder,
  findRemainderRegions,
  residualRoughnessEstimate,
  summarize,
  type HeightField,
  type Operation,
} from './stockSurfaceRemainder';

function flatField(cellsX: number, cellsY: number, h: number, pitch: number = 1): HeightField {
  return { cellsX, cellsY, pitchMm: pitch, heights: new Array(cellsX * cellsY).fill(h) };
}

describe('computeRemainder', () => {
  it('no operations → remainder = initial', () => {
    const r = computeRemainder(flatField(5, 5, 2), []);
    expect(r.maxResidualMm).toBeCloseTo(2, 3);
  });

  it('operation removes material', () => {
    const initial = flatField(3, 3, 5);
    const op: Operation = { id: 'op1', resultingHeights: flatField(3, 3, 1) };
    const r = computeRemainder(initial, [op]);
    expect(r.maxResidualMm).toBe(1);
  });

  it('multiple ops → min height wins', () => {
    const initial = flatField(2, 2, 10);
    const ops: Operation[] = [
      { id: 'op1', resultingHeights: flatField(2, 2, 5) },
      { id: 'op2', resultingHeights: flatField(2, 2, 2) },
    ];
    const r = computeRemainder(initial, ops);
    expect(r.maxResidualMm).toBe(2);
  });

  it('noiseFloor suppresses tiny residue', () => {
    const initial: HeightField = { cellsX: 1, cellsY: 1, pitchMm: 1, heights: [0.0005] };
    const r = computeRemainder(initial, [], { noiseFloorMm: 0.001 });
    expect(r.significantCellCount).toBe(0);
  });

  it('mask filters cells', () => {
    const initial = flatField(2, 2, 1);
    const r = computeRemainder(initial, [], { noiseFloorMm: 0.001, mask: [true, false, false, false] });
    expect(r.significantCellCount).toBe(1);
  });

  it('total residual volume = sum(h × pitch²)', () => {
    const initial = flatField(2, 2, 1, 2);
    const r = computeRemainder(initial, []);
    expect(r.totalResidualMm3).toBeCloseTo(4 * 4, 3);
  });

  it('mismatched op size silently skipped', () => {
    const initial = flatField(3, 3, 5);
    const op: Operation = { id: 'bad', resultingHeights: flatField(2, 2, 0) };
    const r = computeRemainder(initial, [op]);
    expect(r.maxResidualMm).toBe(5);
  });
});

describe('findRemainderRegions', () => {
  it('uniform residue → one region', () => {
    const initial = flatField(3, 3, 1);
    const r = computeRemainder(initial, []);
    const regions = findRemainderRegions(r, initial, 0.5);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.cellIndices.length).toBe(9);
  });

  it('separated regions detected', () => {
    const initial: HeightField = {
      cellsX: 5, cellsY: 1, pitchMm: 1,
      heights: [1, 0, 0, 0, 1],
    };
    const r = computeRemainder(initial, []);
    const regions = findRemainderRegions(r, initial, 0.5);
    expect(regions).toHaveLength(2);
  });

  it('recommendedToolDia ≈ half min(width, height)', () => {
    const initial: HeightField = {
      cellsX: 4, cellsY: 1, pitchMm: 1,
      heights: [1, 1, 1, 1],
    };
    const r = computeRemainder(initial, []);
    const regions = findRemainderRegions(r, initial, 0.5);
    expect(regions[0]!.recommendedToolDiaMm).toBeCloseTo(0.5, 2);
  });
});

describe('residualRoughnessEstimate', () => {
  it('RMS of zero field = 0', () => {
    const initial = flatField(2, 2, 0);
    const r = computeRemainder(initial, []);
    expect(residualRoughnessEstimate(r)).toBe(0);
  });

  it('uniform height = h', () => {
    const initial = flatField(2, 2, 3);
    const r = computeRemainder(initial, []);
    expect(residualRoughnessEstimate(r)).toBeCloseTo(3, 3);
  });
});

describe('summarize', () => {
  it('reports counts + averages', () => {
    const initial = flatField(2, 2, 2);
    const r = computeRemainder(initial, []);
    const s = summarize(r);
    expect(s.maxResidualMm).toBe(2);
    expect(s.averageResidualMm).toBeCloseTo(2, 3);
  });
});
