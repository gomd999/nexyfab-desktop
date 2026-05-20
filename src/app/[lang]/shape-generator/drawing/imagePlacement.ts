/**
 * imagePlacement.ts — Place raster images (logos, photos, isos) on
 * drawing sheets with auto-sized + auto-positioned layout.
 *
 * Common uses:
 *
 *   - Company logo in title block.
 *   - Reference photo for context.
 *   - Embedded isometric render.
 *   - QR code linking to PDM revision.
 *
 * Module supports:
 *
 *   - Anchor placement (8 corners + center).
 *   - Aspect-ratio-preserving fit-to-box.
 *   - Overlay vs background z-order.
 *   - Multiple images with optional non-overlap layout.
 */

export interface Vec2 { x: number; y: number }

export interface BBox {
  min: Vec2;
  max: Vec2;
}

export type Anchor = 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'center' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface ImageInput {
  id: string;
  /** Source URL or data URI. */
  src: string;
  /** Natural width × height in pixels. */
  naturalWidthPx: number;
  naturalHeightPx: number;
  /** Anchor on the sheet. */
  anchor: Anchor;
  /** Maximum size in mm — image is fit-to-this preserving aspect ratio. */
  maxWidthMm?: number;
  maxHeightMm?: number;
  /** Z-order. */
  zOrder?: number;
}

export interface PlacedImage {
  id: string;
  src: string;
  /** Bottom-left corner of placed image, mm. */
  origin: Vec2;
  widthMm: number;
  heightMm: number;
  zOrder: number;
}

export interface PlacementResult {
  placed: PlacedImage[];
  /** Images that couldn't fit. */
  rejected: Array<{ id: string; reason: string }>;
}

export interface PlacementOptions {
  /** Sheet usable area. */
  sheetBBox: BBox;
  /** Default max size if image doesn't specify. */
  defaultMaxMm: { width: number; height: number };
  /** Margin from sheet edges. */
  marginMm: number;
  /** Avoid overlap among placed images. */
  avoidOverlap: boolean;
}

export const DEFAULT_OPTIONS: PlacementOptions = {
  sheetBBox: { min: { x: 0, y: 0 }, max: { x: 297, y: 210 } },
  defaultMaxMm: { width: 50, height: 50 },
  marginMm: 5,
  avoidOverlap: true,
};

// ── Top-level entry ────────────────────────────────────────────

export function placeImages(images: ImageInput[], options: Partial<PlacementOptions> = {}): PlacementResult {
  const opts = { ...DEFAULT_OPTIONS, ...options, defaultMaxMm: { ...DEFAULT_OPTIONS.defaultMaxMm, ...options.defaultMaxMm } };
  const placed: PlacedImage[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  // Sort by z-order desc to give early items priority.
  const sorted = [...images].sort((a, b) => (b.zOrder ?? 0) - (a.zOrder ?? 0));

  for (const img of sorted) {
    const fit = fitToBox(img, opts);
    if (!fit) {
      rejected.push({ id: img.id, reason: 'dimensions invalid' });
      continue;
    }
    const origin = computeAnchorOrigin(fit.widthMm, fit.heightMm, img.anchor, opts);
    const bbox: BBox = {
      min: origin,
      max: { x: origin.x + fit.widthMm, y: origin.y + fit.heightMm },
    };
    if (opts.avoidOverlap && overlapsAnyPlaced(bbox, placed)) {
      rejected.push({ id: img.id, reason: 'overlaps existing image' });
      continue;
    }
    placed.push({
      id: img.id,
      src: img.src,
      origin,
      widthMm: fit.widthMm,
      heightMm: fit.heightMm,
      zOrder: img.zOrder ?? 0,
    });
  }

  // Sort by z desc (top of stack first).
  placed.sort((a, b) => b.zOrder - a.zOrder);

  return { placed, rejected };
}

// ── Fit-to-box ───────────────────────────────────────────────

function fitToBox(img: ImageInput, opts: PlacementOptions): { widthMm: number; heightMm: number } | null {
  if (img.naturalWidthPx <= 0 || img.naturalHeightPx <= 0) return null;
  const maxW = img.maxWidthMm ?? opts.defaultMaxMm.width;
  const maxH = img.maxHeightMm ?? opts.defaultMaxMm.height;
  const aspect = img.naturalWidthPx / img.naturalHeightPx;
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { widthMm: w, heightMm: h };
}

// ── Anchor positioning ───────────────────────────────────────

function computeAnchorOrigin(w: number, h: number, anchor: Anchor, opts: PlacementOptions): Vec2 {
  const { sheetBBox: sheet, marginMm: m } = opts;
  const sw = sheet.max.x - sheet.min.x;
  const sh = sheet.max.y - sheet.min.y;
  let x = sheet.min.x;
  let y = sheet.min.y;
  switch (anchor) {
    case 'top-left':       x = sheet.min.x + m;            y = sheet.max.y - h - m; break;
    case 'top-center':     x = sheet.min.x + (sw - w) / 2; y = sheet.max.y - h - m; break;
    case 'top-right':      x = sheet.max.x - w - m;        y = sheet.max.y - h - m; break;
    case 'middle-left':    x = sheet.min.x + m;            y = sheet.min.y + (sh - h) / 2; break;
    case 'center':         x = sheet.min.x + (sw - w) / 2; y = sheet.min.y + (sh - h) / 2; break;
    case 'middle-right':   x = sheet.max.x - w - m;        y = sheet.min.y + (sh - h) / 2; break;
    case 'bottom-left':    x = sheet.min.x + m;            y = sheet.min.y + m; break;
    case 'bottom-center':  x = sheet.min.x + (sw - w) / 2; y = sheet.min.y + m; break;
    case 'bottom-right':   x = sheet.max.x - w - m;        y = sheet.min.y + m; break;
  }
  return { x, y };
}

function overlapsAnyPlaced(bbox: BBox, placed: PlacedImage[]): boolean {
  for (const p of placed) {
    const other: BBox = {
      min: p.origin,
      max: { x: p.origin.x + p.widthMm, y: p.origin.y + p.heightMm },
    };
    if (bbox.min.x < other.max.x && bbox.max.x > other.min.x &&
        bbox.min.y < other.max.y && bbox.max.y > other.min.y) return true;
  }
  return false;
}

// ── Summary ────────────────────────────────────────────────────

export interface PlacementSummary {
  placedCount: number;
  rejectedCount: number;
  totalImageAreaMm2: number;
  sheetAreaCoveredFraction: number;
}

export function summarize(result: PlacementResult, sheetBBox: BBox): PlacementSummary {
  const totalArea = result.placed.reduce((s, p) => s + p.widthMm * p.heightMm, 0);
  const sheetArea = (sheetBBox.max.x - sheetBBox.min.x) * (sheetBBox.max.y - sheetBBox.min.y);
  return {
    placedCount: result.placed.length,
    rejectedCount: result.rejected.length,
    totalImageAreaMm2: totalArea,
    sheetAreaCoveredFraction: sheetArea > 0 ? totalArea / sheetArea : 0,
  };
}
