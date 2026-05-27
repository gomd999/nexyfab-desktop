import { describe, it, expect } from 'vitest';
import { buildGrid, locateCell, summarize } from './coordinateGridOverlay';

describe('buildGrid', () => {
  it('default A4 8x6 grid has 9 vertical lines + 7 horizontal lines', () => {
    const g = buildGrid();
    expect(g.verticalLines).toHaveLength(9);
    expect(g.horizontalLines).toHaveLength(7);
  });

  it('cellWidth = widthMm / cols', () => {
    const g = buildGrid({ widthMm: 297, cols: 8 });
    expect(g.cellWidthMm).toBeCloseTo(297 / 8, 5);
  });

  it('column labels A..H for alpha-upper, 8 cols', () => {
    const g = buildGrid({ cols: 8, columnLabelMode: 'alpha-upper', labelPlacement: 'corners-only' });
    // Top labels only (8) when corners-only mode.
    const texts = g.columnLabels.map(l => l.text);
    expect(texts.slice(0, 8)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });

  it('row labels are numeric by default', () => {
    const g = buildGrid({ rows: 4, labelPlacement: 'corners-only' });
    const texts = g.rowLabels.map(l => l.text);
    expect(texts).toEqual(['1', '2', '3', '4']);
  });

  it('edges mode places labels on both sides', () => {
    const edges = buildGrid({ cols: 4, labelPlacement: 'edges' });
    const corners = buildGrid({ cols: 4, labelPlacement: 'corners-only' });
    expect(edges.columnLabels.length).toBe(corners.columnLabels.length * 2);
  });

  it('vertical lines span 0..width', () => {
    const g = buildGrid({ widthMm: 100, cols: 5, origin: { x: 0, y: 0 } });
    expect(g.verticalLines[0]).toBe(0);
    expect(g.verticalLines[g.verticalLines.length - 1]).toBe(100);
  });

  it('alpha labels handle > 26 cols (AA, AB...)', () => {
    const g = buildGrid({ cols: 28, columnLabelMode: 'alpha-upper', labelPlacement: 'corners-only' });
    const texts = g.columnLabels.map(l => l.text);
    expect(texts[25]).toBe('Z');
    expect(texts[26]).toBe('AA');
    expect(texts[27]).toBe('AB');
  });

  it('numeric column mode produces digits', () => {
    const g = buildGrid({ cols: 5, columnLabelMode: 'numeric', labelPlacement: 'corners-only' });
    expect(g.columnLabels.map(l => l.text)).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('locateCell', () => {
  it('center of first cell → column 0, row 0', () => {
    const cell = locateCell({ x: 18.5, y: 17.5 }, { widthMm: 297, heightMm: 210, cols: 8, rows: 6 });
    expect(cell).not.toBeNull();
    expect(cell!.column).toBe(0);
    expect(cell!.row).toBe(0);
  });

  it('top-right cell label', () => {
    const cell = locateCell({ x: 290, y: 200 }, { widthMm: 297, heightMm: 210, cols: 8, rows: 6 });
    expect(cell!.label).toMatch(/^[A-H][1-6]$/);
  });

  it('point outside sheet → null', () => {
    expect(locateCell({ x: -10, y: -10 })).toBeNull();
    expect(locateCell({ x: 1000, y: 1000 })).toBeNull();
  });

  it('label combines column + row', () => {
    const cell = locateCell({ x: 50, y: 50 }, { widthMm: 200, heightMm: 200, cols: 4, rows: 4 });
    expect(cell!.label.length).toBeGreaterThanOrEqual(2);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const g = buildGrid({ cols: 4, rows: 3 });
    const s = summarize(g);
    expect(s.cellCount).toBe(12);
    expect(s.verticalLineCount).toBe(5);
    expect(s.horizontalLineCount).toBe(4);
  });
});
