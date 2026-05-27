/**
 * isometricGridGenerator.ts — Generate isometric grid for axonometric
 * drawing background.
 *
 * Isometric grids are widely used for:
 *   - 3D sketching guides on technical drawings.
 *   - Process flow diagrams (pipe & instrumentation).
 *   - Architectural / industrial layouts.
 *
 * The grid consists of three line families at 0°, 60°, 120° (or
 * 30° / 150° / 90° depending on convention). Module accepts:
 *
 *   - Bounding box of the drawing region.
 *   - Pitch (mm).
 *   - Convention: 30°-up (standard ISO), 0°-baseline.
 *   - Optional dot mode (just intersection dots, no lines).
 */

export interface Vec2 { x: number; y: number }

export interface GridOptions {
  /** Drawing region. */
  min: Vec2;
  max: Vec2;
  /** Pitch (distance between parallel lines, mm). */
  pitchMm: number;
  /** Convention: standard 30°-up or 45°-rotated. */
  convention: 'iso-30' | 'iso-45';
  /** Render mode: lines or dots at intersections. */
  mode: 'lines' | 'dots';
  /** Optional clip polygon to limit grid. */
  clipPolygon?: Vec2[];
}

export interface GridLine {
  start: Vec2;
  end: Vec2;
  family: 0 | 1 | 2;
}

export interface GridDot {
  position: Vec2;
  family: 0 | 1 | 2;
}

export interface GridResult {
  lines: GridLine[];
  dots: GridDot[];
  totalLineLengthMm: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function generateGrid(options: GridOptions): GridResult {
  const angles = options.convention === 'iso-30'
    ? [30, 150, 90]   // standard isometric — two slanted + vertical
    : [45, 135, 90];
  const lines: GridLine[] = [];
  const dots: GridDot[] = [];
  const family: (0 | 1 | 2)[] = [0, 1, 2];

  for (let i = 0; i < angles.length; i++) {
    const fam = family[i]!;
    const familyLines = linesAtAngle(angles[i]!, options);
    lines.push(...familyLines.map(l => ({ ...l, family: fam })));
  }

  if (options.mode === 'dots') {
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[i]!.family === lines[j]!.family) continue;
        const inter = intersect(lines[i]!, lines[j]!);
        if (inter && insideBounds(inter, options)) {
          dots.push({ position: inter, family: lines[i]!.family });
        }
      }
    }
    return { lines: [], dots, totalLineLengthMm: 0 };
  }

  // Optional clipping to polygon.
  let outputLines = lines;
  if (options.clipPolygon && options.clipPolygon.length >= 3) {
    outputLines = clipLines(lines, options.clipPolygon);
  }

  let totalLength = 0;
  for (const l of outputLines) totalLength += Math.hypot(l.end.x - l.start.x, l.end.y - l.start.y);
  return { lines: outputLines, dots: [], totalLineLengthMm: totalLength };
}

// ── Lines at angle ────────────────────────────────────────────

function linesAtAngle(angleDeg: number, options: GridOptions): GridLine[] {
  const rad = (angleDeg * Math.PI) / 180;
  const dirX = Math.cos(rad);
  const dirY = Math.sin(rad);
  const normalX = -dirY;
  const normalY = dirX;
  // Bounding box corners projected to normal direction.
  const corners = [
    { x: options.min.x, y: options.min.y },
    { x: options.max.x, y: options.min.y },
    { x: options.max.x, y: options.max.y },
    { x: options.min.x, y: options.max.y },
  ];
  let projMin = Infinity;
  let projMax = -Infinity;
  for (const c of corners) {
    const p = c.x * normalX + c.y * normalY;
    if (p < projMin) projMin = p;
    if (p > projMax) projMax = p;
  }
  const diag = Math.hypot(options.max.x - options.min.x, options.max.y - options.min.y);
  const lines: GridLine[] = [];
  for (let d = projMin; d <= projMax; d += options.pitchMm) {
    const cx = d * normalX;
    const cy = d * normalY;
    lines.push({
      start: { x: cx - diag * dirX, y: cy - diag * dirY },
      end: { x: cx + diag * dirX, y: cy + diag * dirY },
      family: 0, // overwritten by caller
    });
  }
  return lines;
}

