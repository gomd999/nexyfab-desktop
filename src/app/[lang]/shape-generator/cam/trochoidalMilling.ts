/**
 * trochoidalMilling.ts — Generate trochoidal toolpath for slotting
 * and pocketing.
 *
 * In conventional slot milling, the cutter engages the full width
 * of the slot — high radial engagement → high tool stress + heat.
 * Trochoidal milling traces a small *circular* motion that
 * progressively advances along the slot axis. Each circle removes
 * a thin chip — low radial engagement → faster + cooler + longer
 * tool life.
 *
 * Output: a polyline of (x, y) points the caller turns into G2/G3
 * arcs or linear approximation.
 *
 * Parameters:
 *
 *   - Slot start/end points + width.
 *   - Tool diameter.
 *   - Step-over (advance per circle).
 *   - Radial engagement (0..1) — fraction of cutter diameter actively cutting.
 */

export interface Vec2 { x: number; y: number }

export interface TrochoidalInput {
  start: Vec2;
  end: Vec2;
  /** Slot width, mm. Must be ≥ toolDiameter. */
  widthMm: number;
  /** Tool diameter, mm. */
  toolDiameterMm: number;
  /** Advance per circle, mm. */
  stepoverMm: number;
  /** Radial engagement fraction (0..1). 0.1-0.2 typical. */
  radialEngagement: number;
  /** Samples per circle. */
  samplesPerCircle: number;
  /** Direction: climb (CCW around progression axis) or conventional. */
  direction: 'climb' | 'conventional';
}

export interface TrochoidalResult {
  points: Vec2[];
  /** Number of circles generated. */
  circleCount: number;
  /** Total path length, mm. */
  totalLengthMm: number;
  /** Radial engagement actually applied. */
  appliedEngagement: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function generateTrochoidalPath(input: TrochoidalInput): TrochoidalResult {
  const points: Vec2[] = [];
  const dx = input.end.x - input.start.x;
  const dy = input.end.y - input.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6 || input.toolDiameterMm <= 0 || input.widthMm < input.toolDiameterMm) {
    return { points: [], circleCount: 0, totalLengthMm: 0, appliedEngagement: 0 };
  }

  const axisX = dx / length;
  const axisY = dy / length;
  const perpX = -axisY;
  const perpY = axisX;

  // Cutter swing radius: half of (width - tool diameter) ≈ radius the tool center can travel laterally.
  const swingRadius = (input.widthMm - input.toolDiameterMm) / 2;

  // Radius of trochoidal circle = swingRadius (we keep the center constant for narrow slots) OR
  // smaller based on radial-engagement constraint.
  const maxByEngagement = (input.toolDiameterMm * input.radialEngagement) / 2;
  const circleRadius = Math.min(swingRadius, Math.max(0.1, maxByEngagement));
  const appliedEngagement = (2 * circleRadius) / input.toolDiameterMm;

  const numCircles = Math.max(1, Math.floor(length / input.stepoverMm));
  const sign = input.direction === 'climb' ? 1 : -1;

  for (let i = 0; i <= numCircles; i++) {
    const t = i * input.stepoverMm;
    const centerX = input.start.x + axisX * t;
    const centerY = input.start.y + axisY * t;
    for (let s = 0; s < input.samplesPerCircle; s++) {
      const theta = (s / input.samplesPerCircle) * 2 * Math.PI * sign;
      const x = centerX + Math.cos(theta) * circleRadius * perpX - Math.sin(theta) * circleRadius * axisX;
      const y = centerY + Math.cos(theta) * circleRadius * perpY - Math.sin(theta) * circleRadius * axisY;
      points.push({ x, y });
    }
  }

  return {
    points,
    circleCount: numCircles,
    totalLengthMm: polylineLength(points),
    appliedEngagement,
  };
}

// ── Estimate cutting time ─────────────────────────────────────

export interface TimeEstimate {
  cuttingTimeSec: number;
  feedMmPerMin: number;
  chipLoadMm: number;
}

export function estimateTime(result: TrochoidalResult, feedMmPerMin: number): TimeEstimate {
  const cuttingSec = feedMmPerMin > 0 ? (result.totalLengthMm / feedMmPerMin) * 60 : 0;
  return {
    cuttingTimeSec: cuttingSec,
    feedMmPerMin,
    chipLoadMm: 0, // caller computes per-tooth chip from RPM + flutes.
  };
}

// ── Helpers ────────────────────────────────────────────────────

function polylineLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

// ── Comparison vs conventional milling ────────────────────────

export interface ComparisonResult {
  trochoidalLengthMm: number;
  conventionalLengthMm: number;
  lengthRatio: number;
  recommendedReason: string;
}

export function compareWithConventional(input: TrochoidalInput, troch: TrochoidalResult): ComparisonResult {
  const dx = input.end.x - input.start.x;
  const dy = input.end.y - input.start.y;
  const conventionalLength = Math.hypot(dx, dy);
  const ratio = conventionalLength > 0 ? troch.totalLengthMm / conventionalLength : 0;
  const reason = ratio > 3
    ? 'trochoidal path longer but enables higher feed → faster cycle, less tool wear'
    : 'trochoidal path comparable — minor benefit for tool wear';
  return {
    trochoidalLengthMm: troch.totalLengthMm,
    conventionalLengthMm: conventionalLength,
    lengthRatio: ratio,
    recommendedReason: reason,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface PathSummary {
  pointCount: number;
  circleCount: number;
  totalLengthMm: number;
  appliedEngagement: number;
  isLowEngagement: boolean;
}

export function summarize(result: TrochoidalResult): PathSummary {
  return {
    pointCount: result.points.length,
    circleCount: result.circleCount,
    totalLengthMm: result.totalLengthMm,
    appliedEngagement: result.appliedEngagement,
    isLowEngagement: result.appliedEngagement <= 0.2,
  };
}
