/**
 * hatchPatternLibrary.ts — ISO 128-50 / ANSI Y14.2 hatch patterns
 * per material for drawing section views.
 *
 * The cross-section of every material has its own visual hatch:
 *
 *   - Steel/iron: parallel diagonal lines (45°, 3-5 mm pitch).
 *   - Aluminum: parallel diagonal + alternating dot row.
 *   - Brass/bronze: 45° + 135° crossed.
 *   - Plastic: solid fill (light gray) OR fine cross-hatch.
 *   - Wood: parallel + perpendicular wavy lines.
 *   - Concrete: random dots.
 *   - Rubber/elastomer: 90° + dashed parallel.
 *
 * This module emits the *vector geometry* of the hatch (lines and
 * dots) inside a given closed polygon — the renderer (SVG/Canvas)
 * stamps it.
 */

export type HatchPattern =
  | 'steel'
  | 'aluminum'
  | 'brass'
  | 'plastic'
  | 'wood'
  | 'concrete'
  | 'rubber'
  | 'glass'
  | 'lead';

export interface Vec2 { x: number; y: number }

export interface HatchLine {
  start: Vec2;
  end: Vec2;
}

export interface HatchDot {
  position: Vec2;
  radius: number;
}

export interface HatchOutput {
  lines: HatchLine[];
  dots: HatchDot[];
  /** Identifier for downstream styling. */
  pattern: HatchPattern;
}

export interface PatternSpec {
  /** Primary line angle (degrees from +X). */
  primaryAngleDeg: number;
  /** Optional secondary line angle (cross-hatch). */
  secondaryAngleDeg?: number;
  /** Line pitch in mm. */
  pitchMm: number;
  /** Width of secondary band (0 = no offset between primary and secondary). */
  secondaryOffsetMm?: number;
  /** Whether to emit a dot grid. */
  dotGrid?: { pitchMm: number; radiusMm: number };
  /** Line kind: solid / dashed. */
  lineKind: 'solid' | 'dashed' | 'wavy';
}

export const PATTERN_LIBRARY: Record<HatchPattern, PatternSpec> = {
  steel:    { primaryAngleDeg: 45, pitchMm: 4, lineKind: 'solid' },
  aluminum: { primaryAngleDeg: 45, pitchMm: 4, dotGrid: { pitchMm: 6, radiusMm: 0.3 }, lineKind: 'solid' },
  brass:    { primaryAngleDeg: 45, secondaryAngleDeg: 135, pitchMm: 4, lineKind: 'solid' },
  plastic:  { primaryAngleDeg: 45, secondaryAngleDeg: 135, pitchMm: 1.5, lineKind: 'solid' },
  wood:     { primaryAngleDeg: 0, pitchMm: 3, lineKind: 'wavy' },
  concrete: { primaryAngleDeg: 0, pitchMm: 0, dotGrid: { pitchMm: 3, radiusMm: 0.5 }, lineKind: 'solid' },
  rubber:   { primaryAngleDeg: 90, pitchMm: 3, lineKind: 'dashed' },
  glass:    { primaryAngleDeg: 30, secondaryAngleDeg: 150, pitchMm: 6, lineKind: 'solid' },
  lead:     { primaryAngleDeg: 45, pitchMm: 2, lineKind: 'solid' },
};

// ── Top-level entry ────────────────────────────────────────────

export function generateHatch(
  polygon: Vec2[],
  pattern: HatchPattern,
  options: { scale?: number } = {},
): HatchOutput {
  const spec = PATTERN_LIBRARY[pattern];
  const scale = options.scale ?? 1;
  const lines: HatchLine[] = [];
  const dots: HatchDot[] = [];

  if (polygon.length < 3) {
    return { lines, dots, pattern };
  }

  // Compute polygon AABB.
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const p of polygon) {
    if (p.x < xMin) xMin = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.x > xMax) xMax = p.x;
    if (p.y > yMax) yMax = p.y;
  }

  const pitch = spec.pitchMm * scale;

  if (pitch > 0) {
    fillWithLines(polygon, spec.primaryAngleDeg, pitch, { xMin, yMin, xMax, yMax }, lines);
    if (spec.secondaryAngleDeg !== undefined) {
      fillWithLines(polygon, spec.secondaryAngleDeg, pitch, { xMin, yMin, xMax, yMax }, lines);
    }
  }
  if (spec.dotGrid) {
    const dotPitch = spec.dotGrid.pitchMm * scale;
    for (let x = xMin; x <= xMax; x += dotPitch) {
      for (let y = yMin; y <= yMax; y += dotPitch) {
        if (pointInPolygon({ x, y }, polygon)) {
          dots.push({ position: { x, y }, radius: spec.dotGrid.radiusMm * scale });
        }
      }
    }
  }

  return { lines, dots, pattern };
}