// ── Intersection ──────────────────────────────────────────────

function intersect(a: GridLine, b: GridLine): Vec2 | null {
  const ax = a.end.x - a.start.x, ay = a.end.y - a.start.y;
  const bx = b.end.x - b.start.x, by = b.end.y - b.start.y;
  const denom = ax * by - ay * bx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b.start.x - a.start.x) * by - (b.start.y - a.start.y) * bx) / denom;
  return { x: a.start.x + t * ax, y: a.start.y + t * ay };
}

function insideBounds(p: Vec2, opts: GridOptions): boolean {
  return p.x >= opts.min.x && p.x <= opts.max.x && p.y >= opts.min.y && p.y <= opts.max.y;
}

// ── Polygon clipping ─────────────────────────────────────────

function clipLines(lines: GridLine[], poly: Vec2[]): GridLine[] {
  const out: GridLine[] = [];
  for (const l of lines) {
    const segs = clipLineToPolygon(l.start, l.end, poly);
    for (const s of segs) out.push({ start: s.start, end: s.end, family: l.family });
  }
  return out;
}

function clipLineToPolygon(start: Vec2, end: Vec2, poly: Vec2[]): { start: Vec2; end: Vec2 }[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const t = lineSegIntersect(start, end, a, b);
    if (t !== null && t >= 0 && t <= 1) ts.push(t);
  }
  if (ts.length < 2) return [];
  ts.sort((a, b) => a - b);
  const out: { start: Vec2; end: Vec2 }[] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) {
    out.push({
      start: { x: start.x + ts[i]! * dx, y: start.y + ts[i]! * dy },
      end: { x: start.x + ts[i + 1]! * dx, y: start.y + ts[i + 1]! * dy },
    });
  }
  return out;
}

function lineSegIntersect(p: Vec2, q: Vec2, a: Vec2, b: Vec2): number | null {
  const dx1 = q.x - p.x;
  const dy1 = q.y - p.y;
  const dx2 = b.x - a.x;
  const dy2 = b.y - a.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((a.x - p.x) * dy2 - (a.y - p.y) * dx2) / denom;
  const u = ((a.x - p.x) * dy1 - (a.y - p.y) * dx1) / denom;
  if (u < 0 || u > 1) return null;
  return t;
}

// ── Snap helper ──────────────────────────────────────────────

/**
 * Snap an arbitrary point to the nearest isometric grid intersection.
 */
export function snapToGrid(p: Vec2, options: GridOptions): Vec2 {
  // For ISO-30, axes are (cos 30°, sin 30°) and (cos 150°, sin 150°).
  if (options.convention !== 'iso-30') return p;
  const ax = Math.cos((30 * Math.PI) / 180);
  const ay = Math.sin((30 * Math.PI) / 180);
  const bx = Math.cos((150 * Math.PI) / 180);
  const by = Math.sin((150 * Math.PI) / 180);
  // Decompose p into a and b coordinates.
  const det = ax * by - ay * bx;
  if (Math.abs(det) < 1e-9) return p;
  const u = (p.x * by - p.y * bx) / det;
  const v = (-p.x * ay + p.y * ax) / det;
  const su = Math.round(u / options.pitchMm) * options.pitchMm;
  const sv = Math.round(v / options.pitchMm) * options.pitchMm;
  return { x: su * ax + sv * bx, y: su * ay + sv * by };
}

// ── Summary ────────────────────────────────────────────────────

export interface GridSummary {
  mode: 'lines' | 'dots';
  lineCount: number;
  dotCount: number;
  totalLineLengthMm: number;
}

export function summarize(result: GridResult): GridSummary {
  return {
    mode: result.lines.length > 0 ? 'lines' : 'dots',
    lineCount: result.lines.length,
    dotCount: result.dots.length,
    totalLineLengthMm: result.totalLineLengthMm,
  };
}
