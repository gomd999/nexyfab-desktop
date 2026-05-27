/**
 * sectionViewHatch.ts — Generate ANSI/ISO section-view hatching (cross-
 * hatch) lines clipped to a section polygon.
 *
 * Section hatching is a family of parallel lines at a standard angle
 * (45° default; adjacent parts use 30°/60° or opposite sign so they
 * read distinctly). Spacing scales with the part size. Each candidate
 * infinite line is clipped to the section polygon, producing one or
 * more line segments.
 *
 * Material-specific patterns (ANSI Y14.2): cast iron = single 45°,
 * steel = 45° with alternating, brass/bronze = doubled lines, etc.
 * We expose the angle + spacing; the pattern multiplicity is a follow-up.
 */

export interface Point2D { x: number; y: number }
export type Polygon = Point2D[];

export interface HatchInput {
  sectionPolygon: Polygon;
  angleDeg?: number;   // default 45
  spacingMm?: number;  // default 3
}

export interface HatchSegment { start: Point2D; end: Point2D }

export interface HatchResult {
  segments: HatchSegment[];
  lineCount: number;
  angleDeg: number;
  spacingMm: number;
  warnings: string[];
}

export function generateHatch(input: HatchInput): HatchResult {
  const warnings: string[] = [];
  if (input.sectionPolygon.length < 3) warnings.push('Section polygon needs at least 3 vertices.');
  const angleDeg = input.angleDeg ?? 45;
  const spacing = input.spacingMm ?? 3;
  if (spacing <= 0) warnings.push('Spacing must be positive.');

  if (input.sectionPolygon.length < 3 || spacing <= 0) {
    return { segments: [], lineCount: 0, angleDeg, spacingMm: spacing, warnings };
  }

  const theta = angleDeg * Math.PI / 180;
  // Hatch direction unit vector and its perpendicular.
  const dir = { x: Math.cos(theta), y: Math.sin(theta) };
  const perp = { x: -Math.sin(theta), y: Math.cos(theta) };

  // Project polygon vertices onto perp axis to find the band of offsets.
  let minProj = Infinity, maxProj = -Infinity;
  let maxExtent = 0;
  const cx = input.sectionPolygon.reduce((s, p) => s + p.x, 0) / input.sectionPolygon.length;
  const cy = input.sectionPolygon.reduce((s, p) => s + p.y, 0) / input.sectionPolygon.length;
  for (const p of input.sectionPolygon) {
    const proj = (p.x - cx) * perp.x + (p.y - cy) * perp.y;
    minProj = Math.min(minProj, proj);
    maxProj = Math.max(maxProj, proj);
    maxExtent = Math.max(maxExtent, Math.hypot(p.x - cx, p.y - cy));
  }

  const segments: HatchSegment[] = [];
  const L = maxExtent * 2 + spacing;
  // Step lines across the band.
  for (let off = minProj; off <= maxProj; off += spacing) {
    // A point on this hatch line:
    const px = cx + perp.x * off;
    const py = cy + perp.y * off;
    // Long line through (px,py) in dir; clip to polygon.
    const a = { x: px - dir.x * L, y: py - dir.y * L };
    const b = { x: px + dir.x * L, y: py + dir.y * L };
    const clipped = clipLineToPolygon(a, b, input.sectionPolygon);
    segments.push(...clipped);
  }

  return { segments, lineCount: segments.length, angleDeg, spacingMm: spacing, warnings };
}

/** Returns the inside-polygon portions of segment a→b (handles convex + simple concave). */
function clipLineToPolygon(a: Point2D, b: Point2D, polygon: Polygon): HatchSegment[] {
  // Find all intersection parameters t along a→b with polygon edges.
  const ts: number[] = [];
  const abx = b.x - a.x, aby = b.y - a.y;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!;
    const q = polygon[(i + 1) % polygon.length]!;
    const t = segmentIntersectParam(a, abx, aby, p, q);
    if (t != null) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  // Pair up consecutive intersections; the midpoint inside polygon → keep.
  const segs: HatchSegment[] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    const mid = { x: a.x + abx * (t0 + t1) / 2, y: a.y + aby * (t0 + t1) / 2 };
    if (pointInPolygon(mid, polygon)) {
      segs.push({
        start: { x: a.x + abx * t0, y: a.y + aby * t0 },
        end: { x: a.x + abx * t1, y: a.y + aby * t1 },
      });
    }
  }
  return segs;
}

function segmentIntersectParam(a: Point2D, abx: number, aby: number, p: Point2D, q: Point2D): number | null {
  const dpx = q.x - p.x, dpy = q.y - p.y;
  const denom = abx * dpy - aby * dpx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((p.x - a.x) * dpy - (p.y - a.y) * dpx) / denom;
  const u = ((p.x - a.x) * aby - (p.y - a.y) * abx) / denom;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  if (t < -1e-9 || t > 1 + 1e-9) return null;
  return t;
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

/** Total length of all hatch segments (informational / line-weight budget). */
export function totalHatchLength(result: HatchResult): number {
  return result.segments.reduce((sum, s) => sum + Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y), 0);
}

export function summarize(r: HatchResult): { lineCount: number; angleDeg: number; spacingMm: number } {
  return { lineCount: r.lineCount, angleDeg: r.angleDeg, spacingMm: r.spacingMm };
}