// ── Line filling ──────────────────────────────────────────────

interface AABB { xMin: number; yMin: number; xMax: number; yMax: number }

function fillWithLines(polygon: Vec2[], angleDeg: number, pitch: number, bbox: AABB, out: HatchLine[]): void {
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Direction vector and normal.
  // Lines parallel to (cos, sin); separation along normal (-sin, cos).
  // Project polygon corners onto normal to find sweep range.
  const corners = [
    { x: bbox.xMin, y: bbox.yMin },
    { x: bbox.xMax, y: bbox.yMin },
    { x: bbox.xMax, y: bbox.yMax },
    { x: bbox.xMin, y: bbox.yMax },
  ];
  let nMin = Infinity, nMax = -Infinity;
  for (const c of corners) {
    const n = -c.x * sin + c.y * cos;
    if (n < nMin) nMin = n;
    if (n > nMax) nMax = n;
  }

  const diagonal = Math.hypot(bbox.xMax - bbox.xMin, bbox.yMax - bbox.yMin);
  const lineHalfLength = diagonal + pitch * 2;

  for (let n = Math.floor(nMin / pitch) * pitch; n <= nMax; n += pitch) {
    // Line: position p(t) = (cos·t - sin·n, sin·t + cos·n). Sweep t.
    const start = {
      x: cos * -lineHalfLength - sin * n,
      y: sin * -lineHalfLength + cos * n,
    };
    const end = {
      x: cos * lineHalfLength - sin * n,
      y: sin * lineHalfLength + cos * n,
    };
    // Clip against polygon (Sutherland-Hodgman style — use simple segment-polygon intersection).
    const clipped = clipSegment(start, end, polygon);
    for (const seg of clipped) out.push(seg);
  }
}

function clipSegment(start: Vec2, end: Vec2, polygon: Vec2[]): HatchLine[] {
  // Compute intersection parameters with polygon edges; sort them; pair them up.
  const ts: number[] = [0, 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const t = segmentIntersectionParam(start, dx, dy, a, b);
    if (t !== null && t > 0 && t < 1) ts.push(t);
  }
  ts.sort((a, b) => a - b);
  const out: HatchLine[] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t1 = ts[i]!;
    const t2 = ts[i + 1]!;
    const mid = { x: start.x + dx * (t1 + t2) / 2, y: start.y + dy * (t1 + t2) / 2 };
    if (pointInPolygon(mid, polygon)) {
      out.push({
        start: { x: start.x + dx * t1, y: start.y + dy * t1 },
        end: { x: start.x + dx * t2, y: start.y + dy * t2 },
      });
    }
  }
  return out;
}

function segmentIntersectionParam(p: Vec2, dx: number, dy: number, a: Vec2, b: Vec2): number | null {
  const cx = b.x - a.x;
  const cy = b.y - a.y;
  const denom = dx * cy - dy * cx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((a.x - p.x) * cy - (a.y - p.y) * cx) / denom;
  const u = ((a.x - p.x) * dy - (a.y - p.y) * dx) / denom;
  if (u < 0 || u > 1) return null;
  return t;
}

export function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if ((a.y > p.y) !== (b.y > p.y)) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

// ── Summary ────────────────────────────────────────────────────

export interface HatchSummary {
  pattern: HatchPattern;
  lineCount: number;
  dotCount: number;
  hasSecondaryAngle: boolean;
  pitchMm: number;
}

export function summarize(output: HatchOutput): HatchSummary {
  const spec = PATTERN_LIBRARY[output.pattern];
  return {
    pattern: output.pattern,
    lineCount: output.lines.length,
    dotCount: output.dots.length,
    hasSecondaryAngle: spec.secondaryAngleDeg !== undefined,
    pitchMm: spec.pitchMm,
  };
}
