/**
 * autoViews.ts — Automatic multi-view + section view layout for drawings.
 *
 * SolidWorks "Drawing → Insert → Standard 3 View" places front/top/
 * right (third-angle) or front/top/left (first-angle) on the sheet,
 * scaled so the part fits with the right inter-view spacing. This
 * module is the layout math.
 *
 * Capabilities:
 *   - **Auto-scale** — pick the largest scale that fits all required
 *     views on the sheet with the standard inter-view gap.
 *   - **First-angle vs third-angle** projection — KR/JP/EU default
 *     to first-angle; US to third-angle.
 *   - **Iso view** — 30°/30° trimetric placement.
 *   - **Section views** — take a cut plane through the part + project
 *     the resulting 2D outline onto the sheet, with the standard
 *     section-line indicator on the parent view.
 *   - **Detail view** — zoom box + circle indicator + scale multiplier.
 *
 * Output is sheet-coordinate ready (mm from sheet origin). Renderer
 * uses these placements + the existing `renderTitleBlockSvg`.
 */

import type { SheetSize } from './titleBlocks';
import { SHEET_SIZES_MM } from './titleBlocks';

export type ProjectionAngle = 'first' | 'third';

export type ViewKind = 'front' | 'top' | 'bottom' | 'left' | 'right' | 'back' | 'iso' | 'section' | 'detail';

export interface Bbox3 {
  width: number;
  depth: number;
  height: number;
}

export interface ViewPlacement {
  kind: ViewKind;
  /** Lower-left corner on sheet (mm). */
  x: number;
  y: number;
  /** Drawn extent (mm). */
  widthMm: number;
  heightMm: number;
  /** Label drawn under the view. */
  label?: string;
  /** Scale at which this view is rendered (1.0 = real size). */
  scale: number;
}

export interface ViewLayout {
  views: ViewPlacement[];
  /** Common scale applied to all standard views. */
  scale: number;
  /** Total bounding box used. */
  contentBbox: { minX: number; minY: number; maxX: number; maxY: number };
}

// Standard inter-view gap (mm).
const VIEW_GAP_MM = 30;

/** Project the 3D bbox to a 2D view by picking the right pair of axes. */
function projectBbox(bbox: Bbox3, kind: ViewKind): { widthMm: number; heightMm: number } {
  switch (kind) {
    case 'front':
    case 'back':
      return { widthMm: bbox.width, heightMm: bbox.height };
    case 'top':
    case 'bottom':
      return { widthMm: bbox.width, heightMm: bbox.depth };
    case 'left':
    case 'right':
      return { widthMm: bbox.depth, heightMm: bbox.height };
    case 'iso': {
      // Iso projection extent: bbox dimensions rotated by 30°/30°.
      const w = (bbox.width + bbox.depth) * Math.cos(Math.PI / 6);
      const h = (bbox.width + bbox.depth) * Math.sin(Math.PI / 6) + bbox.height;
      return { widthMm: w, heightMm: h };
    }
    default:
      return { widthMm: bbox.width, heightMm: bbox.height };
  }
}

/** Pick the largest "round" scale that fits the layout on the sheet. */
const STANDARD_SCALES = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];

function pickScale(
  bbox: Bbox3,
  sheet: { width: number; height: number },
  views: ViewKind[],
  marginMm: number,
): number {
  const totalWidth = (kind: ViewKind) => projectBbox(bbox, kind).widthMm;
  const totalHeight = (kind: ViewKind) => projectBbox(bbox, kind).heightMm;
  const availableW = sheet.width - 2 * marginMm;
  const availableH = sheet.height - 2 * marginMm;

  for (const s of STANDARD_SCALES) {
    // Estimate total content extent given views.
    let neededW = 0;
    let neededH = 0;
    if (views.includes('front') && views.includes('right')) {
      neededW = (totalWidth('front') + totalWidth('right')) * s + VIEW_GAP_MM;
    } else if (views.length > 0) {
      neededW = totalWidth(views[0]!) * s;
    }
    if (views.includes('front') && views.includes('top')) {
      neededH = (totalHeight('front') + totalHeight('top')) * s + VIEW_GAP_MM;
    } else if (views.length > 0) {
      neededH = totalHeight(views[0]!) * s;
    }
    if (neededW <= availableW && neededH <= availableH) return s;
  }
  return 0.01;
}

