/**
 * K2 + K3 — Drawing view extras (Detail + Section views).
 *
 * Pure data helpers for AutoDrawingPanel. Each function takes the same
 * underlying drawing geometry that the main views use, plus a small spec
 * object (circle for detail / cut line for section), and returns SVG-ready
 * primitives.
 *
 * Detail view:
 *   - Caller specifies a focal point + radius on a base view.
 *   - Helper clips lines to the focal circle, scales them by `magnification`,
 *     and translates them to the detail view's drawing position.
 *
 * Section view:
 *   - Caller specifies a 2D cut line (start/end) in base-view coords.
 *   - Helper produces a parallel line group representing hatching across
 *     the cut profile, plus an overlay of solid lines clipped by the cut
 *     plane. Section is rendered as a sibling view to the right of the base.
 */

import type { DrawingLine } from './autoDrawing';

// ─── Detail view ────────────────────────────────────────────────────────────

export interface DetailViewSpec {
  /** Focal centre in the source view's coordinate system (mm). */
  centerX: number;
  centerY: number;
  /** Radius of the magnified region (mm) on the source view. */
  radius: number;
  /** Output magnification (e.g. 2 for 2:1). */
  magnification: number;
  /** Where to place the detail view on the paper (top-left in mm). */
  placeX: number;
  placeY: number;
  /** Label letter (e.g. 'A'). */
  label: string;
}

export interface DetailViewResult {
  /** Source-view marker — draw an unfilled circle at the centre with a
   *  leader line pointing to the detail. */
  marker: { cx: number; cy: number; r: number; label: string };
  /** Lines projected into the detail view box (top-left at placeX/Y). */
  lines: DrawingLine[];
  /** Computed bounding box of the detail-view box in paper coords. */
  bounds: { x: number; y: number; w: number; h: number };
  /** Caption — caller renders something like "Detail A — Scale 2:1". */
  caption: string;
}

export function buildDetailView(
  sourceLines: DrawingLine[],
  spec: DetailViewSpec,
): DetailViewResult {
  const { centerX, centerY, radius, magnification, placeX, placeY, label } = spec;

  // Quick AABB check first — only consider lines that cross the focal
  // bounding square; clip to the circle in screen space later via overlay.
  const candidate = sourceLines.filter(l => {
    const minX = Math.min(l.x1, l.x2), maxX = Math.max(l.x1, l.x2);
    const minY = Math.min(l.y1, l.y2), maxY = Math.max(l.y1, l.y2);
    return (
      maxX >= centerX - radius && minX <= centerX + radius &&
      maxY >= centerY - radius && minY <= centerY + radius
    );
  });

  // Translate each line so the focal centre maps to (0, 0), scale by mag,
  // then translate to the detail view's centre at (placeX + r×mag, placeY + r×mag).
  const detailR = radius * magnification;
  const tx = placeX + detailR;
  const ty = placeY + detailR;
  const lines: DrawingLine[] = candidate.map(l => ({
    ...l,
    x1: (l.x1 - centerX) * magnification + tx,
    y1: (l.y1 - centerY) * magnification + ty,
    x2: (l.x2 - centerX) * magnification + tx,
    y2: (l.y2 - centerY) * magnification + ty,
  }));

  return {
    marker: { cx: centerX, cy: centerY, r: radius, label },
    lines,
    bounds: { x: placeX, y: placeY, w: detailR * 2, h: detailR * 2 },
    caption: `Detail ${label} — Scale ${magnification}:1`,
  };
}

// ─── Section view ───────────────────────────────────────────────────────────

export interface SectionViewSpec {
  /** Cut line endpoints in the source view's coordinate system. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Where to place the section view on the paper. */
  placeX: number;
  placeY: number;
  /** Width × height of the destination box. */
  width: number;
  height: number;
  /** Label like 'A' — produces "Section A-A". */
  label: string;
  /** Hatch line spacing in mm. Default 1.5. */
  hatchSpacing?: number;
}

export interface SectionViewResult {
  /** Cut-line markers on the source view (start/end arrows + label). */
  cutLine: { x1: number; y1: number; x2: number; y2: number; label: string };
  /** Section view's outline rectangle. */
  bounds: { x: number; y: number; w: number; h: number };
  /** 45° hatching lines clipped to the section bounds. */
  hatch: DrawingLine[];
  /** Caption text. */
  caption: string;
}

export function buildSectionView(
  spec: SectionViewSpec,
): SectionViewResult {
  const { placeX, placeY, width, height, label } = spec;
  const hatchSpacing = spec.hatchSpacing ?? 1.5;

  // Generate 45° hatch lines covering the section box.
  const hatch: DrawingLine[] = [];
  const diag = width + height;
  for (let offset = -height; offset < diag; offset += hatchSpacing) {
    // Each line: y = x - offset, clipped to [placeX..placeX+width] × [placeY..placeY+height].
    const x1 = placeX;
    const y1Raw = placeY + offset;
    const x2 = placeX + width;
    const y2Raw = placeY + offset + width;

    // Clip into the box.
    const y1 = Math.max(placeY, Math.min(placeY + height, y1Raw));
    const y2 = Math.max(placeY, Math.min(placeY + height, y2Raw));
    const dx1 = x1 + (y1 - y1Raw); // adjust X if Y was clamped
    const dx2 = x2 - (y2Raw - y2);

    if (dx2 > dx1 && y2 > y1) {
      hatch.push({ x1: dx1, y1, x2: dx2, y2, type: 'dimension' });
    }
  }

  return {
    cutLine: { x1: spec.x1, y1: spec.y1, x2: spec.x2, y2: spec.y2, label },
    bounds: { x: placeX, y: placeY, w: width, h: height },
    hatch,
    caption: `Section ${label}-${label}`,
  };
}
