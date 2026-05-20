/**
 * detailViewAutoPlacer.ts — Auto-place detail (zoom) views around a
 * main drawing view.
 *
 * Drawings often have a circled region on the main view with a
 * letter callout ("Detail A"), and a larger version of that region
 * drawn elsewhere on the sheet. The placer:
 *
 *   1. Takes the main-view bbox + the regions of interest (the
 *      circled spots) + the sheet bbox + already-used bboxes.
 *   2. For each detail region, finds the nearest empty space on
 *      the sheet that does not overlap other content.
 *   3. Computes a scale factor (typically 2x or 4x) and the
 *      placed bbox.
 *   4. Returns leader-line endpoints from the callout circle to
 *      the placed detail.
 *
 * Output: list of placed detail views with sheet position, scale,
 * and connecting leader.
 */

export interface Vec2 { x: number; y: number }

export interface BBox {
  min: Vec2;
  max: Vec2;
}

export interface DetailRegion {
  /** Callout id (e.g., "A", "B"). */
  id: string;
  /** Circle center on the main view. */
  circleCenter: Vec2;
  /** Circle radius. */
  circleRadiusMm: number;
  /** Desired scale factor. */
  scaleFactor: number;
}

export interface DetailPlacement {
  id: string;
  /** Where the enlarged detail view sits on the sheet. */
  placedBBox: BBox;
  /** Center of the placed view. */
  placedCenter: Vec2;
  /** Final scale used (may differ from desired if no space). */
  scale: number;
  /** Leader from circle center → placed view edge. */
  leader: { from: Vec2; to: Vec2 };
  /** Did this region fit? */
  placed: boolean;
}

export interface PlacerOptions {
  /** Min gap between any placed bbox and others, mm. */
  paddingMm: number;
  /** Try scales from desired down to 1.5 in steps. */
  scaleDownStep: number;
}

export const DEFAULT_OPTIONS: PlacerOptions = {
  paddingMm: 5,
  scaleDownStep: 0.5,
};

// ── Top-level entry ────────────────────────────────────────────

export function placeDetailViews(
  sheetBBox: BBox,
  occupied: BBox[],
  regions: DetailRegion[],
  options: Partial<PlacerOptions> = {},
): DetailPlacement[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const placements: DetailPlacement[] = [];
  const allOccupied = [...occupied];

  for (const region of regions) {
    const placement = tryPlace(sheetBBox, allOccupied, region, opts);
    placements.push(placement);
    if (placement.placed) {
      allOccupied.push(placement.placedBBox);
    }
  }
  return placements;
}

// ── Single-region placement ───────────────────────────────────

function tryPlace(sheet: BBox, occupied: BBox[], region: DetailRegion, opts: PlacerOptions): DetailPlacement {
  let scale = region.scaleFactor;
  while (scale >= 1.5) {
    const radius = region.circleRadiusMm * scale;
    const size = radius * 2;
    const corners = candidateCorners(sheet, size, opts.paddingMm);
    for (const c of corners) {
      const placedBBox: BBox = {
        min: { x: c.x - radius, y: c.y - radius },
        max: { x: c.x + radius, y: c.y + radius },
      };
      if (!overlapsAny(placedBBox, occupied, opts.paddingMm) && containsBBox(sheet, placedBBox)) {
        return {
          id: region.id,
          placedBBox,
          placedCenter: c,
          scale,
          leader: {
            from: region.circleCenter,
            to: nearestEdgePoint(placedBBox, region.circleCenter),
          },
          placed: true,
        };
      }
    }
    scale -= opts.scaleDownStep;
  }
  return {
    id: region.id,
    placedBBox: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
    placedCenter: { x: 0, y: 0 },
    scale: 0,
    leader: { from: region.circleCenter, to: region.circleCenter },
    placed: false,
  };
}

function candidateCorners(sheet: BBox, size: number, padding: number): Vec2[] {
  const half = size / 2;
  return [
    { x: sheet.min.x + half + padding, y: sheet.min.y + half + padding },
    { x: sheet.max.x - half - padding, y: sheet.min.y + half + padding },
    { x: sheet.min.x + half + padding, y: sheet.max.y - half - padding },
    { x: sheet.max.x - half - padding, y: sheet.max.y - half - padding },
    { x: (sheet.min.x + sheet.max.x) / 2, y: sheet.min.y + half + padding },
    { x: (sheet.min.x + sheet.max.x) / 2, y: sheet.max.y - half - padding },
    { x: sheet.min.x + half + padding, y: (sheet.min.y + sheet.max.y) / 2 },
    { x: sheet.max.x - half - padding, y: (sheet.min.y + sheet.max.y) / 2 },
  ];
}

function overlapsAny(target: BBox, list: BBox[], padding: number): boolean {
  for (const b of list) {
    if (bboxesOverlap(expand(target, padding), b)) return true;
  }
  return false;
}

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y;
}

function containsBBox(outer: BBox, inner: BBox): boolean {
  return inner.min.x >= outer.min.x && inner.max.x <= outer.max.x && inner.min.y >= outer.min.y && inner.max.y <= outer.max.y;
}

function expand(b: BBox, pad: number): BBox {
  return { min: { x: b.min.x - pad, y: b.min.y - pad }, max: { x: b.max.x + pad, y: b.max.y + pad } };
}

function nearestEdgePoint(box: BBox, p: Vec2): Vec2 {
  // Pick the edge midpoint closest to p.
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const candidates: Vec2[] = [
    { x: box.min.x, y: cy },
    { x: box.max.x, y: cy },
    { x: cx, y: box.min.y },
    { x: cx, y: box.max.y },
  ];
  let best = candidates[0]!;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

// ── Summary ────────────────────────────────────────────────────

export interface PlacementSummary {
  regionCount: number;
  placedCount: number;
  unplacedCount: number;
  averageScale: number;
  fitFraction: number;
}

export function summarize(placements: DetailPlacement[]): PlacementSummary {
  const placed = placements.filter(p => p.placed);
  const avg = placed.length > 0 ? placed.reduce((s, p) => s + p.scale, 0) / placed.length : 0;
  return {
    regionCount: placements.length,
    placedCount: placed.length,
    unplacedCount: placements.length - placed.length,
    averageScale: avg,
    fitFraction: placements.length > 0 ? placed.length / placements.length : 0,
  };
}
