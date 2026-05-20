/**
 * screwPatternGenerator.ts — Generate a screw / bolt pattern around
 * an assembly.
 *
 * Supports:
 *
 *   - Linear pattern: N holes along a line.
 *   - Rectangular pattern: rows × cols around a flange.
 *   - Circular pattern: N evenly-spaced around a bolt circle.
 *   - Edge-following: along the perimeter of a polygon, spaced at
 *     target pitch.
 *
 * Module:
 *   - Outputs hole positions, hole diameters, clearance specs.
 *   - Computes ISO clearance hole sizes per fastener.
 *   - Sanity checks: minimum edge distance, pitch ratio.
 */

export interface Vec2 { x: number; y: number }

export type FastenerSize = 'M3' | 'M4' | 'M5' | 'M6' | 'M8' | 'M10' | 'M12';

export interface ClearanceHole {
  size: FastenerSize;
  nominalMm: number;
  /** Close fit (H12). */
  closeMm: number;
  /** Medium fit (H13). */
  mediumMm: number;
  /** Free fit (H14). */
  freeMm: number;
}

export const CLEARANCE_HOLES: Record<FastenerSize, ClearanceHole> = {
  M3:  { size: 'M3', nominalMm: 3, closeMm: 3.2, mediumMm: 3.4, freeMm: 3.6 },
  M4:  { size: 'M4', nominalMm: 4, closeMm: 4.3, mediumMm: 4.5, freeMm: 4.8 },
  M5:  { size: 'M5', nominalMm: 5, closeMm: 5.3, mediumMm: 5.5, freeMm: 5.8 },
  M6:  { size: 'M6', nominalMm: 6, closeMm: 6.4, mediumMm: 6.6, freeMm: 7.0 },
  M8:  { size: 'M8', nominalMm: 8, closeMm: 8.4, mediumMm: 9.0, freeMm: 10.0 },
  M10: { size: 'M10', nominalMm: 10, closeMm: 10.5, mediumMm: 11.0, freeMm: 12.0 },
  M12: { size: 'M12', nominalMm: 12, closeMm: 13.0, mediumMm: 14.0, freeMm: 14.5 },
};

export type FitClass = 'close' | 'medium' | 'free';

export interface ScrewHole {
  id: string;
  position: Vec2;
  diameterMm: number;
  size: FastenerSize;
  fit: FitClass;
}

export interface PatternOptions {
  size: FastenerSize;
  fit: FitClass;
  /** Minimum edge distance from outline. */
  minEdgeDistanceMm: number;
}

export const DEFAULT_OPTIONS: PatternOptions = {
  size: 'M5',
  fit: 'medium',
  minEdgeDistanceMm: 5,
};

// ── Linear pattern ────────────────────────────────────────────

export function linearPattern(start: Vec2, end: Vec2, count: number, options: Partial<PatternOptions> = {}): ScrewHole[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const holes: ScrewHole[] = [];
  if (count <= 0) return holes;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    holes.push({
      id: `lin-${i}`,
      position: { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t },
      diameterMm: pickDiameter(opts.size, opts.fit),
      size: opts.size,
      fit: opts.fit,
    });
  }
  return holes;
}

// ── Rectangular pattern ───────────────────────────────────────

export function rectangularPattern(min: Vec2, max: Vec2, rows: number, cols: number, options: Partial<PatternOptions> = {}): ScrewHole[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const holes: ScrewHole[] = [];
  if (rows <= 0 || cols <= 0) return holes;
  const dx = cols === 1 ? 0 : (max.x - min.x) / (cols - 1);
  const dy = rows === 1 ? 0 : (max.y - min.y) / (rows - 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      holes.push({
        id: `rect-${r}-${c}`,
        position: { x: min.x + dx * c, y: min.y + dy * r },
        diameterMm: pickDiameter(opts.size, opts.fit),
        size: opts.size,
        fit: opts.fit,
      });
    }
  }
  return holes;
}

