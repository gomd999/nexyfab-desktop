/**
 * plungeRoughingPattern.ts — Generate a plunge-roughing (Z-axis drill-
 * like) pattern to hog out a pocket with overlapping vertical plunges.
 *
 * Plunge roughing removes bulk material with repeated axial plunges of
 * the cutter rather than lateral milling. It excels on deep pockets and
 * with long, weak tools because the cutting force is mostly axial
 * (along the strong tool axis).
 *
 * Pattern: cover the pocket bounding box with a grid of plunge points
 * whose spacing = toolDiameter × (1 − overlapFraction). Each plunge that
 * falls inside the pocket polygon is kept; plunges are ordered to
 * minimise rapid travel (boustrophedon / serpentine).
 */

export interface Point2D { x: number; y: number }
export type Polygon = Point2D[];

export interface PlungeRoughingInput {
  pocketPolygon: Polygon;
  toolDiameterMm: number;
  overlapFraction?: number; // 0..0.9, default 0.3
  depthMm: number;
  peckDepthMm?: number; // if set, split each plunge into pecks
}

export interface PlungePoint {
  x: number;
  y: number;
  pecks: number;
  order: number;
}

export interface PlungeRoughingResult {
  plunges: PlungePoint[];
  stepoverMm: number;
  plungeCount: number;
  coveragePercent: number; // fraction of pocket bbox covered by plunges
  warnings: string[];
}

export function generatePattern(input: PlungeRoughingInput): PlungeRoughingResult {
  const warnings: string[] = [];
  if (input.pocketPolygon.length < 3) warnings.push('Pocket polygon needs at least 3 vertices.');
  if (input.toolDiameterMm <= 0) warnings.push('Tool diameter must be positive.');
  if (input.depthMm <= 0) warnings.push('Depth must be positive.');

  const overlap = Math.max(0, Math.min(0.9, input.overlapFraction ?? 0.3));
  const stepover = input.toolDiameterMm * (1 - overlap);

  if (input.pocketPolygon.length < 3 || stepover <= 0) {
    return { plunges: [], stepoverMm: stepover, plungeCount: 0, coveragePercent: 0, warnings };
  }

  const bounds = computeBounds(input.pocketPolygon);
  const pecks = input.peckDepthMm && input.peckDepthMm > 0
    ? Math.ceil(input.depthMm / input.peckDepthMm)
    : 1;

  const plunges: PlungePoint[] = [];
  let order = 0;
  let rowIndex = 0;
  const r = input.toolDiameterMm / 2;
  for (let y = bounds.minY + r; y <= bounds.maxY - r + 1e-9; y += stepover) {
    const rowPoints: PlungePoint[] = [];
    for (let x = bounds.minX + r; x <= bounds.maxX - r + 1e-9; x += stepover) {
      if (pointInPolygon({ x, y }, input.pocketPolygon)) {
        rowPoints.push({ x, y, pecks, order: 0 });
      }
    }
    // serpentine: reverse every other row
    if (rowIndex % 2 === 1) rowPoints.reverse();
    for (const p of rowPoints) { p.order = order++; plunges.push(p); }
    rowIndex++;
  }

  const bboxArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
  const coveredArea = plunges.length * Math.PI * r * r;
  const coverage = bboxArea > 0 ? Math.min(100, (coveredArea / bboxArea) * 100) : 0;

  return {
    plunges,
    stepoverMm: stepover,
    plungeCount: plunges.length,
    coveragePercent: coverage,
    warnings,
  };
}

function computeBounds(polygon: Polygon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function pointInPolygon(p: Point2D, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    if (((pi.y > p.y) !== (pj.y > p.y))
      && (p.x < (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y + 1e-12) + pi.x)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Total rapid + plunge travel distance estimate (mm). */
export function travelDistance(result: PlungeRoughingResult, depthMm: number): number {
  let lateral = 0;
  const ordered = [...result.plunges].sort((a, b) => a.order - b.order);
  for (let i = 1; i < ordered.length; i++) {
    lateral += Math.hypot(ordered[i]!.x - ordered[i - 1]!.x, ordered[i]!.y - ordered[i - 1]!.y);
  }
  const axial = result.plungeCount * depthMm * 2; // plunge down + retract
  return lateral + axial;
}

export function summarize(r: PlungeRoughingResult): { plungeCount: number; stepoverMm: number; coveragePercent: number } {
  return { plungeCount: r.plungeCount, stepoverMm: r.stepoverMm, coveragePercent: r.coveragePercent };
}
