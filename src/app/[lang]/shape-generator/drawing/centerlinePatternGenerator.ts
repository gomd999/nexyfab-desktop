/**
 * centerlinePatternGenerator.ts — Auto-place centerlines and
 * center-marks for symmetric features on a drawing.
 *
 * Standard symbols:
 *
 *   - **Single hole / circle**: center-mark "+" at the center.
 *   - **Linear hole pattern**: long centerline connecting all
 *     hole centers + short cross at each.
 *   - **Circular hole pattern (bolt circle)**: bolt-circle
 *     centerline + spokes to each hole.
 *   - **Rectangular pattern**: grid centerlines.
 *
 * Module accepts a list of detected circles + an optional pattern
 * grouping and emits the drawing primitives (lines + crosses).
 */

export interface Vec2 { x: number; y: number }

export interface CircleFeature {
  id: string;
  center: Vec2;
  radius: number;
}

export type PatternKind = 'single' | 'linear' | 'bolt-circle' | 'rectangular' | 'mixed';

export interface CenterMark {
  /** Cross center. */
  position: Vec2;
  /** Cross arm length, mm. */
  armLength: number;
}

export interface CenterLine {
  start: Vec2;
  end: Vec2;
  /** "primary" axis or "perpendicular" branch. */
  kind: 'primary' | 'perpendicular' | 'spoke';
}

export interface PatternResult {
  kind: PatternKind;
  marks: CenterMark[];
  lines: CenterLine[];
  /** Bolt circle center + radius (if applicable). */
  boltCircle?: { center: Vec2; radius: number };
  /** Linear pattern direction (if applicable). */
  linearDirection?: Vec2;
}

export interface GeneratorOptions {
  /** Distance threshold for detecting linear-pattern collinearity (mm). */
  collinearTolMm: number;
  /** Distance threshold for detecting concentric arrangement. */
  concentricTolMm: number;
  /** Cross arm length scale factor (relative to circle radius). */
  crossArmFactor: number;
  /** Centerline overshoot beyond the last hole, mm. */
  lineOvershootMm: number;
}

export const DEFAULT_OPTIONS: GeneratorOptions = {
  collinearTolMm: 0.5,
  concentricTolMm: 1.0,
  crossArmFactor: 1.5,
  lineOvershootMm: 3.0,
};

// ── Top-level entry ────────────────────────────────────────────

export function detectPattern(circles: CircleFeature[], options: Partial<GeneratorOptions> = {}): PatternResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (circles.length === 0) return { kind: 'single', marks: [], lines: [] };
  if (circles.length === 1) return buildSingle(circles[0]!, opts);

  // Try bolt-circle: all centers equidistant from a common centroid + radius variance small.
  const centroid = computeCentroid(circles.map(c => c.center));
  const radii = circles.map(c => distance(c.center, centroid));
  const meanR = radii.reduce((s, r) => s + r, 0) / radii.length;
  const stdevR = Math.sqrt(radii.reduce((s, r) => s + (r - meanR) ** 2, 0) / radii.length);
  if (stdevR < opts.concentricTolMm && circles.length >= 3) {
    return buildBoltCircle(circles, centroid, meanR, opts);
  }

  // Try linear: all centers collinear within tolerance.
  if (circles.length >= 2 && allCollinear(circles.map(c => c.center), opts.collinearTolMm)) {
    return buildLinearPattern(circles, opts);
  }

  // Otherwise mixed: each gets a single mark.
  const marks = circles.map(c => ({ position: c.center, armLength: c.radius * opts.crossArmFactor }));
  return { kind: 'mixed', marks, lines: [] };
}

// ── Single ────────────────────────────────────────────────────

function buildSingle(circle: CircleFeature, opts: GeneratorOptions): PatternResult {
  return {
    kind: 'single',
    marks: [{ position: circle.center, armLength: circle.radius * opts.crossArmFactor }],
    lines: [],
  };
}

// ── Bolt circle ───────────────────────────────────────────────

function buildBoltCircle(circles: CircleFeature[], centroid: Vec2, meanR: number, opts: GeneratorOptions): PatternResult {
  const marks: CenterMark[] = circles.map(c => ({
    position: c.center,
    armLength: c.radius * opts.crossArmFactor,
  }));
  const lines: CenterLine[] = [];
  // Spokes from centroid to each hole.
  for (const c of circles) {
    lines.push({ start: centroid, end: c.center, kind: 'spoke' });
  }
  // Add center mark at centroid for pattern center.
  marks.push({ position: centroid, armLength: meanR * 0.2 });
  return {
    kind: 'bolt-circle',
    marks,
    lines,
    boltCircle: { center: centroid, radius: meanR },
  };
}

// ── Linear pattern ────────────────────────────────────────────

function buildLinearPattern(circles: CircleFeature[], opts: GeneratorOptions): PatternResult {
  // Sort centers along the line direction.
  const first = circles[0]!.center;
  const last = circles[circles.length - 1]!.center;
  const dirX = last.x - first.x;
  const dirY = last.y - first.y;
  const len = Math.hypot(dirX, dirY);
  const dir = len > 0 ? { x: dirX / len, y: dirY / len } : { x: 1, y: 0 };

  const sorted = [...circles].sort((a, b) =>
    (a.center.x - first.x) * dir.x + (a.center.y - first.y) * dir.y -
    ((b.center.x - first.x) * dir.x + (b.center.y - first.y) * dir.y),
  );
  const start: Vec2 = {
    x: sorted[0]!.center.x - dir.x * opts.lineOvershootMm,
    y: sorted[0]!.center.y - dir.y * opts.lineOvershootMm,
  };
  const end: Vec2 = {
    x: sorted[sorted.length - 1]!.center.x + dir.x * opts.lineOvershootMm,
    y: sorted[sorted.length - 1]!.center.y + dir.y * opts.lineOvershootMm,
  };
  const marks: CenterMark[] = sorted.map(c => ({
    position: c.center,
    armLength: c.radius * opts.crossArmFactor,
  }));
  const lines: CenterLine[] = [{ start, end, kind: 'primary' }];
  return {
    kind: 'linear',
    marks,
    lines,
    linearDirection: dir,
  };
}

// ── Helpers ────────────────────────────────────────────────────

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function computeCentroid(points: Vec2[]): Vec2 {
  let cx = 0, cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / Math.max(1, points.length), y: cy / Math.max(1, points.length) };
}

function allCollinear(points: Vec2[], tol: number): boolean {
  if (points.length < 2) return true;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return false;
  for (const p of points) {
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len);
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    if (Math.hypot(p.x - projX, p.y - projY) > tol) return false;
  }
  return true;
}

// ── Summary ────────────────────────────────────────────────────

export interface PatternSummary {
  kind: PatternKind;
  markCount: number;
  lineCount: number;
  hasBoltCircle: boolean;
  hasLinear: boolean;
}

export function summarize(result: PatternResult): PatternSummary {
  return {
    kind: result.kind,
    markCount: result.marks.length,
    lineCount: result.lines.length,
    hasBoltCircle: result.boltCircle !== undefined,
    hasLinear: result.linearDirection !== undefined,
  };
}
