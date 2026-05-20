/**
 * leadOptimizationArc.ts — Optimise lead-in / lead-out arcs so the
 * tool enters and exits the cut smoothly without dwell marks.
 *
 * Lead-in/out parameters:
 *   - Tangential vs perpendicular entry.
 *   - Arc radius (typically tool diameter × 0.4-1.0).
 *   - Sweep angle (typically 45-90°).
 *
 * The optimiser balances:
 *   - Material removal during entry (low feed force).
 *   - Distance overhead (long lead = longer cycle time).
 *   - Surface finish at entry / exit points.
 */

export interface Vec2 { x: number; y: number }

export interface CutSegment {
  start: Vec2;
  end: Vec2;
  /** Direction of cut at start (unit vector). */
  startDirection: Vec2;
}

export interface LeadOptions {
  toolDiameterMm: number;
  /** Lead style. */
  style: 'tangent-arc' | 'perpendicular' | 'horizontal';
  /** Sweep angle (deg). */
  sweepDeg: number;
  /** Radius factor multiplied with tool diameter. */
  radiusFactor: number;
}

export const DEFAULT_OPTIONS: LeadOptions = {
  toolDiameterMm: 10,
  style: 'tangent-arc',
  sweepDeg: 90,
  radiusFactor: 0.5,
};

export interface LeadArc {
  /** Sequence of points describing the arc. */
  points: Vec2[];
  /** Total arc length (mm). */
  lengthMm: number;
  /** Arc centre. */
  centre: Vec2;
  /** Sweep angle (rad). */
  sweepRad: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function generateLeadIn(segment: CutSegment, options: Partial<LeadOptions> = {}): LeadArc {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const radius = opts.toolDiameterMm * opts.radiusFactor;
  const sweepRad = (opts.sweepDeg * Math.PI) / 180;
  const dir = normalize(segment.startDirection);
  const perp = perpendicular(dir);

  // Centre offset from start, perpendicular to start direction.
  const centre: Vec2 = { x: segment.start.x + perp.x * radius, y: segment.start.y + perp.y * radius };
  // Compute lead arc points sweeping from − sweepRad to 0 (ending at segment start).
  const samples = 16;
  const points: Vec2[] = [];
  const startAngle = Math.atan2(segment.start.y - centre.y, segment.start.x - centre.x);
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const ang = startAngle - sweepRad + sweepRad * t;
    points.push({ x: centre.x + radius * Math.cos(ang), y: centre.y + radius * Math.sin(ang) });
  }
  const arcLength = radius * sweepRad;
  return { points, lengthMm: arcLength, centre, sweepRad };
}

export function generateLeadOut(segment: CutSegment, options: Partial<LeadOptions> = {}): LeadArc {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const radius = opts.toolDiameterMm * opts.radiusFactor;
  const sweepRad = (opts.sweepDeg * Math.PI) / 180;
  const dir = normalize(segment.startDirection);
  const perp = perpendicular(dir);
  const centre: Vec2 = { x: segment.end.x + perp.x * radius, y: segment.end.y + perp.y * radius };
  const samples = 16;
  const points: Vec2[] = [];
  const startAngle = Math.atan2(segment.end.y - centre.y, segment.end.x - centre.x);
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const ang = startAngle + sweepRad * t;
    points.push({ x: centre.x + radius * Math.cos(ang), y: centre.y + radius * Math.sin(ang) });
  }
  const arcLength = radius * sweepRad;
  return { points, lengthMm: arcLength, centre, sweepRad };
}

// ── Helpers ──────────────────────────────────────────────────

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len === 0) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function perpendicular(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x };
}

// ── Optimise sweep angle for surface finish ──────────────────

export interface SweepOptimisation {
  bestSweepDeg: number;
  bestRadiusFactor: number;
  estimatedSurfaceRaMicron: number;
}

export function optimiseSweep(toolDiameterMm: number, materialKind: 'aluminum' | 'steel' | 'inconel'): SweepOptimisation {
  const baseRa = materialKind === 'aluminum' ? 0.8 : materialKind === 'steel' ? 1.6 : 3.2;
  // Larger sweep → smoother entry; cap at 180°.
  const sweep = materialKind === 'inconel' ? 120 : 90;
  const radiusFactor = materialKind === 'inconel' ? 1.0 : 0.5;
  void toolDiameterMm;
  return { bestSweepDeg: sweep, bestRadiusFactor: radiusFactor, estimatedSurfaceRaMicron: baseRa * 0.6 };
}

// ── Compare lead styles ──────────────────────────────────────

export interface StyleComparison {
  style: LeadOptions['style'];
  arcLengthMm: number;
}

export function compareStyles(segment: CutSegment, toolDiameter: number): StyleComparison[] {
  const styles: LeadOptions['style'][] = ['tangent-arc', 'perpendicular', 'horizontal'];
  return styles.map(s => {
    const arc = generateLeadIn(segment, { toolDiameterMm: toolDiameter, style: s, sweepDeg: 90, radiusFactor: 0.5 });
    return { style: s, arcLengthMm: arc.lengthMm };
  });
}

// ── Summary ────────────────────────────────────────────────────

export interface LeadSummary {
  inLengthMm: number;
  outLengthMm: number;
  totalOverhead: number;
}

export function summarize(leadIn: LeadArc, leadOut: LeadArc): LeadSummary {
  return {
    inLengthMm: leadIn.lengthMm,
    outLengthMm: leadOut.lengthMm,
    totalOverhead: leadIn.lengthMm + leadOut.lengthMm,
  };
}
