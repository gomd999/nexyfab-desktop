/**
 * flatPatternDrawing.ts — Bridge between the sheet-metal flat-pattern
 * solver (`features/sheetMetal.ts`) and the drawing pipeline.
 *
 * The solver returns a `FlatPatternResult` with:
 *   - 3-D unfolded geometry (for viewport preview)
 *   - `width` / `length` of the flat blank
 *   - `bendTable[]` — per-bend position, angle, radius, BA, BD, K, direction
 *
 * Drawings need a different shape:
 *   - outline lines for the blank rectangle (`visible`)
 *   - dashed bend lines per BendTableEntry (`center`)
 *   - annotations: bend index + angle + direction + radius beside each line
 *   - a small text block ("BEND TABLE") summarising the bends
 *
 * This module converts one shape into the other so the drawing
 * exporter can render flat patterns as a first-class view alongside
 * front / top / right projections.
 */

import type { FlatPatternResult } from '../features/sheetMetal';
import type { DrawingLine, DrawingText } from './autoDrawing';

export interface FlatPatternDrawingView {
  /** Blank outline + bend lines, ready to drop into a ViewResult. */
  lines: DrawingLine[];
  /** Per-bend labels (drawn next to each bend line). */
  texts: DrawingText[];
  /** Header summary ("BEND TABLE" + column titles + one row per bend). */
  bendTableTexts: DrawingText[];
  /** Width of the drawing in mm (= flat blank width × scale). */
  drawingWidth: number;
  /** Height of the drawing in mm (= flat blank length × scale, with
   *  extra room reserved at the bottom for the bend table). */
  drawingHeight: number;
}

/** Vertical mm reserved for the bend table below the blank outline.
 *  Sized for up to ~12 bends at 4mm row height + a 6mm header. */
const BEND_TABLE_HEIGHT = 60;

/** Convert a sheet-metal flat-pattern solver result into a drawing-view
 *  representation. The blank is laid out horizontally: width along X
 *  (the cross-bend axis) and length along Y (the walking axis).
 *
 *  `scale` multiplies all coordinates so the caller can fit the view
 *  to a specific paper region (1:1 mm-to-mm by default). */
export function buildFlatPatternView(
  result: FlatPatternResult,
  scale = 1,
): FlatPatternDrawingView {
  const lines: DrawingLine[] = [];
  const texts: DrawingText[] = [];

  const w = result.width * scale;
  const len = result.length * scale;

  // Outline rectangle (visible / solid).
  lines.push({ x1: 0, y1: 0, x2: w, y2: 0, type: 'visible' });
  lines.push({ x1: w, y1: 0, x2: w, y2: len, type: 'visible' });
  lines.push({ x1: w, y1: len, x2: 0, y2: len, type: 'visible' });
  lines.push({ x1: 0, y1: len, x2: 0, y2: 0, type: 'visible' });

  // Bend lines + annotations.
  result.bendTable.forEach((b, i) => {
    const y = b.position * scale;
    lines.push({ x1: 0, y1: y, x2: w, y2: y, type: 'center' });
    const dirGlyph = b.direction === 'up' ? '▲' : '▼';
    texts.push({
      x: w + 3,
      y,
      text: `${i + 1}: ${dirGlyph} ${b.angle.toFixed(0)}° R${b.radius.toFixed(1)}`,
      fontSize: 2.5,
      anchor: 'start',
      style: 'note',
    });
  });

  // Bend table — placed BELOW the outline (Y = len + 6mm gap + rows).
  const bendTableTexts: DrawingText[] = [];
  const tableY = len + 8;
  bendTableTexts.push({
    x: 0, y: tableY,
    text: `BEND TABLE — ${result.bendTable.length} bend(s), ${result.material}, ${result.thickness}mm`,
    fontSize: 3,
    anchor: 'start',
    style: 'note',
  });
  // Column header.
  bendTableTexts.push({
    x: 0, y: tableY + 5,
    text: '#   POS(mm)  ANGLE  RADIUS  DIR   BA(mm)  BD(mm)  K',
    fontSize: 2.2,
    anchor: 'start',
    style: 'note',
  });
  result.bendTable.forEach((b, i) => {
    const cols = [
      `${i + 1}`.padStart(3),
      `${b.position.toFixed(1)}`.padStart(7),
      `${b.angle.toFixed(0)}°`.padStart(6),
      `${b.radius.toFixed(2)}`.padStart(7),
      `${b.direction === 'up' ? 'UP  ' : 'DOWN'}`.padEnd(5),
      `${b.bendAllowance.toFixed(2)}`.padStart(7),
      `${b.bendDeduction.toFixed(2)}`.padStart(7),
      `${b.kFactor.toFixed(3)}`.padStart(6),
    ];
    bendTableTexts.push({
      x: 0,
      y: tableY + 5 + (i + 1) * 3.5,
      text: cols.join(' '),
      fontSize: 2.2,
      anchor: 'start',
      style: 'note',
    });
  });

  return {
    lines,
    texts,
    bendTableTexts,
    drawingWidth: w,
    drawingHeight: len + BEND_TABLE_HEIGHT,
  };
}
