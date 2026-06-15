import { describe, it, expect } from 'vitest';
import {
  generateCutList,
  packFirstFitDecreasing,
  summarize,
  type StructuralMember,
} from './cutListReport';

function mkMember(id: string, profile: string, length: number, material: string = 'A36', density: number = 5): StructuralMember {
  return { id, profile, material, lengthMm: length, linearDensityKgPerM: density };
}

describe('generateCutList', () => {
  it('empty input → empty result', () => {
    const r = generateCutList([]);
    expect(r.entries).toEqual([]);
    expect(r.totalMassKg).toBe(0);
  });

  it('groups identical members', () => {
    const r = generateCutList([
      mkMember('m1', 'HSS 50x50x3', 1000),
      mkMember('m2', 'HSS 50x50x3', 1000),
      mkMember('m3', 'HSS 50x50x3', 1000),
    ]);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.quantity).toBe(3);
  });

  it('different profiles → different entries', () => {
    const r = generateCutList([
      mkMember('m1', 'HSS 50x50x3', 1000),
      mkMember('m2', 'HSS 75x75x3', 1000),
    ]);
    expect(r.entries).toHaveLength(2);
  });

  it('different materials → different entries', () => {
    const r = generateCutList([
      mkMember('m1', 'HSS 50x50x3', 1000, 'A36'),
      mkMember('m2', 'HSS 50x50x3', 1000, 'S275'),
    ]);
    expect(r.entries).toHaveLength(2);
  });

  it('length tolerance groups near-equal lengths', () => {
    const r = generateCutList(
      [mkMember('m1', 'HSS 50x50x3', 1000), mkMember('m2', 'HSS 50x50x3', 1000.5)],
      { lengthGroupingToleranceMm: 2.0 },
    );
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.quantity).toBe(2);
  });

  it('total mass scales with length and density', () => {
    const r = generateCutList([mkMember('m1', 'HSS 50x50x3', 1000, 'A36', 5)]);
    expect(r.totalMassKg).toBeCloseTo(5, 5);
  });

  it('rawLengthMm sums all members', () => {
    const r = generateCutList([
      mkMember('m1', 'HSS', 1000),
      mkMember('m2', 'HSS', 500),
    ]);
    expect(r.rawLengthMm).toBe(1500);
  });

  it('entries sorted by profile then length desc', () => {
    const r = generateCutList([
      mkMember('m1', 'HSS A', 500),
      mkMember('m2', 'HSS A', 1000),
    ]);
    expect(r.entries[0]!.lengthMm).toBeGreaterThanOrEqual(r.entries[1]!.lengthMm);
  });

  it('records member ids', () => {
    const r = generateCutList([
      mkMember('m1', 'HSS', 1000),
      mkMember('m2', 'HSS', 1000),
    ]);
    expect(r.entries[0]!.memberIds.sort()).toEqual(['m1', 'm2']);
  });

  it('captures end miters', () => {
    const r = generateCutList([
      { id: 'm1', profile: 'HSS', material: 'A36', lengthMm: 1000, linearDensityKgPerM: 5, endMiterDeg: { start: 45, end: 90 } },
    ]);
    expect(r.entries[0]!.endMiters.sort((a, b) => a - b)).toEqual([45, 90]);
  });

  it('runs bin packing when stock length provided', () => {
    const r = generateCutList(
      [mkMember('m1', 'HSS', 4000), mkMember('m2', 'HSS', 4000), mkMember('m3', 'HSS', 4000)],
      { stockLengthMm: 6000, kerfMm: 0 },
    );
    expect(r.binPacks).toBeDefined();
    expect(r.binPacks!.size).toBe(1);
    const pack = [...r.binPacks!.values()][0]!;
    expect(pack.stockPiecesUsed).toBe(3);
  });
});

describe('packFirstFitDecreasing', () => {
  it('empty input → 0 stock pieces', () => {
    const r = packFirstFitDecreasing([], 6000, 0);
    expect(r.stockPiecesUsed).toBe(0);
    expect(r.bins).toEqual([]);
  });

  it('one length fits in one bin', () => {
    const r = packFirstFitDecreasing([3000], 6000, 0);
    expect(r.stockPiecesUsed).toBe(1);
  });

  it('two equal lengths fit in same bin if room', () => {
    const r = packFirstFitDecreasing([2000, 2000], 6000, 0);
    expect(r.stockPiecesUsed).toBe(1);
    expect(r.bins[0]).toEqual([2000, 2000]);
  });

  it('three pieces requiring more than one stock', () => {
    const r = packFirstFitDecreasing([4000, 4000, 4000], 6000, 0);
    expect(r.stockPiecesUsed).toBe(3);
  });

  it('kerf reduces effective length', () => {
    // Without kerf: two 3000 fit in 6000. With kerf 100, two 3000 + 2 kerfs = 6200 > 6000, need 2 bins.
    const r = packFirstFitDecreasing([3000, 3000], 6000, 100);
    expect(r.stockPiecesUsed).toBe(2);
  });

  it('reports waste correctly', () => {
    const r = packFirstFitDecreasing([4000], 6000, 0);
    expect(r.wasteMm).toBe(2000);
  });
});

describe('summarize', () => {
  it('zero pieces from empty', () => {
    const s = summarize({ entries: [], totalMassKg: 0, rawLengthMm: 0 });
    expect(s.totalPieces).toBe(0);
    expect(s.uniqueProfileCount).toBe(0);
  });

  it('counts unique profiles and materials', () => {
    const r = generateCutList([
      mkMember('m1', 'HSS A', 1000, 'A36'),
      mkMember('m2', 'HSS B', 1000, 'A36'),
      mkMember('m3', 'HSS B', 1000, 'S275'),
    ]);
    const s = summarize(r);
    expect(s.uniqueProfileCount).toBe(2);
    expect(s.uniqueMaterialCount).toBe(2);
  });

  it('totalPieces equals sum of quantities', () => {
    const r = generateCutList([
      mkMember('m1', 'HSS', 1000),
      mkMember('m2', 'HSS', 1000),
      mkMember('m3', 'HSS', 1000),
    ]);
    expect(summarize(r).totalPieces).toBe(3);
  });

  it('average utilization reported when bin packs present', () => {
    const r = generateCutList(
      [mkMember('m1', 'HSS', 3000), mkMember('m2', 'HSS', 3000)],
      { stockLengthMm: 6000, kerfMm: 0 },
    );
    const s = summarize(r);
    expect(s.averageUtilization).toBeGreaterThan(0.9);
  });
});