// ── Three-view layout ────────────────────────────────────────────

export function layoutThreeView(
  bbox: Bbox3,
  sheetSize: SheetSize,
  projection: ProjectionAngle = 'third',
  marginMm: number = 20,
): ViewLayout {
  const sheet = SHEET_SIZES_MM[sheetSize];
  const views: ViewKind[] = projection === 'third'
    ? ['front', 'top', 'right']
    : ['front', 'top', 'left'];

  const scale = pickScale(bbox, sheet, views, marginMm);
  const placements: ViewPlacement[] = [];

  const front = projectBbox(bbox, 'front');
  const top = projectBbox(bbox, 'top');
  const side = projectBbox(bbox, projection === 'third' ? 'right' : 'left');

  // Front in lower-left of usable area.
  const frontX = marginMm;
  // Third-angle: top is ABOVE front; first-angle: top is BELOW front.
  // SolidWorks convention regardless — top of the part appears in the
  // upper view in third-angle, lower view in first-angle.
  let frontY: number, topY: number;
  if (projection === 'third') {
    frontY = marginMm;
    topY = frontY + front.heightMm * scale + VIEW_GAP_MM;
  } else {
    topY = marginMm;
    frontY = topY + top.heightMm * scale + VIEW_GAP_MM;
  }

  placements.push({
    kind: 'front', x: frontX, y: frontY,
    widthMm: front.widthMm * scale, heightMm: front.heightMm * scale,
    scale, label: 'Front',
  });
  placements.push({
    kind: 'top', x: frontX, y: topY,
    widthMm: top.widthMm * scale, heightMm: top.heightMm * scale,
    scale, label: 'Top',
  });
  // Side view to the right (third-angle) or left of front (first-angle).
  const sideKind: ViewKind = projection === 'third' ? 'right' : 'left';
  const sideX = projection === 'third'
    ? frontX + front.widthMm * scale + VIEW_GAP_MM
    : frontX - (side.widthMm * scale + VIEW_GAP_MM);
  placements.push({
    kind: sideKind, x: sideX, y: frontY,
    widthMm: side.widthMm * scale, heightMm: side.heightMm * scale,
    scale,
    label: sideKind === 'right' ? 'Right' : 'Left',
  });

  const minX = Math.min(...placements.map(p => p.x));
  const minY = Math.min(...placements.map(p => p.y));
  const maxX = Math.max(...placements.map(p => p.x + p.widthMm));
  const maxY = Math.max(...placements.map(p => p.y + p.heightMm));

  return { views: placements, scale, contentBbox: { minX, minY, maxX, maxY } };
}

// ── Iso view as 4th view ─────────────────────────────────────────

/** Add an iso view to an existing layout in the empty quadrant. */
export function addIsoView(
  layout: ViewLayout,
  bbox: Bbox3,
  sheetSize: SheetSize,
  marginMm: number = 20,
): ViewLayout {
  const sheet = SHEET_SIZES_MM[sheetSize];
  const isoExtent = projectBbox(bbox, 'iso');
  const w = isoExtent.widthMm * layout.scale;
  const h = isoExtent.heightMm * layout.scale;
  // Place in the empty quadrant — upper-right by default (third-angle layout).
  // Find empty space.
  const candidateX = layout.contentBbox.maxX + VIEW_GAP_MM;
  const candidateY = layout.contentBbox.maxY - h;
  // If doesn't fit, try below the existing top view.
  const x = candidateX + w + marginMm <= sheet.width ? candidateX : marginMm;
  const y = candidateX + w + marginMm <= sheet.width
    ? candidateY
    : layout.contentBbox.maxY + VIEW_GAP_MM;
  const iso: ViewPlacement = {
    kind: 'iso', x, y,
    widthMm: w, heightMm: h,
    scale: layout.scale, label: 'Iso',
  };
  return {
    views: [...layout.views, iso],
    scale: layout.scale,
    contentBbox: {
      minX: Math.min(layout.contentBbox.minX, x),
      minY: Math.min(layout.contentBbox.minY, y),
      maxX: Math.max(layout.contentBbox.maxX, x + w),
      maxY: Math.max(layout.contentBbox.maxY, y + h),
    },
  };
}

