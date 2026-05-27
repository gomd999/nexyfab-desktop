/**
 * titleBlockIso7200.ts — Standards-compliant title block layout
 * following ISO 7200:2004 (preferred small-format variant) and the
 * compatible subset of ASME Y14.1-2020.
 *
 * Why a separate module from `drawingExport`:
 *  - The existing `drawingExport.ts` emits a quick 100×25mm placeholder
 *    that's fine for a sketch but no shop will accept as a deliverable.
 *  - ISO 7200 mandates field positions, line weights, and minimum row
 *    heights; "looks right" isn't enough — the inspector pulls a ruler.
 *  - Keeping the standards-compliant version isolated means
 *    `drawingExport` can stay backward-compatible and the new layout
 *    is opt-in via a flag.
 *
 * Geometry: 180 × 60 mm overall, three rows × variable column layout.
 * All sizes in millimetres; the SVG / DXF / PDF emitters render as-is.
 *
 *   ┌────────────────────────────────────────────────┬────────────┐
 *   │ TITLE                                          │ DWG#   REV │
 *   ├──────────────┬────────────┬────────────────────┼────────────┤
 *   │ Designer     │ Date       │ Approver  Date     │ Sheet  Fmt │
 *   ├──────────────┴────────────┴────────────────────┼────────────┤
 *   │ Owner / project · Material · Mass · Scale · …  │ Tol class  │
 *   └────────────────────────────────────────────────┴────────────┘
 *
 * The right-hand panel ("DWG# / REV / Sheet / Fmt / Tol") is the
 * standard 60mm wide column. Field labels are rendered in 2pt and
 * values in 3pt monospace so the inspector can read at A4 print scale.
 */

export interface TitleBlockIso7200Data {
  /** Drawing title (the part / assembly name). */
  title: string;
  /** Drawing number — required by ISO 7200. */
  drawingNumber: string;
  /** Revision letter (A, B, C...) or numeric. */
  revision: string;
  /** Designer / drawer name. */
  designer: string;
  /** Designer date in YYYY-MM-DD. */
  designerDate: string;
  /** Approver name. Optional but populated for any released drawing. */
  approver?: string;
  approverDate?: string;
  /** Sheet "n of N" — defaults to "1/1". */
  sheet?: string;
  /** Paper format (`A4`, `A3`, etc.). */
  format?: string;
  /** Material spec (`Mild Steel 1.5mm`, `AL6061-T6`, etc.). */
  material?: string;
  /** Computed or estimated mass in kg. */
  massKg?: number;
  /** Drawing scale, e.g. `1:2`. */
  scale?: string;
  /** Project / owner / company name (top-of-title-block branding). */
  owner?: string;
  /** General tolerance class per ISO 2768 (`f`, `m`, `c`, `v`). */
  toleranceClass?: 'f' | 'm' | 'c' | 'v';
}

export interface TitleBlockGeometry {
  /** Outer-rectangle origin in the drawing's user space (mm). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Discrete field rectangles for the renderer to fill in with text. */
  fields: TitleBlockField[];
  /** Internal partition lines that draw the column / row dividers. */
  partitions: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}

export interface TitleBlockField {
  /** Stable id matching one of the TitleBlockIso7200Data keys (plus a
   *  few synthetic ids like `tolerance` for derived fields). */
  id: string;
  /** Small label rendered at the top-left of the cell (`DESIGNER`, `DATE`). */
  label: string;
  /** Cell rectangle in user space (mm). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Font size to render the value in. */
  valueFontSize: number;
}

const W = 180;
const H = 60;
// Row heights — sum to H.
const R1 = 24; // Title row (large)
const R2 = 18; // Designer / approver row
const R3 = 18; // Material / mass / scale row
// Right-panel column width (drawing number + rev + sheet + format + tol).
const RIGHT_W = 60;
const LEFT_W = W - RIGHT_W;

/**
 * Build the geometry for an ISO 7200 title block anchored at the given
 * bottom-right corner of the sheet (drawingExport places it relative
 * to paperWidth/paperHeight). The returned shape is purely positional —
 * the SVG / PDF / DXF emitters consume `fields` + `partitions` to draw
 * cells and run text into them.
 */
