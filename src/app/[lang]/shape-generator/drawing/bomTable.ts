/**
 * bomTable.ts — Drawing-side BOM table emitter.
 *
 * Bridges between `standardParts/bomAggregation` (data-side, format-
 * agnostic) and the drawing SVG renderer (presentation). Adds:
 *   - balloon-number assignment in a stable order
 *   - column layout sizing
 *   - text formatting (designation, qty, notes columns)
 *
 * Balloons are the small numbered circles drawn on the assembly
 * view; each balloon's number references a BOM row. The numbering
 * follows ISO 7573 — numerals 1..N in disassembly order.
 */

import type { BomRow } from '../standardParts/bomAggregation';
import { formatNumber } from '@/lib/i18n/format';

export interface BomColumn {
  key: 'balloon' | 'designation' | 'qty' | 'notes' | 'unitCost' | 'totalCost';
  label: string;
  widthMm: number;
  align?: 'left' | 'right' | 'center';
}

export interface BomTableLayout {
  columns: BomColumn[];
  totalWidthMm: number;
  rowHeightMm: number;
  headerHeightMm: number;
}

export interface BalloonedRow extends BomRow {
  balloonNumber: number;
}

export interface BomTableModel {
  layout: BomTableLayout;
  rows: BalloonedRow[];
}

export const DEFAULT_LAYOUT: BomTableLayout = {
  columns: [
    { key: 'balloon',     label: '#',      widthMm: 8,  align: 'center' },
    { key: 'designation', label: 'Item',   widthMm: 50, align: 'left'   },
    { key: 'qty',         label: 'Qty',    widthMm: 12, align: 'right'  },
    { key: 'notes',       label: 'Notes',  widthMm: 30, align: 'left'   },
  ],
  totalWidthMm: 100,
  rowHeightMm: 6,
  headerHeightMm: 8,
};

export function buildBomTable(rows: BomRow[], layout: BomTableLayout = DEFAULT_LAYOUT): BomTableModel {
  const ballooned: BalloonedRow[] = rows.map((r, i) => ({ ...r, balloonNumber: i + 1 }));
  return { layout, rows: ballooned };
}

export function renderCell(row: BalloonedRow, col: BomColumn, lang: string = 'ko'): string {
  switch (col.key) {
    case 'balloon':     return String(row.balloonNumber);
    case 'designation': return row.designation;
    case 'qty':         return String(row.qty);
    case 'notes':       return row.notes ?? '';
    case 'unitCost':    return row.unitCostKrw != null ? (formatNumber(row.unitCostKrw, lang) ?? '—') : '—';
    case 'totalCost':   return row.unitCostKrw != null
      ? (formatNumber(row.unitCostKrw * row.qty, lang) ?? '—')
      : '—';
  }
}

export interface TableMetrics {
  totalHeightMm: number;
  rowCount: number;
}

export function tableMetrics(model: BomTableModel): TableMetrics {
  return {
    totalHeightMm: model.layout.headerHeightMm + model.rows.length * model.layout.rowHeightMm,
    rowCount: model.rows.length,
  };
}

/** Build SVG <text>/<rect> primitive list — caller wraps in a <g>. */
export interface SvgPrimitive {
  kind: 'rect' | 'text' | 'line';
  attrs: Record<string, string | number>;
  text?: string;
}

export function renderBomTableSvg(
  model: BomTableModel,
  originXmm: number,
  originYmm: number,
): SvgPrimitive[] {
  const out: SvgPrimitive[] = [];
  const lh = model.layout.rowHeightMm;
  const hh = model.layout.headerHeightMm;
  let x = originXmm;
  // Outer frame
  out.push({
    kind: 'rect',
    attrs: {
      x: originXmm, y: originYmm,
      width: model.layout.totalWidthMm,
      height: hh + model.rows.length * lh,
      fill: 'none', stroke: 'currentColor', 'stroke-width': 0.5,
    },
  });
  // Header
  for (const col of model.layout.columns) {
    out.push({
      kind: 'text',
      attrs: {
        x: x + col.widthMm / 2,
        y: originYmm + hh / 2,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-weight': 'bold',
      },
      text: col.label,
    });
    x += col.widthMm;
  }
  // Header divider line
  out.push({
    kind: 'line',
    attrs: {
      x1: originXmm, y1: originYmm + hh,
      x2: originXmm + model.layout.totalWidthMm, y2: originYmm + hh,
      stroke: 'currentColor', 'stroke-width': 0.5,
    },
  });
  // Data rows
  for (let i = 0; i < model.rows.length; i++) {
    const row = model.rows[i]!;
    let cx = originXmm;
    const y = originYmm + hh + i * lh + lh / 2;
    for (const col of model.layout.columns) {
      const align = col.align ?? 'left';
      const xText = align === 'left' ? cx + 1 : align === 'right' ? cx + col.widthMm - 1 : cx + col.widthMm / 2;
      const textAnchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
      out.push({
        kind: 'text',
        attrs: {
          x: xText, y,
          'text-anchor': textAnchor,
          'dominant-baseline': 'middle',
        },
        text: renderCell(row, col),
      });
      cx += col.widthMm;
    }
  }
  return out;
}
