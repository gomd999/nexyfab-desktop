/**
 * thirdAngleLayoutBuilder.ts — Build a standard third-angle
 * projection drawing layout (front + top + right views aligned
 * to share extension lines).
 *
 * Third-angle projection (used in USA, Korea, Japan, Australia):
 *
 *   - **Top view** sits *above* the front view (the part is rotated
 *     down).
 *   - **Right view** sits *to the right of* the front view (rotated
 *     around its right edge).
 *
 * First-angle projection (used in Europe) flips the views. This
 * module supports both.
 *
 * Given a part bbox, the module places the 3 view frames on a sheet
 * with consistent scale + proper alignment + a margin around each.
 */

export interface Vec2 { x: number; y: number }

export interface BBox3D {
  /** Width along X. */
  widthMm: number;
  /** Depth along Y. */
  depthMm: number;
  /** Height along Z. */
  heightMm: number;
}

export interface ViewFrame {
  /** View name. */
  view: 'front' | 'top' | 'right' | 'left' | 'bottom' | 'back' | 'iso';
  /** Origin (bottom-left of view bbox). */
  origin: Vec2;
  /** View width on sheet. */
  widthMm: number;
  /** View height on sheet. */
  heightMm: number;
  /** Scale (drawing mm / part mm). */
  scale: number;
}

export interface LayoutResult {
  views: ViewFrame[];
  /** Selected scale (same for all 3 views). */
  scale: number;
  /** Sheet bbox used. */
  sheetBBox: { width: number; height: number };
}

export interface LayoutOptions {
  /** Sheet usable width (mm). */
  sheetWidthMm: number;
  /** Sheet usable height (mm). */
  sheetHeightMm: number;
  /** Projection convention. */
  projection: 'third-angle' | 'first-angle';
  /** Margin between views, mm. */
  viewSpacingMm: number;
  /** Margin from sheet edge, mm. */
  sheetMarginMm: number;
  /** Optional isometric view in upper right. */
  includeIsometric: boolean;
}

export const DEFAULT_OPTIONS: LayoutOptions = {
  sheetWidthMm: 297,
  sheetHeightMm: 210,
  projection: 'third-angle',
  viewSpacingMm: 20,
  sheetMarginMm: 15,
  includeIsometric: true,
};

const STANDARD_SCALES = [1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];

// ── Top-level entry ────────────────────────────────────────────

export function buildLayout(bbox: BBox3D, options: Partial<LayoutOptions> = {}): LayoutResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const usableWidth = opts.sheetWidthMm - 2 * opts.sheetMarginMm;
  const usableHeight = opts.sheetHeightMm - 2 * opts.sheetMarginMm;

  // Determine scale that fits all 3 views.
  const scale = pickScale(bbox, usableWidth, usableHeight, opts);

  // View dimensions at the chosen scale.
  const frontW = bbox.widthMm * scale;
  const frontH = bbox.heightMm * scale;
  const topW = bbox.widthMm * scale;
  const topH = bbox.depthMm * scale;
  const rightW = bbox.depthMm * scale;
  const rightH = bbox.heightMm * scale;

  // Anchor origin: bottom-left of front view.
  const frontX = opts.sheetMarginMm;
  const frontY = opts.sheetMarginMm;

  const views: ViewFrame[] = [
    { view: 'front', origin: { x: frontX, y: frontY }, widthMm: frontW, heightMm: frontH, scale },
  ];

  if (opts.projection === 'third-angle') {
    // Top above front.
    views.push({
      view: 'top',
      origin: { x: frontX, y: frontY + frontH + opts.viewSpacingMm },
      widthMm: topW,
      heightMm: topH,
      scale,
    });
    // Right to right of front.
    views.push({
      view: 'right',
      origin: { x: frontX + frontW + opts.viewSpacingMm, y: frontY },
      widthMm: rightW,
      heightMm: rightH,
      scale,
    });
  } else {
    // First-angle: top below front, left to right of front.
    views.push({
      view: 'top',
      origin: { x: frontX, y: frontY - opts.viewSpacingMm - topH },
      widthMm: topW,
      heightMm: topH,
      scale,
    });
    views.push({
      view: 'left',
      origin: { x: frontX + frontW + opts.viewSpacingMm, y: frontY },
      widthMm: rightW,
      heightMm: rightH,
      scale,
    });
  }

  if (opts.includeIsometric) {
    const isoSide = Math.min(rightW, rightH) * 0.8;
    views.push({
      view: 'iso',
      origin: {
        x: frontX + frontW + opts.viewSpacingMm,
        y: frontY + frontH + opts.viewSpacingMm,
      },
      widthMm: isoSide,
      heightMm: isoSide,
      scale,
    });
  }

  return {
    views,
    scale,
    sheetBBox: { width: opts.sheetWidthMm, height: opts.sheetHeightMm },
  };
}

// ── Scale picker ─────────────────────────────────────────────

function pickScale(bbox: BBox3D, usableWidth: number, usableHeight: number, opts: LayoutOptions): number {
  // Required width = front + spacing + right (if 3rd angle).
  // Required height = front + spacing + top.
  for (const candidate of STANDARD_SCALES) {
    const totalWidth = bbox.widthMm * candidate + opts.viewSpacingMm + bbox.depthMm * candidate;
    const totalHeight = bbox.heightMm * candidate + opts.viewSpacingMm + bbox.depthMm * candidate;
    if (totalWidth <= usableWidth && totalHeight <= usableHeight) {
      return candidate;
    }
  }
  return STANDARD_SCALES[STANDARD_SCALES.length - 1]!;
}

// ── Validation ────────────────────────────────────────────────

export interface LayoutValidation {
  isValid: boolean;
  issues: string[];
  /** Views that overshoot the sheet bounds. */
  outOfBoundsViews: string[];
}

export function validateLayout(result: LayoutResult, opts: Partial<LayoutOptions> = {}): LayoutValidation {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const issues: string[] = [];
  const outOfBounds: string[] = [];
  for (const v of result.views) {
    if (v.origin.x < 0 || v.origin.y < 0 ||
        v.origin.x + v.widthMm > o.sheetWidthMm ||
        v.origin.y + v.heightMm > o.sheetHeightMm) {
      outOfBounds.push(v.view);
    }
  }
  if (outOfBounds.length > 0) {
    issues.push(`${outOfBounds.length} view(s) overflow sheet bounds.`);
  }
  return { isValid: issues.length === 0, issues, outOfBoundsViews: outOfBounds };
}

// ── Summary ────────────────────────────────────────────────────

export interface LayoutSummary {
  viewCount: number;
  scale: number;
  totalDrawnAreaMm2: number;
  sheetCoverageFraction: number;
}

export function summarize(result: LayoutResult): LayoutSummary {
  const totalArea = result.views.reduce((s, v) => s + v.widthMm * v.heightMm, 0);
  const sheetArea = result.sheetBBox.width * result.sheetBBox.height;
  return {
    viewCount: result.views.length,
    scale: result.scale,
    totalDrawnAreaMm2: totalArea,
    sheetCoverageFraction: sheetArea > 0 ? totalArea / sheetArea : 0,
  };
}
