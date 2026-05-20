import { describe, it, expect } from 'vitest';
import {
  nestParts,
  summarize,
  type PartToNest,
  type SheetSpec,
} from './multiPartNesting';

function part(id: string, w: number, h: number, qty: number = 1, rotatable: boolean = true): PartToNest {
  return { id, widthMm: w, heightMm: h, quantity: qty, rotatable };
}

const sheet: SheetSpec = { widthMm: 1000, heightMm: 500, paddingMm: 5 };

describe('nestParts', () => {
  it('empty input → empty placement', () => {
    const r = nestParts([], sheet);
    expect(r.placedParts).toEqual([]);
    expect(r.totalSheetsUsed).toBe(0);
  });

  it('single small part placed', () => {
    const r = nestParts([part('a', 100, 100)], sheet);
    expect(r.placedParts).toHaveLength(1);
    expect(r.totalSheetsUsed).toBe(1);
  });

  it('multiple parts fit on one sheet', () => {
    const parts = [part('a', 200, 200), part('b', 200, 200), part('c', 200, 200)];
    const r = nestParts(parts, sheet);
    expect(r.placedParts).toHaveLength(3);
    expect(r.totalSheetsUsed).toBe(1);
  });

  it('part larger than sheet → unplaced', () => {
    const r = nestParts([part('big', 5000, 5000, 1, false)], sheet);
    expect(r.unplaced).toHaveLength(1);
    expect(r.placedParts).toHaveLength(0);
  });

  it('quantity expansion: 3 of same part', () => {
    const r = nestParts([part('a', 100, 100, 3)], sheet);
    expect(r.placedParts).toHaveLength(3);
  });

  it('rotation allowed when needed', () => {
    // Part 600×100 fits sheet 1000×500. Doesn't need rotation.
    const r = nestParts([part('a', 600, 100, 1, true)], sheet);
    expect(r.placedParts).toHaveLength(1);
  });

  it('utilization between 0 and 1', () => {
    const r = nestParts([part('a', 100, 100)], sheet);
    expect(r.sheetUtilization[0]).toBeGreaterThan(0);
    expect(r.sheetUtilization[0]).toBeLessThanOrEqual(1);
  });

  it('placed parts have non-overlapping bboxes', () => {
    const parts = [part('a', 300, 300), part('b', 300, 300), part('c', 200, 200)];
    const r = nestParts(parts, sheet);
    // Pairwise check.
    for (let i = 0; i < r.placedParts.length; i++) {
      for (let j = i + 1; j < r.placedParts.length; j++) {
        const a = r.placedParts[i]!;
        const b = r.placedParts[j]!;
        if (a.sheetIndex !== b.sheetIndex) continue;
        const overlap = a.origin.x < b.origin.x + b.widthMm &&
                        a.origin.x + a.widthMm > b.origin.x &&
                        a.origin.y < b.origin.y + b.heightMm &&
                        a.origin.y + a.heightMm > b.origin.y;
        expect(overlap).toBe(false);
      }
    }
  });

  it('overflow → opens new sheet', () => {
    // 10 parts each 250x250, sheet 1000x500 → 8 fit per sheet, need 2 sheets.
    const r = nestParts([part('a', 250, 250, 10)], sheet);
    expect(r.totalSheetsUsed).toBeGreaterThanOrEqual(2);
  });

  it('placed parts within sheet bounds', () => {
    const r = nestParts([part('a', 200, 200, 3)], sheet);
    for (const p of r.placedParts) {
      expect(p.origin.x + p.widthMm).toBeLessThanOrEqual(sheet.widthMm + sheet.paddingMm + 0.01);
      expect(p.origin.y + p.heightMm).toBeLessThanOrEqual(sheet.heightMm + sheet.paddingMm + 0.01);
    }
  });
});

describe('summarize', () => {
  it('empty input', () => {
    const r = nestParts([], sheet);
    const s = summarize(r);
    expect(s.placedCount).toBe(0);
    expect(s.averageUtilization).toBe(0);
  });

  it('reports counts', () => {
    const r = nestParts([part('a', 100, 100, 3)], sheet);
    const s = summarize(r);
    expect(s.placedCount).toBe(3);
    expect(s.sheetsUsed).toBe(1);
  });

  it('best > worst utilization when multiple sheets', () => {
    const r = nestParts([part('a', 250, 250, 10)], sheet);
    const s = summarize(r);
    if (s.sheetsUsed >= 2) {
      expect(s.bestSheetUtilization).toBeGreaterThanOrEqual(s.worstSheetUtilization);
    }
  });
});
