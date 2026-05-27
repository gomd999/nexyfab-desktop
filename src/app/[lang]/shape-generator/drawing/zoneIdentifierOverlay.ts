/**
 * zoneIdentifierOverlay.ts — Compute zone identifiers (e.g., "A4",
 * "C12") on a drawing sheet for find-it-fast referencing.
 *
 * Per ASME Y14.1 / ISO 5457:
 *
 *   - Grid superimposed on sheet border.
 *   - Columns labelled A, B, C, … left → right.
 *   - Rows labelled 1, 2, 3, … top → bottom.
 *
 * Sheet sizes drive the grid:
 *   A4: 4×4, A3: 6×4, A2: 8×6, A1: 12×8, A0: 16×12.
 *
 * Module:
 *   - Maps any (x, y) drawing point to its zone code.
 *   - Generates the border tick mark positions.
 *   - Validates feature lies inside drawing area.
 */

export interface Vec2 { x: number; y: number }

export interface SheetSize {
  format: string;
  widthMm: number;
  heightMm: number;
  columns: number;
  rows: number;
}

export const SHEET_SIZES: Record<string, SheetSize> = {
  A4: { format: 'A4', widthMm: 297, heightMm: 210, columns: 4, rows: 4 },
  A3: { format: 'A3', widthMm: 420, heightMm: 297, columns: 6, rows: 4 },
  A2: { format: 'A2', widthMm: 594, heightMm: 420, columns: 8, rows: 6 },
  A1: { format: 'A1', widthMm: 841, heightMm: 594, columns: 12, rows: 8 },
  A0: { format: 'A0', widthMm: 1189, heightMm: 841, columns: 16, rows: 12 },
};

export interface ZoneOptions {
  /** Margin (mm) — zone grid starts inside this. */
  marginMm: number;
  /** Title block height to subtract from drawing area (mm). */
  titleBlockHeightMm: number;
}

export const DEFAULT_OPTIONS: ZoneOptions = {
  marginMm: 10,
  titleBlockHeightMm: 60,
};

export interface ZoneCode {
  column: string;
  row: number;
  combined: string;
}

export interface ZoneTick {
  position: Vec2;
  label: string;
  axis: 'horizontal' | 'vertical';
}

// ── Top-level entry ────────────────────────────────────────────

export function pointToZone(point: Vec2, sheet: SheetSize, options: Partial<ZoneOptions> = {}): ZoneCode | null {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const usableWidth = sheet.widthMm - 2 * opts.marginMm;
  const usableHeight = sheet.heightMm - 2 * opts.marginMm - opts.titleBlockHeightMm;
  const colWidth = usableWidth / sheet.columns;
  const rowHeight = usableHeight / sheet.rows;
  const colIndex = Math.floor((point.x - opts.marginMm) / colWidth);
  const rowIndex = Math.floor((point.y - opts.marginMm - opts.titleBlockHeightMm) / rowHeight);
  if (colIndex < 0 || colIndex >= sheet.columns) return null;
  if (rowIndex < 0 || rowIndex >= sheet.rows) return null;
  const colLetter = columnLetter(colIndex);
  const rowNumber = sheet.rows - rowIndex;
  return { column: colLetter, row: rowNumber, combined: `${colLetter}${rowNumber}` };
}

function columnLetter(idx: number): string {
  if (idx < 26) return String.fromCharCode('A'.charCodeAt(0) + idx);
  const first = String.fromCharCode('A'.charCodeAt(0) + Math.floor(idx / 26) - 1);
  const second = String.fromCharCode('A'.charCodeAt(0) + (idx % 26));
  return first + second;
}

// ── Generate border ticks ────────────────────────────────────

export function generateBorderTicks(sheet: SheetSize, options: Partial<ZoneOptions> = {}): ZoneTick[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const ticks: ZoneTick[] = [];
  const usableWidth = sheet.widthMm - 2 * opts.marginMm;
  const usableHeight = sheet.heightMm - 2 * opts.marginMm - opts.titleBlockHeightMm;
  const colWidth = usableWidth / sheet.columns;
  const rowHeight = usableHeight / sheet.rows;
  for (let c = 0; c < sheet.columns; c++) {
    const x = opts.marginMm + colWidth * (c + 0.5);
    ticks.push({ position: { x, y: opts.marginMm / 2 }, label: columnLetter(c), axis: 'horizontal' });
  }
  for (let r = 0; r < sheet.rows; r++) {
    const y = opts.marginMm + opts.titleBlockHeightMm + rowHeight * (r + 0.5);
    ticks.push({ position: { x: opts.marginMm / 2, y }, label: String(sheet.rows - r), axis: 'vertical' });
  }
  return ticks;
}

// ── Cross-reference: list features in each zone ───────────────

export interface ZonedFeature {
  id: string;
  zone: string;
}

export function indexFeatures(features: { id: string; point: Vec2 }[], sheet: SheetSize, options: Partial<ZoneOptions> = {}): ZonedFeature[] {
  const out: ZonedFeature[] = [];
  for (const f of features) {
    const zone = pointToZone(f.point, sheet, options);
    if (zone) out.push({ id: f.id, zone: zone.combined });
  }
  return out;
}

// ── Distance between zones (Manhattan in zone units) ─────────

export function zoneDistance(a: ZoneCode, b: ZoneCode): number {
  return Math.abs(a.column.charCodeAt(0) - b.column.charCodeAt(0)) + Math.abs(a.row - b.row);
}

// ── Summary ────────────────────────────────────────────────────

export interface ZoneSummary {
  sheetFormat: string;
  zoneCount: number;
  columns: number;
  rows: number;
}

export function summarize(sheet: SheetSize): ZoneSummary {
  return {
    sheetFormat: sheet.format,
    zoneCount: sheet.columns * sheet.rows,
    columns: sheet.columns,
    rows: sheet.rows,
  };
}
