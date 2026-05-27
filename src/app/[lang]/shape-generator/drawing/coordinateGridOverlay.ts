/**
 * coordinateGridOverlay.ts — Generate a coordinate grid overlay for
 * drawings (X/Y reference grid with column labels A-Z and row 1-N).
 *
 * Common on architectural and large engineering drawings to give
 * each region a "cell" coordinate (e.g., "see Detail B-3"). Module
 * computes grid line positions + label placement so the renderer
 * can draw them on top of the title block frame.
 */

export interface Vec2 { x: number; y: number }

export interface GridResult {
  /** Vertical grid line X positions. */
  verticalLines: number[];
  /** Horizontal grid line Y positions. */
  horizontalLines: number[];
  /** Column labels with positions. */
  columnLabels: Array<{ text: string; position: Vec2 }>;
  /** Row labels with positions. */
  rowLabels: Array<{ text: string; position: Vec2 }>;
  /** Cell width in mm. */
  cellWidthMm: number;
  /** Cell height in mm. */
  cellHeightMm: number;
}

export interface GridOptions {
  /** Drawing sheet origin (typically inside the border). */
  origin: Vec2;
  /** Drawing sheet usable width (mm). */
  widthMm: number;
  /** Drawing sheet usable height (mm). */
  heightMm: number;
  /** Number of columns. */
  cols: number;
  /** Number of rows. */
  rows: number;
  /** Column label mode. */
  columnLabelMode: 'alpha-upper' | 'alpha-lower' | 'numeric';
  /** Row label mode. */
  rowLabelMode: 'numeric' | 'alpha-upper' | 'alpha-lower';
  /** Label offset from grid edge (mm). */
  labelOffsetMm: number;
  /** Label placement: corners only (4 corners) or every cell. */
  labelPlacement: 'edges' | 'corners-only';
}

export const DEFAULT_OPTIONS: GridOptions = {
  origin: { x: 0, y: 0 },
  widthMm: 297,
  heightMm: 210,
  cols: 8,
  rows: 6,
  columnLabelMode: 'alpha-upper',
  rowLabelMode: 'numeric',
  labelOffsetMm: 5,
  labelPlacement: 'edges',
};

// ── Top-level entry ────────────────────────────────────────────

export function buildGrid(options: Partial<GridOptions> = {}): GridResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const cellW = opts.widthMm / opts.cols;
  const cellH = opts.heightMm / opts.rows;

  const verticalLines: number[] = [];
  const horizontalLines: number[] = [];
  for (let i = 0; i <= opts.cols; i++) {
    verticalLines.push(opts.origin.x + i * cellW);
  }
  for (let j = 0; j <= opts.rows; j++) {
    horizontalLines.push(opts.origin.y + j * cellH);
  }

  const columnLabels: Array<{ text: string; position: Vec2 }> = [];
  const rowLabels: Array<{ text: string; position: Vec2 }> = [];

  for (let c = 0; c < opts.cols; c++) {
    const text = makeLabel(c + 1, opts.columnLabelMode);
    const x = opts.origin.x + (c + 0.5) * cellW;
    // Top and bottom labels.
    columnLabels.push({ text, position: { x, y: opts.origin.y - opts.labelOffsetMm } });
    if (opts.labelPlacement === 'edges') {
      columnLabels.push({ text, position: { x, y: opts.origin.y + opts.heightMm + opts.labelOffsetMm } });
    }
  }
  for (let r = 0; r < opts.rows; r++) {
    const text = makeLabel(r + 1, opts.rowLabelMode);
    const y = opts.origin.y + (r + 0.5) * cellH;
    rowLabels.push({ text, position: { x: opts.origin.x - opts.labelOffsetMm, y } });
    if (opts.labelPlacement === 'edges') {
      rowLabels.push({ text, position: { x: opts.origin.x + opts.widthMm + opts.labelOffsetMm, y } });
    }
  }

  return { verticalLines, horizontalLines, columnLabels, rowLabels, cellWidthMm: cellW, cellHeightMm: cellH };
}

// ── Cell lookup ───────────────────────────────────────────────

export interface CellId {
  column: number;
  row: number;
  label: string;
}

export function locateCell(point: Vec2, options: Partial<GridOptions> = {}): CellId | null {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const cellW = opts.widthMm / opts.cols;
  const cellH = opts.heightMm / opts.rows;
  const dx = point.x - opts.origin.x;
  const dy = point.y - opts.origin.y;
  if (dx < 0 || dy < 0 || dx > opts.widthMm || dy > opts.heightMm) return null;
  const col = Math.min(opts.cols - 1, Math.floor(dx / cellW));
  const row = Math.min(opts.rows - 1, Math.floor(dy / cellH));
  const colLabel = makeLabel(col + 1, opts.columnLabelMode);
  const rowLabel = makeLabel(row + 1, opts.rowLabelMode);
  return { column: col, row, label: `${colLabel}${rowLabel}` };
}

// ── Helpers ────────────────────────────────────────────────────

function makeLabel(n: number, mode: GridOptions['columnLabelMode']): string {
  if (mode === 'numeric') return String(n);
  if (mode === 'alpha-upper') return toAlpha(n).toUpperCase();
  return toAlpha(n).toLowerCase();
}

function toAlpha(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

// ── Summary ────────────────────────────────────────────────────

export interface GridSummary {
  cellCount: number;
  verticalLineCount: number;
  horizontalLineCount: number;
  labelCount: number;
}

export function summarize(result: GridResult): GridSummary {
  return {
    cellCount: (result.verticalLines.length - 1) * (result.horizontalLines.length - 1),
    verticalLineCount: result.verticalLines.length,
    horizontalLineCount: result.horizontalLines.length,
    labelCount: result.columnLabels.length + result.rowLabels.length,
  };
}
