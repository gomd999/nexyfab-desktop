import { describe, it, expect } from 'vitest';
import {
  pointToZone,
  generateBorderTicks,
  indexFeatures,
  zoneDistance,
  summarize,
  SHEET_SIZES,
} from './zoneIdentifierOverlay';

describe('SHEET_SIZES', () => {
  it('A4 has 4×4 grid', () => {
    expect(SHEET_SIZES.A4!.columns).toBe(4);
    expect(SHEET_SIZES.A4!.rows).toBe(4);
  });

  it('larger sheets have more zones', () => {
    expect(SHEET_SIZES.A0!.columns).toBeGreaterThan(SHEET_SIZES.A4!.columns);
  });
});

describe('pointToZone', () => {
  it('upper-left corner → A<rows>', () => {
    const zone = pointToZone({ x: 30, y: 90 }, SHEET_SIZES.A3!, { marginMm: 10, titleBlockHeightMm: 60 });
    expect(zone?.column).toBe('A');
  });

  it('outside sheet → null', () => {
    const zone = pointToZone({ x: 1000, y: 1000 }, SHEET_SIZES.A4!);
    expect(zone).toBeNull();
  });

  it('combined string format', () => {
    const zone = pointToZone({ x: 100, y: 150 }, SHEET_SIZES.A3!, { marginMm: 10, titleBlockHeightMm: 60 });
    expect(zone?.combined).toMatch(/^[A-Z]\d+$/);
  });

  it('different columns for different X', () => {
    const left = pointToZone({ x: 50, y: 150 }, SHEET_SIZES.A3!, { marginMm: 10, titleBlockHeightMm: 60 });
    const right = pointToZone({ x: 400, y: 150 }, SHEET_SIZES.A3!, { marginMm: 10, titleBlockHeightMm: 60 });
    expect(left?.column).not.toBe(right?.column);
  });
});

describe('generateBorderTicks', () => {
  it('A4 produces 8 ticks (4 columns + 4 rows)', () => {
    const ticks = generateBorderTicks(SHEET_SIZES.A4!);
    expect(ticks).toHaveLength(8);
  });

  it('horizontal ticks have letter labels', () => {
    const ticks = generateBorderTicks(SHEET_SIZES.A4!);
    const horizontal = ticks.filter(t => t.axis === 'horizontal');
    expect(horizontal[0]!.label).toBe('A');
  });

  it('vertical ticks have number labels', () => {
    const ticks = generateBorderTicks(SHEET_SIZES.A4!);
    const vertical = ticks.filter(t => t.axis === 'vertical');
    expect(parseInt(vertical[0]!.label, 10)).toBeGreaterThan(0);
  });
});

describe('indexFeatures', () => {
  it('maps features to zones', () => {
    const features = [{ id: 'f1', point: { x: 100, y: 100 } }, { id: 'f2', point: { x: 300, y: 200 } }];
    const r = indexFeatures(features, SHEET_SIZES.A3!);
    expect(r.length).toBeGreaterThan(0);
  });

  it('out-of-sheet features dropped', () => {
    const features = [{ id: 'f1', point: { x: 9999, y: 9999 } }];
    expect(indexFeatures(features, SHEET_SIZES.A4!)).toEqual([]);
  });
});

describe('zoneDistance', () => {
  it('same zone → 0', () => {
    expect(zoneDistance({ column: 'B', row: 3, combined: 'B3' }, { column: 'B', row: 3, combined: 'B3' })).toBe(0);
  });

  it('distance is Manhattan', () => {
    expect(zoneDistance({ column: 'A', row: 1, combined: 'A1' }, { column: 'C', row: 4, combined: 'C4' })).toBe(2 + 3);
  });
});

describe('summarize', () => {
  it('reports zone count', () => {
    const s = summarize(SHEET_SIZES.A3!);
    expect(s.zoneCount).toBe(6 * 4);
  });
});
