/**
 * sectionLineAutoStagger.ts — Auto-stagger section line labels
 * (A-A, B-B, …) on a drawing to avoid collision with views.
 *
 * Section lines tag a cutting plane with a letter and arrow. When
 * a drawing has several section lines passing near each other or
 * near a view boundary, their labels need to be offset to:
 *
 *   - Avoid overlapping the view they cut.
 *   - Avoid overlapping each other.
 *   - Stay close enough to be unambiguous.
 *
 * Module:
 *   - Walks section line entities.
 *   - Picks side-of-line offset (above / below / perpendicular).
 *   - Computes a minimal shift to clear neighbouring view boxes.
 */

export interface Vec2 { x: number; y: number }

export interface SectionLine {
  id: string;
  /** A label "A", "B", etc. */
  label: string;
  /** Line endpoints. */
  start: Vec2;
  end: Vec2;
  /** Cutting-plane direction (1 = standard right-arrow, -1 = reversed). */
  direction: 1 | -1;
}

export interface ViewBox {
  id: string;
  /** Axis-aligned. */
  min: Vec2;
  max: Vec2;
}

export interface StaggerOptions {
  /** Distance from line endpoint to label centre (mm). */
  labelOffsetMm: number;
  /** Minimum clearance between label and view box. */
  minClearanceMm: number;
  /** Label box size. */
  labelWidthMm: number;
  labelHeightMm: number;
}

export const DEFAULT_OPTIONS: StaggerOptions = {
  labelOffsetMm: 5,
  minClearanceMm: 2,
  labelWidthMm: 10,
  labelHeightMm: 5,
};

export interface StaggeredLabel {
  sectionId: string;
  label: string;
  /** Label centre coordinates. */
  position: Vec2;
  /** Whether the label was moved to perpendicular side. */
  flipped: boolean;
  /** Total displacement from the natural position. */
  displacementMm: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function staggerSectionLabels(
  sections: SectionLine[],
  views: ViewBox[],
  options: Partial<StaggerOptions> = {},
): StaggeredLabel[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const labels: StaggeredLabel[] = [];

  for (const section of sections) {
    // Natural placement: at the end point, offset perpendicular to line.
    const dx = section.end.x - section.start.x;
    const dy = section.end.y - section.start.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      labels.push({
        sectionId: section.id,
        label: section.label,
        position: section.start,
        flipped: false,
        displacementMm: 0,
      });
      continue;
    }
    const normalX = -dy / length;
    const normalY = dx / length;
    let attempt = 0;
    let position: Vec2 = {
      x: section.end.x + normalX * opts.labelOffsetMm,
      y: section.end.y + normalY * opts.labelOffsetMm,
    };
    let flipped = false;
    while (attempt < 4) {
      if (clearOfAllViews(position, opts, views)) break;
      // Flip to opposite side.
      position = {
        x: section.end.x - normalX * opts.labelOffsetMm * (attempt + 1),
        y: section.end.y - normalY * opts.labelOffsetMm * (attempt + 1),
      };
      flipped = !flipped;
      attempt++;
    }
    const disp = Math.hypot(position.x - section.end.x, position.y - section.end.y);
    labels.push({
      sectionId: section.id,
      label: section.label,
      position,
      flipped,
      displacementMm: disp,
    });
  }

  return labels;
}

function clearOfAllViews(centre: Vec2, opts: StaggerOptions, views: ViewBox[]): boolean {
  const halfW = opts.labelWidthMm / 2 + opts.minClearanceMm;
  const halfH = opts.labelHeightMm / 2 + opts.minClearanceMm;
  const minX = centre.x - halfW;
  const maxX = centre.x + halfW;
  const minY = centre.y - halfH;
  const maxY = centre.y + halfH;
  for (const v of views) {
    if (maxX < v.min.x || minX > v.max.x) continue;
    if (maxY < v.min.y || minY > v.max.y) continue;
    return false;
  }
  return true;
}

// ── Label-label overlap resolution ────────────────────────────

export function findLabelOverlaps(labels: StaggeredLabel[], opts: StaggerOptions = DEFAULT_OPTIONS): { a: string; b: string }[] {
  const halfW = opts.labelWidthMm / 2;
  const halfH = opts.labelHeightMm / 2;
  const overlaps: { a: string; b: string }[] = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]!;
      const b = labels[j]!;
      const dx = Math.abs(a.position.x - b.position.x);
      const dy = Math.abs(a.position.y - b.position.y);
      if (dx < 2 * halfW && dy < 2 * halfH) {
        overlaps.push({ a: a.sectionId, b: b.sectionId });
      }
    }
  }
  return overlaps;
}

// ── Summary ────────────────────────────────────────────────────

export interface StaggerSummary {
  sectionCount: number;
  flippedCount: number;
  maxDisplacementMm: number;
  remainingLabelOverlaps: number;
}

export function summarize(labels: StaggeredLabel[], opts: StaggerOptions = DEFAULT_OPTIONS): StaggerSummary {
  let flipped = 0;
  let maxDisp = 0;
  for (const l of labels) {
    if (l.flipped) flipped++;
    if (l.displacementMm > maxDisp) maxDisp = l.displacementMm;
  }
  return {
    sectionCount: labels.length,
    flippedCount: flipped,
    maxDisplacementMm: maxDisp,
    remainingLabelOverlaps: findLabelOverlaps(labels, opts).length,
  };
}
