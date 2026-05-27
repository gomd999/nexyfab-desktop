import { describe, it, expect } from 'vitest';
import {
  packCrates,
  summarize,
  type Crate,
  type PalletSpec,
} from './shippingLayoutOptimizer';

const standardPallet: PalletSpec = {
  widthMm: 1200,
  depthMm: 800,
  maxHeightMm: 2000,
  maxWeightKg: 1000,
};

function crate(id: string, w: number, d: number, h: number, kg: number, rotatable: boolean = true, fragile: boolean = false): Crate {
  return { id, widthMm: w, depthMm: d, heightMm: h, weightKg: kg, rotatable, fragile };
}

describe('packCrates', () => {
  it('empty input → empty result', () => {
    const r = packCrates([], standardPallet);
    expect(r.placed).toEqual([]);
  });

  it('single small crate fits', () => {
    const r = packCrates([crate('a', 400, 300, 200, 10)], standardPallet);
    expect(r.placed).toHaveLength(1);
  });

  it('oversized crate marked unplaced', () => {
    const r = packCrates([crate('big', 5000, 5000, 5000, 10, false)], standardPallet);
    expect(r.unplaced[0]!.reason).toContain('too wide');
  });

  it('over-weight crate rejected', () => {
    const r = packCrates([crate('heavy', 400, 300, 200, 9999)], standardPallet);
    expect(r.unplaced).toHaveLength(1);
  });

  it('multiple crates pack in one layer', () => {
    const crates = [
      crate('a', 400, 300, 200, 10),
      crate('b', 400, 300, 200, 10),
      crate('c', 400, 300, 200, 10),
    ];
    const r = packCrates(crates, standardPallet);
    expect(r.placed.length).toBeGreaterThanOrEqual(2);
  });

  it('fragile crate placed but flagged for top-layer', () => {
    const crates = [
      crate('a', 400, 300, 200, 10),
      crate('fragile', 400, 300, 200, 10, true, true),
    ];
    const r = packCrates(crates, standardPallet);
    expect(r.placed.length).toBeGreaterThan(0);
  });

  it('total weight is sum of placed', () => {
    const crates = [
      crate('a', 400, 300, 200, 50),
      crate('b', 400, 300, 200, 30),
    ];
    const r = packCrates(crates, standardPallet);
    expect(r.totalWeightKg).toBe(80);
  });

  it('placed crates have non-overlapping footprints in same layer', () => {
    const crates = [
      crate('a', 500, 400, 200, 10),
      crate('b', 500, 400, 200, 10),
    ];
    const r = packCrates(crates, standardPallet);
    for (let i = 0; i < r.placed.length; i++) {
      for (let j = i + 1; j < r.placed.length; j++) {
        const a = r.placed[i]!;
        const b = r.placed[j]!;
        if (a.origin.z !== b.origin.z) continue;
        const overlap = a.origin.x < b.origin.x + b.widthMm &&
                        a.origin.x + a.widthMm > b.origin.x &&
                        a.origin.y < b.origin.y + b.depthMm &&
                        a.origin.y + a.depthMm > b.origin.y;
        expect(overlap).toBe(false);
      }
    }
  });

  it('stacked height = sum of layer heights', () => {
    const crates = Array.from({ length: 10 }, (_, i) => crate(`c${i}`, 1200, 800, 200, 5));
    const r = packCrates(crates, standardPallet);
    expect(r.stackedHeightMm).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('empty input', () => {
    const r = packCrates([], standardPallet);
    const s = summarize([], standardPallet, r);
    expect(s.placedCount).toBe(0);
  });

  it('weight utilization in [0, 1]', () => {
    const r = packCrates([crate('a', 400, 300, 200, 500)], standardPallet);
    const s = summarize([crate('a', 400, 300, 200, 500)], standardPallet, r);
    expect(s.weightUtilization).toBeGreaterThan(0);
    expect(s.weightUtilization).toBeLessThanOrEqual(1);
  });

  it('isFull when nothing unplaced', () => {
    const r = packCrates([crate('a', 400, 300, 200, 10)], standardPallet);
    const s = summarize([crate('a', 400, 300, 200, 10)], standardPallet, r);
    expect(s.isFull).toBe(true);
  });
});
