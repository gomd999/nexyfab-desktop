/**
 * crossHatchGenerator.ts — Generate cross-hatch pattern lines inside
 * a section-cut region (per ISO 128-50 / ASME Y14.2).
 *
 * Section views of solid parts use hatching to indicate the cut
 * material. Each material has a standard pattern:
 *
 *   - Steel/iron: continuous parallel lines, 45°, 1.5-3 mm pitch.
 *   - Aluminum: lines at 30°, 60° crossing (cross-hatch).
 *   - Copper alloys: lines at 22.5°.
 *   - Plastic / rubber: dashed lines.
 *   - Insulation: zigzag.
 *
 * Module:
 *   - Accepts a closed boundary polygon + material code.
 *   - Generates the hatch line segments clipped to the boundary.
 *   - For cross-hatch materials, produces a second perpendicular set.
 *   - Reports total line length (for drawing cost / ink estimation).
 */

export interface Vec2 { x: number; y: number }

export type HatchMaterial = 'steel' | 'aluminum' | 'copper' | 'brass' | 'plastic' | 'wood' | 'concrete' | 'insulation' | 'rubber';

export interface HatchStyle {
  primaryAngleDeg: number;
  pitchMm: number;
  /** Whether to draw a perpendicular cross set. */
  cross: boolean;
  /** Line style: solid / dashed. */
  lineStyle: 'solid' | 'dashed' | 'zigzag';
}

export const MATERIAL_STYLES: Record<HatchMaterial, HatchStyle> = {
  steel:      { primaryAngleDeg: 45, pitchMm: 2, cross: false, lineStyle: 'solid' },
  aluminum:   { primaryAngleDeg: 30, pitchMm: 2.5, cross: true, lineStyle: 'solid' },
  copper:     { primaryAngleDeg: 22.5, pitchMm: 2, cross: false, lineStyle: 'solid' },
  brass:      { primaryAngleDeg: 67.5, pitchMm: 2, cross: false, lineStyle: 'solid' },
  plastic:    { primaryAngleDeg: 45, pitchMm: 2, cross: false, lineStyle: 'dashed' },
  wood:       { primaryAngleDeg: 0, pitchMm: 3, cross: false, lineStyle: 'solid' },
  concrete:   { primaryAngleDeg: 45, pitchMm: 5, cross: true, lineStyle: 'solid' },
  insulation: { primaryAngleDeg: 0, pitchMm: 4, cross: false, lineStyle: 'zigzag' },
  rubber:     { primaryAngleDeg: 45, pitchMm: 1.5, cross: false, lineStyle: 'dashed' },
};

export interface HatchSegment {
  start: Vec2;
  end: Vec2;
  /** True if part of the perpendicular cross set. */
  cross: boolean;
}

export interface HatchResult {
  segments: HatchSegment[];
  totalLengthMm: number;
  style: HatchStyle;
}

// ── Top-level entry ────────────────────────────────────────────

export function generateHatch(boundary: Vec2[], material: HatchMaterial, options: Partial<HatchStyle> = {}): HatchResult {
  const baseStyle = MATERIAL_STYLES[material];
  const style: HatchStyle = { ...baseStyle, ...options };

  const segments: HatchSegment[] = [];
  if (boundary.length < 3) {
    return { segments, totalLengthMm: 0, style };
  }
  const primary = generateAtAngle(boundary, style.primaryAngleDeg, style.pitchMm, false);
  segments.push(...primary);
  if (style.cross) {
    const cross = generateAtAngle(boundary, style.primaryAngleDeg + 90, style.pitchMm, true);
    segments.push(...cross);
  }

  let totalLength = 0;
  for (const s of segments) totalLength += Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y);
  return { segments, totalLengthMm: totalLength, style };
}

// ── Hatch at a specific angle ─────────────────────────────────

function generateAtAngle(boundary: Vec2[], angleDeg: number, pitch: number, cross: boolean): HatchSegment[] {
  const angleRad = (angleDeg * Math.PI) / 180;
  const dirX = Math.cos(angleRad);
  const dirY = Math.sin(angleRad);
  // Bounding box.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of boundary) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  // Project all boundary points onto the normal of the hatch direction.
  const normalX = -dirY;
  const normalY = dirX;
  let projMin = Infinity;
  let projMax = -Infinity;
  for (const p of boundary) {
    const proj = p.x * normalX + p.y * normalY;
    if (proj < projMin) projMin = proj;
    if (proj > projMax) projMax = proj;
  }
  // Generate hatch lines at every pitch.
  const segs: HatchSegment[] = [];
  for (let d = projMin; d <= projMax; d += pitch) {
    // Line: any point p such that p · normal = d, direction = dir.
    // Pick two extreme points based on bounding box.
    const t0 = -Math.hypot(maxX - minX, maxY - minY);
    const t1 = +Math.hypot(maxX - minX, maxY - minY);
    const pStart = { x: d * normalX + t0 * dirX, y: d * normalY + t0 * dirY };
    const pEnd = { x: d * normalX + t1 * dirX, y: d * normalY + t1 * dirY };
    const clipped = clipToPolygon(pStart, pEnd, boundary);
    for (const c of clipped) segs.push({ start: c.start, end: c.end, cross });
  }
  return segs;
}

// ── Sutherland-Hodgman-ish line clip via segment-polygon intersection ──

function clipToPolygon(start: Vec2, end: Vec2, poly: Vec2[]): { start: Vec2; end: Vec2 }[] {
  // Find all intersections of the segment with polygon edges, then build
  // segments between consecutive intersection pairs that lie inside the polygon.
  const ts: number[] = [];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const t = segmentIntersect(start, end, a, b);
    if (t !== null && t >= 0 && t <= 1) ts.push(t);
  }
  if (ts.length < 2) return [];
  ts.sort((a, b) => a - b);
  const out: { start: Vec2; end: Vec2 }[] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    out.push({
      start: { x: start.x + t0 * dx, y: start.y + t0 * dy },
      end: { x: start.x + t1 * dx, y: start.y + t1 * dy },
    });
  }
  return out;
}

function segmentIntersect(p: Vec2, q: Vec2, a: Vec2, b: Vec2): number | null {
  const dx1 = q.x - p.x;
  const dy1 = q.y - p.y;
  const dx2 = b.x - a.x;
  const dy2 = b.y - a.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return null;
  const dx3 = a.x - p.x;
  const dy3 = a.y - p.y;
  const t = (dx3 * dy2 - dy3 * dx2) / denom;
  const u = (dx3 * dy1 - dy3 * dx1) / denom;
  if (u < 0 || u > 1) return null;
  return t;
}

// ── Bulk hatch over multiple regions ──────────────────────────

export function generateMultipleRegions(
  regions: { boundary: Vec2[]; material: HatchMaterial }[],
  options: Partial<HatchStyle> = {},
): HatchResult[] {
  return regions.map(r => generateHatch(r.boundary, r.material, options));
}

// ── Summary ────────────────────────────────────────────────────

export interface HatchSummary {
  material: HatchMaterial;
  segmentCount: number;
  totalLengthMm: number;
  pitchMm: number;
  hasCross: boolean;
}

export function summarize(material: HatchMaterial, result: HatchResult): HatchSummary {
  return {
    material,
    segmentCount: result.segments.length,
    totalLengthMm: result.totalLengthMm,
    pitchMm: result.style.pitchMm,
    hasCross: result.style.cross,
  };
}
