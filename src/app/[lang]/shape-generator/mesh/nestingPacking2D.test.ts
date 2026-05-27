import { describe, it, expect } from 'vitest';
import {
  nestParts,
  summarize,
  type Part2D,
  type Sheet,
} from './nestingPacking2D';

const sheet: Sheet = { widthMm: 100, heightMm: 100, marginMm: 0 };

describe('nestParts — basic', () => {
  it('empty parts → no placements', () => {
    const r = nestParts([], sheet);
    expect(r.placements).toHaveLength(0);
    expect(r.sheets).toHaveLength(0);
  });

  it('one part fits on a single sheet', () => {
    const parts: Part2D[] = [{ id: 'A', widthMm: 30, heightMm: 30, quantity: 1 }];
    const r = nestParts(parts, sheet);
    expect(r.placements).toHaveLength(1);
    expect(r.sheets).toHaveLength(1);
  });

  it('multiple parts pack onto one sheet', () => {
    const parts: Part2D[] = [{ id: 'A', widthMm: 30, heightMm: 30, quantity: 4 }];
    const r = nestParts(parts, sheet);
    expect(r.placements.length).toBe(4);
  });

  it('parts too large fall through to unplaced', () => {
    const parts: Part2D[] = [{ id: 'big', widthMm: 200, heightMm: 50, quantity: 1 }];
    const r = nestParts(parts, sheet);
    expect(r.unplaced).toHaveLength(1);
    expect(r.unplaced[0]!.partId).toBe('big');
  });

  it('rotation allows tall part on wide sheet', () => {
    const wideSheet: Sheet = { widthMm: 100, heightMm: 30 };
    const parts: Part2D[] = [{ id: 'A', widthMm: 25, heightMm: 80, quantity: 1, allowRotation: true }];
    const r = nestParts(parts, wideSheet);
    expect(r.placements).toHaveLength(1);
    expect(r.placements[0]!.rotated).toBe(true);
  });

  it('disabled rotation leaves oversized parts unplaced', () => {
    const wideSheet: Sheet = { widthMm: 100, heightMm: 30 };
    const parts: Part2D[] = [{ id: 'A', widthMm: 25, heightMm: 80, quantity: 1, allowRotation: false }];
    const r = nestParts(parts, wideSheet);
    expect(r.unplaced).toHaveLength(1);
  });
});

describe('nestParts — gap', () => {
  it('gap separates adjacent parts', () => {
    const parts: Part2D[] = [{ id: 'A', widthMm: 30, heightMm: 30, quantity: 2 }];
    const r = nestParts(parts, sheet, { gapMm: 5 });
    expect(r.placements).toHaveLength(2);
    // The second part should start after first + gap.
    const a = r.placements[0]!;
    const b = r.placements[1]!;
    // Either to the right or above.
    const overlaps = a.x < b.x + b.widthMm + 5 && b.x < a.x + a.widthMm + 5 && a.y < b.y + b.heightMm + 5 && b.y < a.y + a.heightMm + 5;
    expect(overlaps).toBe(false);
  });
});

describe('nestParts — multi-sheet', () => {
  it('parts that don\'t fit start a new sheet', () => {
    const parts: Part2D[] = [{ id: 'A', widthMm: 80, heightMm: 80, quantity: 3 }];
    const r = nestParts(parts, sheet);
    expect(r.sheets.length).toBeGreaterThan(1);
  });

  it('maxSheets caps output', () => {
    const parts: Part2D[] = [{ id: 'A', widthMm: 80, heightMm: 80, quantity: 10 }];
    const r = nestParts(parts, sheet, { maxSheets: 2 });
    expect(r.sheets.length).toBeLessThanOrEqual(2);
    expect(r.unplaced.length).toBeGreaterThan(0);
  });
});

describe('nestParts — utilization', () => {
  it('utilization is fraction', () => {
    const parts: Part2D[] = [{ id: 'A', widthMm: 50, heightMm: 50, quantity: 1 }];
    const r = nestParts(parts, sheet);
    expect(r.utilizationFraction).toBeGreaterThan(0);
    expect(r.utilizationFraction).toBeLessThanOrEqual(1);
  });
});

describe('summarize', () => {
  it('reports parts placed + unplaced + waste', () => {
    const parts: Part2D[] = [{ id: 'A', widthMm: 50, heightMm: 50, quantity: 3 }];
    const r = nestParts(parts, sheet);
    const s = summarize(r, sheet);
    expect(s.partsPlaced + s.partsUnplaced).toBe(3);
    expect(s.wasteAreaMm2).toBeGreaterThanOrEqual(0);
  });
});