// ── Section view ─────────────────────────────────────────────────

export interface SectionSpec {
  /** Label (A, B, ...). */
  label: string;
  /** Cut-plane normal in part-local axes. */
  cutNormal: [number, number, number];
  /** Position of the cut plane along its normal (mm from origin). */
  cutOffset: number;
  /** Which parent view the section line is drawn on. */
  parentView: ViewKind;
  /** Optional scale multiplier — defaults to layout scale. */
  scaleMultiplier?: number;
}

/** Compute the 2D extent of a section view by projecting the cross-
 *  section's bbox onto the section plane. */
export function layoutSectionView(
  bbox: Bbox3,
  layout: ViewLayout,
  spec: SectionSpec,
  sheetSize: SheetSize,
  marginMm: number = 20,
): ViewLayout {
  const sheet = SHEET_SIZES_MM[sheetSize];
  const multiplier = spec.scaleMultiplier ?? 1;
  const effectiveScale = layout.scale * multiplier;

  // The section view's extent is the cross-section bbox in the plane.
  // Simplification: for a cut perpendicular to one axis, extent is the
  // bbox of the other two axes.
  const [nx, ny, nz] = spec.cutNormal;
  const absN = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
  const axis = absN.indexOf(Math.max(...absN));
  let widthMm: number, heightMm: number;
  if (axis === 0)      { widthMm = bbox.depth;  heightMm = bbox.height; }
  else if (axis === 1) { widthMm = bbox.width;  heightMm = bbox.height; }
  else                 { widthMm = bbox.width;  heightMm = bbox.depth; }
  widthMm *= effectiveScale;
  heightMm *= effectiveScale;

  // Place to the right of the layout, or wrap to next row.
  let x = layout.contentBbox.maxX + VIEW_GAP_MM;
  let y = layout.contentBbox.minY;
  if (x + widthMm + marginMm > sheet.width) {
    x = marginMm;
    y = layout.contentBbox.maxY + VIEW_GAP_MM;
  }

  const section: ViewPlacement = {
    kind: 'section', x, y, widthMm, heightMm,
    scale: effectiveScale,
    label: `Section ${spec.label}-${spec.label}`,
  };
  return {
    views: [...layout.views, section],
    scale: layout.scale,
    contentBbox: {
      minX: Math.min(layout.contentBbox.minX, x),
      minY: Math.min(layout.contentBbox.minY, y),
      maxX: Math.max(layout.contentBbox.maxX, x + widthMm),
      maxY: Math.max(layout.contentBbox.maxY, y + heightMm),
    },
  };
}

// ── Detail view ──────────────────────────────────────────────────

export interface DetailSpec {
  /** Label (A, B, ...). */
  label: string;
  /** Zoom box on parent view (sheet coords, mm). */
  parentBox: { x: number; y: number; widthMm: number; heightMm: number };
  /** Scale multiplier (e.g. 2× → twice the parent scale). */
  scaleMultiplier: number;
}

export function layoutDetailView(
  layout: ViewLayout,
  spec: DetailSpec,
  sheetSize: SheetSize,
  marginMm: number = 20,
): ViewLayout {
  const sheet = SHEET_SIZES_MM[sheetSize];
  const widthMm = spec.parentBox.widthMm * spec.scaleMultiplier;
  const heightMm = spec.parentBox.heightMm * spec.scaleMultiplier;
  let x = layout.contentBbox.maxX + VIEW_GAP_MM;
  let y = layout.contentBbox.minY;
  if (x + widthMm + marginMm > sheet.width) {
    x = marginMm;
    y = layout.contentBbox.maxY + VIEW_GAP_MM;
  }
  const detail: ViewPlacement = {
    kind: 'detail', x, y, widthMm, heightMm,
    scale: layout.scale * spec.scaleMultiplier,
    label: `Detail ${spec.label} (${spec.scaleMultiplier}×)`,
  };
  return {
    views: [...layout.views, detail],
    scale: layout.scale,
    contentBbox: {
      minX: Math.min(layout.contentBbox.minX, x),
      minY: Math.min(layout.contentBbox.minY, y),
      maxX: Math.max(layout.contentBbox.maxX, x + widthMm),
      maxY: Math.max(layout.contentBbox.maxY, y + heightMm),
    },
  };
}
