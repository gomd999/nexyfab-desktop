/**
 * sheetLayout.ts — Multi-view auto-placement on an ISO drawing sheet.
 *
 * Given a part's bbox + a list of desired views (front/top/side/iso),
 * compute a consistent scale + view origins on the sheet such that:
 *
 *   - All views share the same scale (front/top/side aligned in
 *     third-angle projection — top above front, side to the right).
 *   - Views fit within the printable area minus a title-block margin.
 *   - Isometric view goes in the upper-right quadrant.
 *
 * The scale is chosen automatically from a standard scale ladder
 * (1:1, 1:2, 1:5, 1:10, 1:20, 1:50, 1:100). We pick the largest
 * scale that still fits all views.
 */

export type SheetSize = 'A4' | 'A3' | 'A2' | 'A1';

export type ViewKind = 'front' | 'top' | 'side' | 'iso' | 'detail';

export interface PartBbox {
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export interface SheetLayoutInput {
  sheet: SheetSize;
  /** Desired orientation. Landscape default. */
  orientation?: 'landscape' | 'portrait';
  bbox: PartBbox;
  views: ViewKind[];
  /** Reserve a strip on the right for the title block. */
  titleBlockWidthMm?: number;
  /** Print margin around the sheet edge (mm). */
  marginMm?: number;
}

export interface ViewPlacement {
  kind: ViewKind;
  originXmm: number;
  originYmm: number;
  /** Visible footprint (mm) at the chosen scale. */
  footprintMm: { w: number; h: number };
}

export interface SheetLayout {
  sheetWidthMm: number;
  sheetHeightMm: number;
  /** Chosen scale denominator. e.g. 5 → "1:5". */
  scaleDenominator: number;
  views: ViewPlacement[];
  /** True when no scale in the ladder fit all views. */
  overflowed: boolean;
}

const SCALE_LADDER = [1, 2, 5, 10, 20, 50, 100, 200];

const SHEET_DIM: Record<SheetSize, { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
  A1: { w: 841, h: 594 },
};

/** Footprint of a view kind given the part bbox and orientation. */
function viewFootprint(kind: ViewKind, b: PartBbox): { w: number; h: number } {
  switch (kind) {
    case 'front':  return { w: b.widthMm,  h: b.heightMm };
    case 'top':    return { w: b.widthMm,  h: b.depthMm };
    case 'side':   return { w: b.depthMm,  h: b.heightMm };
    case 'iso':    return { w: b.widthMm * 0.866 + b.depthMm * 0.866, h: b.heightMm + b.depthMm * 0.5 };
    case 'detail': return { w: b.widthMm * 0.5, h: b.heightMm * 0.5 };
  }
}

export function planSheetLayout(input: SheetLayoutInput): SheetLayout {
  const orient = input.orientation ?? 'landscape';
  const dims = SHEET_DIM[input.sheet];
  const w = orient === 'landscape' ? dims.w : dims.h;
  const h = orient === 'landscape' ? dims.h : dims.w;
  const margin = input.marginMm ?? 10;
  const tbWidth = input.titleBlockWidthMm ?? 60;
  const usableW = w - 2 * margin - tbWidth;
  const usableH = h - 2 * margin;

  // Compute footprint per view at 1:1.
  const footprints = input.views.map(v => ({ kind: v, ...viewFootprint(v, input.bbox) }));

  // Try each scale from largest (1:1) to smallest.
  for (const denom of SCALE_LADDER) {
    const scaled = footprints.map(f => ({
      kind: f.kind,
      w: f.w / denom,
      h: f.h / denom,
    }));
    if (fitsLayout(scaled, usableW, usableH)) {
      const placements = placeViews(scaled, usableW, usableH, margin);
      return {
        sheetWidthMm: w,
        sheetHeightMm: h,
        scaleDenominator: denom,
        views: placements,
        overflowed: false,
      };
    }
  }
  // Nothing fit — return best-effort at 1:200.
  const denom = SCALE_LADDER[SCALE_LADDER.length - 1]!;
  const scaled = footprints.map(f => ({ kind: f.kind, w: f.w / denom, h: f.h / denom }));
  return {
    sheetWidthMm: w,
    sheetHeightMm: h,
    scaleDenominator: denom,
    views: placeViews(scaled, usableW, usableH, margin),
    overflowed: true,
  };
}

/** Quick fit check: third-angle layout needs top above front, side to
 *  the right of front, iso in upper-right quadrant. */
function fitsLayout(
  scaled: Array<{ kind: ViewKind; w: number; h: number }>,
  usableW: number, usableH: number,
): boolean {
  const front = scaled.find(s => s.kind === 'front');
  const top = scaled.find(s => s.kind === 'top');
  const side = scaled.find(s => s.kind === 'side');
  const iso = scaled.find(s => s.kind === 'iso');
  let neededW = front?.w ?? 0;
  if (side) neededW += side.w + 10;
  if (iso) neededW = Math.max(neededW, (front?.w ?? 0) + iso.w + 10);
  let neededH = front?.h ?? 0;
  if (top) neededH += top.h + 10;
  if (iso) neededH = Math.max(neededH, (top?.h ?? 0) + iso.h + 10);
  return neededW <= usableW && neededH <= usableH;
}

function placeViews(
  scaled: Array<{ kind: ViewKind; w: number; h: number }>,
  usableW: number, usableH: number,
  margin: number,
): ViewPlacement[] {
  const placements: ViewPlacement[] = [];
  const gap = 10;
  // Anchor front view at bottom-left of usable area.
  let frontOriginX = margin;
  let frontOriginY = margin + (scaled.find(s => s.kind === 'top')?.h ?? 0) + gap;
  for (const v of scaled) {
    switch (v.kind) {
      case 'front':
        placements.push({ kind: 'front', originXmm: frontOriginX, originYmm: frontOriginY, footprintMm: { w: v.w, h: v.h } });
        break;
      case 'top': {
        const front = scaled.find(s => s.kind === 'front');
        placements.push({
          kind: 'top',
          originXmm: frontOriginX,
          originYmm: frontOriginY - v.h - gap,
          footprintMm: { w: v.w, h: v.h },
        });
        break;
      }
      case 'side': {
        const front = scaled.find(s => s.kind === 'front');
        placements.push({
          kind: 'side',
          originXmm: frontOriginX + (front?.w ?? 0) + gap,
          originYmm: frontOriginY,
          footprintMm: { w: v.w, h: v.h },
        });
        break;
      }
      case 'iso': {
        // Top-right quadrant.
        placements.push({
          kind: 'iso',
          originXmm: usableW - v.w + margin,
          originYmm: margin,
          footprintMm: { w: v.w, h: v.h },
        });
        break;
      }
      case 'detail': {
        // Below side view.
        const front = scaled.find(s => s.kind === 'front');
        placements.push({
          kind: 'detail',
          originXmm: frontOriginX + (front?.w ?? 0) + gap,
          originYmm: frontOriginY + (front?.h ?? 0) + gap,
          footprintMm: { w: v.w, h: v.h },
        });
        break;
      }
    }
  }
  return placements;
}
