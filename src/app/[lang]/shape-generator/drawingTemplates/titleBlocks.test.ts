import { describe, it, expect } from 'vitest';
import {
  ISO_7200,
  ASME_Y14_100,
  KS_A_0106,
  TITLE_BLOCK_REGISTRY,
  SHEET_SIZES_MM,
  placeTitleBlock,
  fillTitleBlock,
  listTitleBlocks,
} from './titleBlocks';

describe('TITLE_BLOCK_REGISTRY', () => {
  it('includes ISO 7200 as a valid spec', () => {
    expect(TITLE_BLOCK_REGISTRY.ISO_7200).toBe(ISO_7200);
    expect(ISO_7200.cells.length).toBeGreaterThan(0);
  });

  it('ASME standard names every cell with a unique key', () => {
    const keys = ASME_Y14_100.cells.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('KS standard uses Korean labels', () => {
    const titleCell = KS_A_0106.cells.find(c => c.key === 'title');
    expect(titleCell?.label).toBe('도면명');
  });
});

describe('SHEET_SIZES_MM', () => {
  it('A3 = 420 × 297 mm', () => {
    expect(SHEET_SIZES_MM.A3).toEqual({ width: 420, height: 297 });
  });

  it('A2 width × A4 height ≈ A0 area relationship', () => {
    // A(n) area = 2 × A(n+1) area. A0 = 2× A1.
    const a0 = SHEET_SIZES_MM.A0.width * SHEET_SIZES_MM.A0.height;
    const a1 = SHEET_SIZES_MM.A1.width * SHEET_SIZES_MM.A1.height;
    expect(a0 / a1).toBeCloseTo(2, 1);
  });
});

describe('placeTitleBlock', () => {
  it('cells positioned within sheet bounds (A3, margin=10)', () => {
    const { absoluteCells } = placeTitleBlock(ISO_7200, 'A3', 10);
    for (const c of absoluteCells) {
      expect(c.absX).toBeGreaterThanOrEqual(0);
      expect(c.absX).toBeLessThanOrEqual(420);
    }
  });

  it('title cell absolute X computed from sheet width', () => {
    // ISO_7200 title cell positionMm.x = 170; sheet A3 width = 420; margin = 10.
    // absX = (420 - 10) - 170 = 240.
    const { absoluteCells } = placeTitleBlock(ISO_7200, 'A3', 10);
    const title = absoluteCells.find(c => c.key === 'title')!;
    expect(title.absX).toBe(240);
  });

  it('absolute Y = margin + positionMm.y', () => {
    const { absoluteCells } = placeTitleBlock(ISO_7200, 'A3', 10);
    const title = absoluteCells.find(c => c.key === 'title')!;
    expect(title.absY).toBe(60);
  });
});

describe('fillTitleBlock', () => {
  it('fills provided values', () => {
    const filled = fillTitleBlock(ISO_7200, { title: 'Bracket v3', partNumber: 'NF-0001' });
    expect(filled.find(c => c.key === 'title')?.value).toBe('Bracket v3');
    expect(filled.find(c => c.key === 'partNumber')?.value).toBe('NF-0001');
  });

  it('uses cell default when no value supplied', () => {
    const filled = fillTitleBlock(ISO_7200, {});
    expect(filled.find(c => c.key === 'projection')?.value).toBe('first-angle');
  });

  it('leaves cells with neither value nor default empty', () => {
    const filled = fillTitleBlock(ISO_7200, {});
    expect(filled.find(c => c.key === 'title')?.value).toBe('');
  });
});

describe('listTitleBlocks', () => {
  it('excludes null entries (DIN_6771, custom)', () => {
    const list = listTitleBlocks();
    expect(list.every(s => s !== null)).toBe(true);
    expect(list.find(s => s.standard === 'DIN_6771')).toBeUndefined();
  });

  it('includes ISO, ASME, KS, JIS, GB', () => {
    const standards = listTitleBlocks().map(s => s.standard);
    expect(standards).toContain('ISO_7200');
    expect(standards).toContain('ASME_Y14_100');
    expect(standards).toContain('KS_A_0106');
    expect(standards).toContain('JIS_Z_8311');
    expect(standards).toContain('GB_T_10609');
  });
});
