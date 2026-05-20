/**
 * bomTable.ts — Embedded Bill of Materials table for assembly drawings.
 *
 * Layout (ASME Y14.34 + ISO 7573 compatible):
 *
 *   ┌────┬──────────────────┬──────┬──────────────┬──────┐
 *   │ #  │ PART NAME        │ QTY  │ MATERIAL     │ MASS │
 *   ├────┼──────────────────┼──────┼──────────────┼──────┤
 *   │ 1  │ Base plate       │ 1    │ AL6061-T6    │ 0.45 │
 *   │ 2  │ Bracket          │ 2    │ Mild Steel   │ 0.18 │
 *   │ …  │                  │      │              │      │
 *   └────┴──────────────────┴──────┴──────────────┴──────┘
 *
 * The standard places the BOM above the title block (right-anchored)
 * and grows the table upward as rows are added. Maximum row count is
 * driven by available space on the sheet — overflow rows spill onto a
 * continuation sheet (out of scope here).
 */

import type { DrawingLine, DrawingText } from './autoDrawing';

export interface BomRow {
  /** 1-based item number printed in the # column. */
  itemNo: number;
  /** Part / sub-assembly name. */
  name: string;
  /** Quantity in the parent assembly. */
  qty: number;
  /** Material specification (e.g. "AL6061-T6", "STS304 1.5T"). */
  material?: string;
  /** Per-unit mass in kg. */
  massKg?: number;
  /** Optional drawing reference number for the linked detail sheet. */
  drawingRef?: string;
}

export interface BomTableLayout {
  /** Outer rectangle of the BOM block in drawing coordinates (mm). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Cell-border lines ready for the drawing exporter. */
  lines: DrawingLine[];
  /** Header + per-row text entries. */
  texts: DrawingText[];
}

interface ColumnSpec {
  id: keyof BomRow | 'header';
  label: string;
  /** Column width in mm. */
  width: number;
}

const COLUMNS: ColumnSpec[] = [
  { id: 'itemNo',     label: '#',         width: 10 },
  { id: 'name',       label: 'PART NAME', width: 60 },
  { id: 'qty',        label: 'QTY',       width: 10 },
  { id: 'material',   label: 'MATERIAL',  width: 30 },
  { id: 'massKg',     label: 'MASS',      width: 12 },
  { id: 'drawingRef', label: 'DWG REF',   width: 18 },
];

const ROW_HEIGHT = 5;
const HEADER_HEIGHT = 6;

/** Total width if every column is shown. Callers can clip the table or
 *  skip columns by passing a filtered set. */
export function bomTotalWidth(): number {
  return COLUMNS.reduce((s, c) => s + c.width, 0);
}

/** Format the cell value for a column from a row. Centralised so the
 *  formatting rules (mass to 2 decimal, blank for undefined) stay
 *  consistent across all renderers. */
function cellValue(row: BomRow, col: ColumnSpec): string {
  switch (col.id) {
    case 'itemNo':     return String(row.itemNo);
    case 'name':       return row.name;
    case 'qty':        return String(row.qty);
    case 'material':   return row.material ?? '';
    case 'massKg':     return Number.isFinite(row.massKg) ? row.massKg!.toFixed(2) : '';
    case 'drawingRef': return row.drawingRef ?? '';
    case 'header':     return '';
  }
}

/**
 * Build a BOM table anchored at `topLeft`. The table grows DOWN from
 * the anchor; for drawings that want the BOM above the title block, the
 * caller should set `topLeft.y = titleBlockY - tableHeight`.
 */
export function buildBomTable(
  rows: BomRow[],
  topLeft: { x: number; y: number },
): BomTableLayout {
  const x = topLeft.x;
  const y = topLeft.y;
  const totalW = bomTotalWidth();
  const totalH = HEADER_HEIGHT + rows.length * ROW_HEIGHT;

  const lines: DrawingLine[] = [];
  const texts: DrawingText[] = [];

  // Outer rectangle.
  lines.push({ x1: x, y1: y, x2: x + totalW, y2: y, type: 'visible' });
  lines.push({ x1: x + totalW, y1: y, x2: x + totalW, y2: y + totalH, type: 'visible' });
  lines.push({ x1: x + totalW, y1: y + totalH, x2: x, y2: y + totalH, type: 'visible' });
  lines.push({ x1: x, y1: y + totalH, x2: x, y2: y, type: 'visible' });

  // Header bottom border.
  lines.push({ x1: x, y1: y + HEADER_HEIGHT, x2: x + totalW, y2: y + HEADER_HEIGHT, type: 'visible' });

  // Row dividers.
  for (let i = 1; i < rows.length; i++) {
    const ry = y + HEADER_HEIGHT + i * ROW_HEIGHT;
    lines.push({ x1: x, y1: ry, x2: x + totalW, y2: ry, type: 'visible' });
  }

  // Column dividers.
  let cx = x;
  for (let c = 0; c < COLUMNS.length - 1; c++) {
    cx += COLUMNS[c].width;
    lines.push({ x1: cx, y1: y, x2: cx, y2: y + totalH, type: 'visible' });
  }

  // Header text.
  cx = x;
  for (const col of COLUMNS) {
    texts.push({
      x: cx + col.width / 2,
      y: y + HEADER_HEIGHT - 1.5,
      text: col.label,
      fontSize: 2.5,
      anchor: 'middle',
      style: 'note',
    });
    cx += col.width;
  }

  // Body rows.
  for (let r = 0; r < rows.length; r++) {
    cx = x;
    const ry = y + HEADER_HEIGHT + r * ROW_HEIGHT + ROW_HEIGHT - 1.5;
    for (const col of COLUMNS) {
      const value = cellValue(rows[r], col);
      const isNumeric = col.id === 'itemNo' || col.id === 'qty' || col.id === 'massKg';
      texts.push({
        x: isNumeric ? cx + col.width / 2 : cx + 1,
        y: ry,
        text: value,
        fontSize: 2.3,
        anchor: isNumeric ? 'middle' : 'start',
        style: 'note',
      });
      cx += col.width;
    }
  }

  return {
    x, y,
    width: totalW,
    height: totalH,
    lines,
    texts,
  };
}
