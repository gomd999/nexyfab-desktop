/**
 * facingStrategySpiral.ts — Generate spiral facing toolpath for a
 * rectangular or circular face.
 *
 * Spiral facing eliminates the rapid moves of conventional raster
 * facing — the tool stays engaged throughout the pass, producing
 * smoother surface finish and better tool life.
 *
 * Two variants supported:
 *
 *   - Square spiral (good for rectangular stock): step-in pattern.
 *   - Circular spiral: Archimedean spiral on a round face.
 *
 * Module emits the path polyline + estimated MRR and time.
 */

export interface Vec2 { x: number; y: number }

export interface RectangularFace {
  kind: 'rect';
  min: Vec2;
  max: Vec2;
}

export interface CircularFace {
  kind: 'circle';
  centre: Vec2;
  radiusMm: number;
}

export type Face = RectangularFace | CircularFace;

export interface FacingOptions {
  /** Step-over per pass (mm). */
  stepoverMm: number;
  /** Direction: outside-in or inside-out. */
  direction: 'outside-in' | 'inside-out';
  /** Feed rate (mm/min). */
  feedMmMin: number;
  /** Final pass overlap (mm). */
  finishOverlapMm: number;
}

export const DEFAULT_OPTIONS: FacingOptions = {
  stepoverMm: 4,
  direction: 'outside-in',
  feedMmMin: 800,
  finishOverlapMm: 1,
};

export interface FacingResult {
  pathPoints: Vec2[];
  totalLengthMm: number;
  estimatedTimeSec: number;
  passCount: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function generateFacing(face: Face, options: Partial<FacingOptions> = {}): FacingResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (face.kind === 'rect') return rectangularSpiral(face, opts);
  return circularSpiral(face, opts);
}

// ── Rectangular spiral ────────────────────────────────────────

function rectangularSpiral(face: RectangularFace, opts: FacingOptions): FacingResult {
  const points: Vec2[] = [];
  let minX = face.min.x;
  let minY = face.min.y;
  let maxX = face.max.x;
  let maxY = face.max.y;
  let passes = 0;
  while (minX < maxX && minY < maxY) {
    points.push({ x: minX, y: minY });
    points.push({ x: maxX, y: minY });
    points.push({ x: maxX, y: maxY });
    points.push({ x: minX, y: maxY });
    points.push({ x: minX, y: minY + opts.stepoverMm });
    minX += opts.stepoverMm;
    minY += opts.stepoverMm;
    maxX -= opts.stepoverMm;
    maxY -= opts.stepoverMm;
    passes++;
    if (passes > 1000) break;
  }
  if (opts.direction === 'inside-out') points.reverse();

  const length = polylineLength(points);
  const timeSec = (length / Math.max(0.001, opts.feedMmMin)) * 60;
  return { pathPoints: points, totalLengthMm: length, estimatedTimeSec: timeSec, passCount: passes };
}

// ── Circular spiral ───────────────────────────────────────────

function circularSpiral(face: CircularFace, opts: FacingOptions): FacingResult {
  const points: Vec2[] = [];
  const samplesPerTurn = 64;
  const totalRadius = face.radiusMm;
  const radialStep = opts.stepoverMm / (2 * Math.PI);
  const totalTurns = totalRadius / opts.stepoverMm;
  const totalSamples = Math.ceil(totalTurns * samplesPerTurn);
  for (let i = 0; i <= totalSamples; i++) {
    const theta = (i / samplesPerTurn) * 2 * Math.PI;
    const r = i * radialStep;
    if (r > totalRadius) break;
    points.push({
      x: face.centre.x + r * Math.cos(theta),
      y: face.centre.y + r * Math.sin(theta),
    });
  }
  if (opts.direction === 'outside-in') points.reverse();
  const length = polylineLength(points);
  const timeSec = (length / Math.max(0.001, opts.feedMmMin)) * 60;
  return {
    pathPoints: points,
    totalLengthMm: length,
    estimatedTimeSec: timeSec,
    passCount: Math.ceil(totalTurns),
  };
}

// ── Length helper ────────────────────────────────────────────

function polylineLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

// ── MRR (material removal rate) estimate ─────────────────────

export interface MrrEstimate {
  mrrMm3PerMin: number;
  totalVolumeMm3: number;
}

export function estimateMrr(face: Face, depthMm: number, opts: FacingOptions = DEFAULT_OPTIONS): MrrEstimate {
  const result = generateFacing(face, opts);
  const area = face.kind === 'rect'
    ? (face.max.x - face.min.x) * (face.max.y - face.min.y)
    : Math.PI * face.radiusMm * face.radiusMm;
  const totalVolume = area * depthMm;
  const minutes = result.estimatedTimeSec / 60;
  const mrr = minutes === 0 ? 0 : totalVolume / minutes;
  return { mrrMm3PerMin: mrr, totalVolumeMm3: totalVolume };
}

// ── G-code emission (Fanuc-style) ─────────────────────────────

export function emitGcode(result: FacingResult, opts: FacingOptions = DEFAULT_OPTIONS): string[] {
  const lines: string[] = [];
  if (result.pathPoints.length === 0) return lines;
  const first = result.pathPoints[0]!;
  lines.push(`G0 X${first.x.toFixed(3)} Y${first.y.toFixed(3)}`);
  for (let i = 1; i < result.pathPoints.length; i++) {
    const p = result.pathPoints[i]!;
    lines.push(`G1 X${p.x.toFixed(3)} Y${p.y.toFixed(3)} F${opts.feedMmMin}`);
  }
  return lines;
}

// ── Summary ────────────────────────────────────────────────────

export interface FacingSummary {
  faceKind: 'rect' | 'circle';
  pointCount: number;
  totalLengthMm: number;
  estimatedTimeSec: number;
  passCount: number;
}

export function summarize(face: Face, result: FacingResult): FacingSummary {
  return {
    faceKind: face.kind,
    pointCount: result.pathPoints.length,
    totalLengthMm: result.totalLengthMm,
    estimatedTimeSec: result.estimatedTimeSec,
    passCount: result.passCount,
  };
}
