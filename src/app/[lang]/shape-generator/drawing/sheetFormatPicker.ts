/**
 * sheetFormatPicker.ts — Auto-pick the smallest standard drawing
 * sheet that fits the views + title block + margins.
 *
 * Supports ISO 216 (A0..A4) plus ANSI (A..E). Each format has a
 * landscape/portrait pair. Picker:
 *
 *   1. Computes the bounding box of all drawing views in mm.
 *   2. Adds title-block + revision-block + border margins.
 *   3. Returns the smallest standard format that contains it.
 *   4. Suggests orientation (landscape if wider, portrait if taller).
 *   5. Computes packing density (used / sheet area).
 */

export type IsoFormat = 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
export type AnsiFormat = 'ANSI-A' | 'ANSI-B' | 'ANSI-C' | 'ANSI-D' | 'ANSI-E';

export interface SheetSize {
  format: IsoFormat | AnsiFormat;
  widthMm: number;
  heightMm: number;
}

export const ISO_SIZES: SheetSize[] = [
  { format: 'A4', widthMm: 297, heightMm: 210 },
  { format: 'A3', widthMm: 420, heightMm: 297 },
  { format: 'A2', widthMm: 594, heightMm: 420 },
  { format: 'A1', widthMm: 841, heightMm: 594 },
  { format: 'A0', widthMm: 1189, heightMm: 841 },
];

export const ANSI_SIZES: SheetSize[] = [
  { format: 'ANSI-A', widthMm: 279.4, heightMm: 215.9 },
  { format: 'ANSI-B', widthMm: 431.8, heightMm: 279.4 },
  { format: 'ANSI-C', widthMm: 558.8, heightMm: 431.8 },
  { format: 'ANSI-D', widthMm: 863.6, heightMm: 558.8 },
  { format: 'ANSI-E', widthMm: 1117.6, heightMm: 863.6 },
];

export interface ViewBounds {
  widthMm: number;
  heightMm: number;
}

export interface PickOptions {
  /** Margin on each side (mm). */
  marginMm: number;
  /** Title block width (mm). */
  titleBlockWidthMm: number;
  /** Title block height (mm). */
  titleBlockHeightMm: number;
  /** Standards system. */
  standard: 'iso' | 'ansi';
  /** Whether to allow rotating the content to fit. */
  allowRotation: boolean;
}

export const DEFAULT_OPTIONS: PickOptions = {
  marginMm: 10,
  titleBlockWidthMm: 170,
  titleBlockHeightMm: 60,
  standard: 'iso',
  allowRotation: true,
};

export interface SheetSelection {
  size: SheetSize;
  orientation: 'landscape' | 'portrait';
  /** Used drawing area (after margins / title block). */
  usableWidthMm: number;
  usableHeightMm: number;
  packingDensity: number;
  fits: boolean;
}

// ── Top-level entry ────────────────────────────────────────────

export function pickSheet(views: ViewBounds, options: Partial<PickOptions> = {}): SheetSelection {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sizes = opts.standard === 'iso' ? ISO_SIZES : ANSI_SIZES;
  const needed = computeRequired(views, opts);

  // Try each size in ascending order, both orientations.
  for (const size of sizes) {
    // Landscape (size as-is).
    if (size.widthMm >= needed.w && size.heightMm >= needed.h) {
      return buildSelection(size, 'landscape', needed, opts);
    }
    // Portrait (swap).
    if (opts.allowRotation && size.heightMm >= needed.w && size.widthMm >= needed.h) {
      return buildSelection(size, 'portrait', needed, opts);
    }
  }

  // Doesn't fit anywhere — return largest with fits=false.
  const biggest = sizes[sizes.length - 1]!;
  return {
    size: biggest,
    orientation: needed.w >= needed.h ? 'landscape' : 'portrait',
    usableWidthMm: biggest.widthMm - 2 * opts.marginMm,
    usableHeightMm: biggest.heightMm - 2 * opts.marginMm - opts.titleBlockHeightMm,
    packingDensity: 0,
    fits: false,
  };
}

function computeRequired(views: ViewBounds, opts: PickOptions): { w: number; h: number } {
  // Minimum needed sheet = views + margins + title block area (assumed below views).
  const w = views.widthMm + 2 * opts.marginMm;
  const h = views.heightMm + 2 * opts.marginMm + opts.titleBlockHeightMm;
  return { w, h };
}

function buildSelection(size: SheetSize, orientation: 'landscape' | 'portrait', needed: { w: number; h: number }, opts: PickOptions): SheetSelection {
  const effectiveWidth = orientation === 'landscape' ? size.widthMm : size.heightMm;
  const effectiveHeight = orientation === 'landscape' ? size.heightMm : size.widthMm;
  const usableW = effectiveWidth - 2 * opts.marginMm;
  const usableH = effectiveHeight - 2 * opts.marginMm - opts.titleBlockHeightMm;
  const density = (needed.w * needed.h) / (effectiveWidth * effectiveHeight);
  return {
    size,
    orientation,
    usableWidthMm: usableW,
    usableHeightMm: usableH,
    packingDensity: density,
    fits: true,
  };
}

// ── Multi-view layout estimator ───────────────────────────────

export interface MultiView {
  id: string;
  widthMm: number;
  heightMm: number;
}

export function estimateMultiViewBounds(views: MultiView[], gapMm: number = 20): ViewBounds {
  if (views.length === 0) return { widthMm: 0, heightMm: 0 };
  // Pack as a 2-column grid by default.
  const cols = Math.ceil(Math.sqrt(views.length));
  let row = 0;
  let col = 0;
  let maxW = 0;
  let maxH = 0;
  let rowMaxH = 0;
  const rowWidths: number[] = [];
  let currentRowWidth = 0;
  for (const v of views) {
    currentRowWidth += v.widthMm + gapMm;
    if (v.heightMm > rowMaxH) rowMaxH = v.heightMm;
    col++;
    if (col >= cols) {
      rowWidths.push(currentRowWidth);
      maxH += rowMaxH + gapMm;
      rowMaxH = 0;
      currentRowWidth = 0;
      col = 0;
      row++;
    }
  }
  if (col > 0) {
    rowWidths.push(currentRowWidth);
    maxH += rowMaxH;
  }
  for (const w of rowWidths) if (w > maxW) maxW = w;
  return { widthMm: maxW, heightMm: maxH };
}

// ── Summary ────────────────────────────────────────────────────

export interface SheetSummary {
  format: string;
  orientation: 'landscape' | 'portrait';
  fits: boolean;
  packingDensity: number;
  usableAreaMm2: number;
}

export function summarize(selection: SheetSelection): SheetSummary {
  return {
    format: selection.size.format,
    orientation: selection.orientation,
    fits: selection.fits,
    packingDensity: selection.packingDensity,
    usableAreaMm2: selection.usableWidthMm * selection.usableHeightMm,
  };
}