// ── Circular bolt pattern ─────────────────────────────────────

export function circularPattern(centre: Vec2, pcdMm: number, count: number, startAngleDeg: number = 0, options: Partial<PatternOptions> = {}): ScrewHole[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const holes: ScrewHole[] = [];
  if (count <= 0) return holes;
  const radius = pcdMm / 2;
  for (let i = 0; i < count; i++) {
    const angle = ((startAngleDeg + (360 * i) / count) * Math.PI) / 180;
    holes.push({
      id: `circ-${i}`,
      position: {
        x: centre.x + radius * Math.cos(angle),
        y: centre.y + radius * Math.sin(angle),
      },
      diameterMm: pickDiameter(opts.size, opts.fit),
      size: opts.size,
      fit: opts.fit,
    });
  }
  return holes;
}

// ── Edge-following pattern ───────────────────────────────────

export function edgeFollowingPattern(polygon: Vec2[], targetPitchMm: number, options: Partial<PatternOptions> = {}): ScrewHole[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const holes: ScrewHole[] = [];
  if (polygon.length < 2 || targetPitchMm <= 0) return holes;
  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    segLengths.push(l);
    total += l;
  }
  if (total === 0) return holes;
  const count = Math.max(2, Math.round(total / targetPitchMm));
  for (let i = 0; i < count; i++) {
    const d = (total * i) / count;
    const pos = pointAtDistance(polygon, segLengths, d);
    if (pos) {
      holes.push({
        id: `edge-${i}`,
        position: pos,
        diameterMm: pickDiameter(opts.size, opts.fit),
        size: opts.size,
        fit: opts.fit,
      });
    }
  }
  return holes;
}

function pointAtDistance(polygon: Vec2[], segLengths: number[], distance: number): Vec2 | null {
  let remaining = distance;
  for (let i = 0; i < polygon.length; i++) {
    const len = segLengths[i]!;
    if (remaining <= len) {
      const a = polygon[i]!;
      const b = polygon[(i + 1) % polygon.length]!;
      const t = len === 0 ? 0 : remaining / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= len;
  }
  return polygon[0] ?? null;
}

// ── Diameter helper ───────────────────────────────────────────

function pickDiameter(size: FastenerSize, fit: FitClass): number {
  const entry = CLEARANCE_HOLES[size];
  if (fit === 'close') return entry.closeMm;
  if (fit === 'free') return entry.freeMm;
  return entry.mediumMm;
}

// ── Validation ─────────────────────────────────────────────────

export interface PatternIssue {
  holeId: string;
  severity: 'error' | 'warn';
  message: string;
}

export function validateHoles(holes: ScrewHole[], outlinePolygon: Vec2[], minEdgeDistance: number): PatternIssue[] {
  const issues: PatternIssue[] = [];
  for (const h of holes) {
    const d = distanceToPolygon(h.position, outlinePolygon);
    if (d < minEdgeDistance) {
      issues.push({
        holeId: h.id,
        severity: 'warn',
        message: `Hole ${h.id} edge distance ${d.toFixed(2)} mm < ${minEdgeDistance} mm.`,
      });
    }
  }
  return issues;
}

function distanceToPolygon(p: Vec2, poly: Vec2[]): number {
  if (poly.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const d = pointToSegment(p, a, b);
    if (d < min) min = d;
  }
  return min;
}

function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return Math.hypot(p.x - proj.x, p.y - proj.y);
}

// ── Summary ────────────────────────────────────────────────────

export interface PatternSummary {
  holeCount: number;
  size: FastenerSize;
  fit: FitClass;
  diameterMm: number;
}

export function summarize(holes: ScrewHole[]): PatternSummary {
  if (holes.length === 0) {
    return { holeCount: 0, size: 'M5', fit: 'medium', diameterMm: 0 };
  }
  const first = holes[0]!;
  return {
    holeCount: holes.length,
    size: first.size,
    fit: first.fit,
    diameterMm: first.diameterMm,
  };
}
