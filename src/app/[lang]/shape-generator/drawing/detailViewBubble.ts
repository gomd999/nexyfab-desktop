/**
 * detailViewBubble.ts — Lay out a "detail view" callout: a circle (or
 * rounded rectangle) around a small feature on the parent view, a leader
 * label (e.g. "DETAIL A"), and the placement of the enlarged detail view
 * elsewhere on the sheet at a chosen scale.
 *
 * ASME Y14.3 detail views: the bounded region on the parent gets a thin
 * circle + letter; the enlarged view is labelled "DETAIL A  SCALE 2:1".
 *
 * This module:
 *   1. Builds the detail boundary circle around the region of interest.
 *   2. Picks the enlarged-view centre in free sheet space (avoiding the
 *      parent view + other detail views).
 *   3. Computes the enlarged-view radius = sourceRadius × scale.
 *   4. Validates the enlarged view fits inside the sheet.
 */

export interface Point2D { x: number; y: number }

export interface SheetBounds { minX: number; minY: number; maxX: number; maxY: number }

export interface DetailViewInput {
  featureCentre: Point2D;
  featureRadiusMm: number;
  scale: number; // e.g. 2 means 2:1
  label: string; // "A"
  sheet: SheetBounds;
  parentViewBounds: SheetBounds;
  existingDetailCentres?: Point2D[];
}

export interface DetailViewResult {
  boundaryCircle: { centre: Point2D; radiusMm: number };
  enlargedCentre: Point2D;
  enlargedRadiusMm: number;
  label: string;
  scaleLabel: string; // "SCALE 2:1"
  fitsInSheet: boolean;
  warnings: string[];
}

export function layoutDetailView(input: DetailViewInput): DetailViewResult {
  const warnings: string[] = [];
  if (input.featureRadiusMm <= 0) warnings.push('Feature radius must be positive.');
  if (input.scale <= 0) warnings.push('Scale must be positive.');

  const enlargedRadius = input.featureRadiusMm * input.scale;
  const scaleLabel = formatScale(input.scale);

  const enlargedCentre = pickFreeSpace(input, enlargedRadius);
  const fits = circleInside(enlargedCentre, enlargedRadius, input.sheet);
  if (!fits) warnings.push('Enlarged detail view does not fit inside the sheet; reduce scale or pick a larger sheet.');

  return {
    boundaryCircle: { centre: input.featureCentre, radiusMm: input.featureRadiusMm },
    enlargedCentre,
    enlargedRadiusMm: enlargedRadius,
    label: input.label,
    scaleLabel,
    fitsInSheet: fits,
    warnings,
  };
}

function formatScale(scale: number): string {
  if (scale >= 1) {
    // 2:1, 5:1 etc — round to reasonable
    const n = Math.round(scale);
    return `SCALE ${n}:1`;
  }
  const inv = Math.round(1 / scale);
  return `SCALE 1:${inv}`;
}

/** Place the enlarged view in the freest corner of the sheet not occupied by the parent view. */
function pickFreeSpace(input: DetailViewInput, radius: number): Point2D {
  const margin = radius + 5;
  const candidates: Point2D[] = [
    { x: input.sheet.maxX - margin, y: input.sheet.maxY - margin }, // top-right
    { x: input.sheet.minX + margin, y: input.sheet.maxY - margin }, // top-left
    { x: input.sheet.maxX - margin, y: input.sheet.minY + margin }, // bottom-right
    { x: input.sheet.minX + margin, y: input.sheet.minY + margin }, // bottom-left
  ];
  const existing = input.existingDetailCentres ?? [];
  let best = candidates[0]!;
  let bestScore = -Infinity;
  for (const c of candidates) {
    // Score = distance from parent view centre + distance from existing details.
    const pcx = (input.parentViewBounds.minX + input.parentViewBounds.maxX) / 2;
    const pcy = (input.parentViewBounds.minY + input.parentViewBounds.maxY) / 2;
    let score = Math.hypot(c.x - pcx, c.y - pcy);
    const overlapsParent = circleIntersectsRect(c, radius, input.parentViewBounds);
    if (overlapsParent) score -= 1e6;
    for (const e of existing) {
      score += Math.min(50, Math.hypot(c.x - e.x, c.y - e.y));
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function circleInside(c: Point2D, r: number, sheet: SheetBounds): boolean {
  return c.x - r >= sheet.minX - 1e-6 && c.x + r <= sheet.maxX + 1e-6
    && c.y - r >= sheet.minY - 1e-6 && c.y + r <= sheet.maxY + 1e-6;
}

function circleIntersectsRect(c: Point2D, r: number, rect: SheetBounds): boolean {
  const nx = Math.max(rect.minX, Math.min(c.x, rect.maxX));
  const ny = Math.max(rect.minY, Math.min(c.y, rect.maxY));
  return Math.hypot(c.x - nx, c.y - ny) < r;
}

/** Compose the full label string, e.g. "DETAIL A  SCALE 2:1". */
export function fullLabel(result: DetailViewResult): string {
  return `DETAIL ${result.label}  ${result.scaleLabel}`;
}

export function summarize(r: DetailViewResult): { label: string; enlargedRadiusMm: number; fitsInSheet: boolean } {
  return { label: r.label, enlargedRadiusMm: r.enlargedRadiusMm, fitsInSheet: r.fitsInSheet };
}