export function buildIso7200Layout(
  bottomRight: { x: number; y: number },
): TitleBlockGeometry {
  const x = bottomRight.x - W;
  const y = bottomRight.y - H;

  // ── Row Y coordinates from top to bottom (y grows down) ──
  const yRow1Top = y;
  const yRow2Top = y + R1;
  const yRow3Top = y + R1 + R2;
  const yBottom  = y + H;

  // ── Left side, row 1: title spans full left width ──
  const fields: TitleBlockField[] = [
    {
      id: 'title',
      label: 'TITLE',
      x, y: yRow1Top,
      width: LEFT_W,
      height: R1,
      valueFontSize: 5,
    },
    // Row 2 left: designer | designerDate | approver | approverDate
    {
      id: 'designer',
      label: 'DESIGNER',
      x, y: yRow2Top,
      width: LEFT_W / 4,
      height: R2,
      valueFontSize: 3,
    },
    {
      id: 'designerDate',
      label: 'DATE',
      x: x + LEFT_W / 4, y: yRow2Top,
      width: LEFT_W / 4,
      height: R2,
      valueFontSize: 3,
    },
    {
      id: 'approver',
      label: 'APPROVER',
      x: x + (2 * LEFT_W) / 4, y: yRow2Top,
      width: LEFT_W / 4,
      height: R2,
      valueFontSize: 3,
    },
    {
      id: 'approverDate',
      label: 'DATE',
      x: x + (3 * LEFT_W) / 4, y: yRow2Top,
      width: LEFT_W / 4,
      height: R2,
      valueFontSize: 3,
    },
    // Row 3 left: owner · material · mass · scale (5 sub-cells)
    {
      id: 'owner',
      label: 'OWNER',
      x, y: yRow3Top,
      width: LEFT_W * 0.30,
      height: R3,
      valueFontSize: 2.5,
    },
    {
      id: 'material',
      label: 'MATERIAL',
      x: x + LEFT_W * 0.30, y: yRow3Top,
      width: LEFT_W * 0.30,
      height: R3,
      valueFontSize: 2.5,
    },
    {
      id: 'massKg',
      label: 'MASS (kg)',
      x: x + LEFT_W * 0.60, y: yRow3Top,
      width: LEFT_W * 0.20,
      height: R3,
      valueFontSize: 2.5,
    },
    {
      id: 'scale',
      label: 'SCALE',
      x: x + LEFT_W * 0.80, y: yRow3Top,
      width: LEFT_W * 0.20,
      height: R3,
      valueFontSize: 2.5,
    },
    // Right panel
    {
      id: 'drawingNumber',
      label: 'DWG NO.',
      x: x + LEFT_W, y: yRow1Top,
      width: RIGHT_W * 0.7,
      height: R1,
      valueFontSize: 4,
    },
    {
      id: 'revision',
      label: 'REV',
      x: x + LEFT_W + RIGHT_W * 0.7, y: yRow1Top,
      width: RIGHT_W * 0.3,
      height: R1,
      valueFontSize: 4,
    },
    {
      id: 'sheet',
      label: 'SHEET',
      x: x + LEFT_W, y: yRow2Top,
      width: RIGHT_W * 0.5,
      height: R2,
      valueFontSize: 2.5,
    },
    {
      id: 'format',
      label: 'FORMAT',
      x: x + LEFT_W + RIGHT_W * 0.5, y: yRow2Top,
      width: RIGHT_W * 0.5,
      height: R2,
      valueFontSize: 2.5,
    },
    {
      id: 'toleranceClass',
      label: 'GEN TOL (ISO 2768)',
      x: x + LEFT_W, y: yRow3Top,
      width: RIGHT_W,
      height: R3,
      valueFontSize: 2.5,
    },
  ];

  const partitions: Array<{ x1: number; y1: number; x2: number; y2: number }> = [
    // Row separators (horizontal)
    { x1: x, y1: yRow2Top, x2: x + W, y2: yRow2Top },
    { x1: x, y1: yRow3Top, x2: x + W, y2: yRow3Top },
    // Left / right column split (vertical, full height)
    { x1: x + LEFT_W, y1: y, x2: x + LEFT_W, y2: yBottom },
    // Row 2 left sub-dividers
    { x1: x + LEFT_W / 4, y1: yRow2Top, x2: x + LEFT_W / 4, y2: yRow3Top },
    { x1: x + 2 * LEFT_W / 4, y1: yRow2Top, x2: x + 2 * LEFT_W / 4, y2: yRow3Top },
    { x1: x + 3 * LEFT_W / 4, y1: yRow2Top, x2: x + 3 * LEFT_W / 4, y2: yRow3Top },
    // Row 3 left sub-dividers
    { x1: x + LEFT_W * 0.30, y1: yRow3Top, x2: x + LEFT_W * 0.30, y2: yBottom },
    { x1: x + LEFT_W * 0.60, y1: yRow3Top, x2: x + LEFT_W * 0.60, y2: yBottom },
    { x1: x + LEFT_W * 0.80, y1: yRow3Top, x2: x + LEFT_W * 0.80, y2: yBottom },
    // Right panel internal
    { x1: x + LEFT_W + RIGHT_W * 0.7, y1: yRow1Top, x2: x + LEFT_W + RIGHT_W * 0.7, y2: yRow2Top },
    { x1: x + LEFT_W + RIGHT_W * 0.5, y1: yRow2Top, x2: x + LEFT_W + RIGHT_W * 0.5, y2: yRow3Top },
  ];

  return { x, y, width: W, height: H, fields, partitions };
}

/** Resolve a field id to its string value from the data, with sane
 *  fallbacks. Returns empty string for unset optional fields. */
export function fieldValue(data: TitleBlockIso7200Data, fieldId: string): string {
  switch (fieldId) {
    case 'title':           return data.title;
    case 'drawingNumber':   return data.drawingNumber;
    case 'revision':        return data.revision;
    case 'designer':        return data.designer;
    case 'designerDate':    return data.designerDate;
    case 'approver':        return data.approver ?? '';
    case 'approverDate':    return data.approverDate ?? '';
    case 'sheet':           return data.sheet ?? '1/1';
    case 'format':          return data.format ?? '';
    case 'material':        return data.material ?? '';
    case 'massKg':          return Number.isFinite(data.massKg) ? `${data.massKg!.toFixed(2)}` : '';
    case 'scale':           return data.scale ?? '1:1';
    case 'owner':           return data.owner ?? '';
    case 'toleranceClass':  return data.toleranceClass ? `Class ${data.toleranceClass}` : '';
    default:                return '';
  }
}
