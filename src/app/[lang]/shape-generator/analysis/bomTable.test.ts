import { describe, it, expect } from 'vitest';
import { buildBomTable, bomTotalWidth, type BomRow } from './bomTable';
import { PAPER_SIZES } from './autoDrawing';

const sampleRows: BomRow[] = [
  { itemNo: 1, name: 'Base plate', qty: 1, material: 'AL6061-T6', massKg: 0.452, drawingRef: 'NF-001' },
  { itemNo: 2, name: 'Bracket',    qty: 2, material: 'Mild Steel', massKg: 0.18 },
  { itemNo: 3, name: 'Bolt M4×10', qty: 8 },
];

describe('PAPER_SIZES — A1 / A0 additions', () => {
  it('exposes A4, A3, A2, A1, A0', () => {
    expect(PAPER_SIZES.A4).toEqual({ w: 297, h: 210 });
    expect(PAPER_SIZES.A3).toEqual({ w: 420, h: 297 });
    expect(PAPER_SIZES.A2).toEqual({ w: 594, h: 420 });
    expect(PAPER_SIZES.A1).toEqual({ w: 841, h: 594 });
    expect(PAPER_SIZES.A0).toEqual({ w: 1189, h: 841 });
  });

  it('A0 is the largest, A4 the smallest', () => {
    const sizes = Object.values(PAPER_SIZES);
    const areas = sizes.map(s => s.w * s.h);
    expect(Math.max(...areas)).toBe(PAPER_SIZES.A0.w * PAPER_SIZES.A0.h);
    expect(Math.min(...areas)).toBe(PAPER_SIZES.A4.w * PAPER_SIZES.A4.h);
  });
});

describe('buildBomTable · layout', () => {
  it('emits the outer rectangle + header underline + N row separators', () => {
    const t = buildBomTable(sampleRows, { x: 100, y: 50 });
    const visibleLines = t.lines.filter(l => l.type === 'visible');
    // 4 outer + 1 header underline + (N-1) row dividers + 5 column dividers
    // = 4 + 1 + 2 + 5 = 12
    expect(visibleLines.length).toBe(12);
  });

  it('emits N+1 header text entries + N×6 body cells', () => {
    const t = buildBomTable(sampleRows, { x: 0, y: 0 });
    // Header has 6 columns; body has 3 rows × 6 cols = 18; total = 24.
    expect(t.texts.length).toBe(6 + 3 * 6);
  });

  it('table grows down from the anchor (top-left fixed)', () => {
    const t = buildBomTable(sampleRows, { x: 100, y: 50 });
    expect(t.x).toBe(100);
    expect(t.y).toBe(50);
    expect(t.height).toBeGreaterThan(0);
  });

  it('width matches the sum of column widths', () => {
    const t = buildBomTable(sampleRows, { x: 0, y: 0 });
    expect(t.width).toBe(bomTotalWidth());
  });

  it('numeric columns are centre-aligned, text columns left-aligned', () => {
    const t = buildBomTable(sampleRows, { x: 0, y: 0 });
    // Header texts: '#' and 'QTY' and 'MASS' centred (middle anchor),
    // 'PART NAME' / 'MATERIAL' / 'DWG REF' left.
    const headers = t.texts.slice(0, 6);
    const labels = headers.map(h => h.text);
    expect(labels).toEqual(['#', 'PART NAME', 'QTY', 'MATERIAL', 'MASS', 'DWG REF']);
    expect(headers[0].anchor).toBe('middle'); // #
    expect(headers[1].anchor).toBe('middle'); // PART NAME (header label centred — same alignment as the body convention)
  });

  it('mass values are formatted to 2 decimal places', () => {
    const t = buildBomTable(sampleRows, { x: 0, y: 0 });
    // Row 1 mass cell: itemNo 1's row, MASS column (5th column, 0-indexed 4).
    const row1MassText = t.texts.find(tx => tx.text === '0.45');
    expect(row1MassText).toBeDefined();
  });

  it('skips missing optional fields (no material → empty cell)', () => {
    const t = buildBomTable(sampleRows, { x: 0, y: 0 });
    // Row 3 (Bolt) has no material — its material cell should be ''.
    // Find Bolt's row by name and check the cells immediately after.
    const idx = t.texts.findIndex(x => x.text === 'Bolt M4×10');
    expect(idx).toBeGreaterThan(-1);
    // QTY = '8', MATERIAL = '', MASS = '', DWG REF = '' follow.
    expect(t.texts[idx + 1].text).toBe('8');
    expect(t.texts[idx + 2].text).toBe('');
    expect(t.texts[idx + 3].text).toBe('');
    expect(t.texts[idx + 4].text).toBe('');
  });

  it('handles an empty BOM (just header, no body rows)', () => {
    const t = buildBomTable([], { x: 0, y: 0 });
    expect(t.texts).toHaveLength(6); // header only
    expect(t.lines.filter(l => l.type === 'visible')).toHaveLength(4 + 1 + 5);
    // outer 4 + header underline 1 + col dividers 5 (no row dividers when empty)
  });
});
