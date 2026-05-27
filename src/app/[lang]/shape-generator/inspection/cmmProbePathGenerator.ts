/**
 * cmmProbePathGenerator.ts — Generate CMM probe paths from a set of
 * inspection points.
 *
 * A CMM probe doesn't just teleport from point to point — it has
 * to:
 *
 *   1. Move from a safe `clearancePoint` (well above the part).
 *   2. Descend toward the measurement point along the surface
 *      normal (the *approach* segment), slowing to the measurement
 *      feed rate just before contact.
 *   3. Touch the surface (the actual measurement).
 *   4. Retract back along the normal to the safe height.
 *   5. Move to the next point's clearance position.
 *
 * Wrong approach angle = probe shaft hits the part instead of the
 * tip. Wrong retract = part scratched on way out. Wrong sequence =
 * unnecessary axis travel + long inspection cycles.
 *
 * This module:
 *
 *   - Builds approach + measure + retract motion segments per point.
 *   - Picks a sensible sequence (nearest-neighbor TSP heuristic).
 *   - Reports total travel + measurement time at given feedrates.
 *   - Flags points whose approach vector clashes with another
 *     measurement (probe-shaft collision).
 */

export interface Vec3 { x: number; y: number; z: number }

export interface InspectionPoint {
  id: string;
  /** Nominal location of the measurement (where the tip touches). */
  target: Vec3;
  /** Outward surface normal at the target (probe approaches along -normal). */
  normal: Vec3;
  /** Optional tolerance (mm) for the measurement. */
  toleranceMm?: number;
}

export type SegmentKind = 'rapid' | 'approach' | 'measure' | 'retract';

export interface ProbeSegment {
  kind: SegmentKind;
  /** Start position. */
  start: Vec3;
  /** End position. */
  end: Vec3;
  /** Length of segment, mm. */
  lengthMm: number;
  /** Optional source point id. */
  pointId?: string;
}

export interface ProbePathResult {
  segments: ProbeSegment[];
  /** Ordered point ids visited. */
  visitOrder: string[];
  /** Total rapid travel, mm. */
  totalRapidMm: number;
  /** Total feed travel, mm (approach + measure + retract). */
  totalFeedMm: number;
  /** Total time estimate at given feeds. */
  estimatedTimeSec: number;
  /** Probe shaft potential collisions detected. */
  collisionFlags: Array<{ pointId: string; reason: string }>;
}

export interface PathOptions {
  /** Distance above target where probe slows to feed (clearance), mm. */
  approachDistanceMm: number;
  /** Distance to retract before lifting to clearance, mm. */
  retractDistanceMm: number;
  /** Safe clearance plane Z (relative to part top), mm. */
  clearanceZMm: number;
  /** Rapid feed rate, mm/min. */
  rapidFeedMmPerMin: number;
  /** Approach/retract feed rate, mm/min. */
  approachFeedMmPerMin: number;
  /** Measurement settle time, sec. */
  measureSettleSec: number;
  /** Use nearest-neighbor sequencing. If false, preserves input order. */
  optimizeSequence: boolean;
  /** Origin for probe (home / tool change), mm. */
  homePosition?: Vec3;
}

export const DEFAULT_OPTIONS: PathOptions = {
  approachDistanceMm: 2.0,
  retractDistanceMm: 2.0,
  clearanceZMm: 25.0,
  rapidFeedMmPerMin: 5000,
  approachFeedMmPerMin: 100,
  measureSettleSec: 0.5,
  optimizeSequence: true,
};

// ── Top-level entry ────────────────────────────────────────────

export function generateProbePath(points: InspectionPoint[], options: Partial<PathOptions> = {}): ProbePathResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (points.length === 0) {
    return { segments: [], visitOrder: [], totalRapidMm: 0, totalFeedMm: 0, estimatedTimeSec: 0, collisionFlags: [] };
  }
  const sequence = opts.optimizeSequence ? nearestNeighborOrder(points, opts.homePosition) : points;
  const segments: ProbeSegment[] = [];
  let currentPos: Vec3 = opts.homePosition ?? clearancePosFor(sequence[0]!, opts.clearanceZMm);
  const visitOrder: string[] = [];

  for (const pt of sequence) {
    visitOrder.push(pt.id);
    const clearance = clearancePosFor(pt, opts.clearanceZMm);
    // Rapid to clearance over the point.
    segments.push(makeSegment('rapid', currentPos, clearance, pt.id));
    // Approach: from clearance down to (target + approachDistance * normal).
    const approachStart = clearance;
    const approachEnd = offsetAlongNormal(pt.target, pt.normal, opts.approachDistanceMm);
    segments.push(makeSegment('approach', approachStart, approachEnd, pt.id));
    // Measure: approachEnd → target.
    segments.push(makeSegment('measure', approachEnd, pt.target, pt.id));
    // Retract: target → target + retractDistance * normal.
    const retractEnd = offsetAlongNormal(pt.target, pt.normal, opts.retractDistanceMm);
    segments.push(makeSegment('retract', pt.target, retractEnd, pt.id));
    currentPos = retractEnd;
  }

  // Totals.
  let rapid = 0, feed = 0;
  for (const s of segments) {
    if (s.kind === 'rapid') rapid += s.lengthMm;
    else feed += s.lengthMm;
  }
  const rapidTime = rapid / opts.rapidFeedMmPerMin * 60;
  const feedTime = feed / opts.approachFeedMmPerMin * 60;
  const settleTime = points.length * opts.measureSettleSec;
  const estimatedTimeSec = rapidTime + feedTime + settleTime;

  const collisions = detectShaftCollisions(sequence);

  return {
    segments,
    visitOrder,
    totalRapidMm: rapid,
    totalFeedMm: feed,
    estimatedTimeSec,
    collisionFlags: collisions,
  };
}

// ── Sequencing ────────────────────────────────────────────────

function nearestNeighborOrder(points: InspectionPoint[], home?: Vec3): InspectionPoint[] {
  const remaining = [...points];
  const out: InspectionPoint[] = [];
  let cur: Vec3 = home ?? points[0]!.target;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distance(cur, remaining[i]!.target);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0]!;
    out.push(next);
    cur = next.target;
  }
  return out;
}

// ── Helpers ────────────────────────────────────────────────────

function clearancePosFor(pt: InspectionPoint, clearanceZ: number): Vec3 {
  // Clearance: directly above the point on the part-top plane.
  return { x: pt.target.x, y: pt.target.y, z: clearanceZ };
}

function offsetAlongNormal(target: Vec3, normal: Vec3, distance: number): Vec3 {
  const n = normalize(normal);
  return {
    x: target.x + n.x * distance,
    y: target.y + n.y * distance,
    z: target.z + n.z * distance,
  };
}

function makeSegment(kind: SegmentKind, start: Vec3, end: Vec3, pointId?: string): ProbeSegment {
  const length = distance(start, end);
  const seg: ProbeSegment = { kind, start, end, lengthMm: length };
  if (pointId) seg.pointId = pointId;
  return seg;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-9) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// ── Collision detection ───────────────────────────────────────

function detectShaftCollisions(points: InspectionPoint[]): Array<{ pointId: string; reason: string }> {
  // If two adjacent points are very close (< 1mm) and have nearly
  // opposite normals → the probe might tip-collide between them.
  const flags: Array<{ pointId: string; reason: string }> = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dist = distance(a.target, b.target);
    if (dist < 1.0) {
      const dotN = a.normal.x * b.normal.x + a.normal.y * b.normal.y + a.normal.z * b.normal.z;
      if (dotN < -0.5) {
        flags.push({ pointId: b.id, reason: `close to ${a.id} with opposing normal` });
      }
    }
  }
  return flags;
}

// ── Summary ────────────────────────────────────────────────────

export interface PathSummary {
  pointCount: number;
  totalTravelMm: number;
  estimatedMinutes: number;
  collisionCount: number;
  rapidFraction: number;
}

export function summarize(result: ProbePathResult): PathSummary {
  const total = result.totalRapidMm + result.totalFeedMm;
  return {
    pointCount: result.visitOrder.length,
    totalTravelMm: total,
    estimatedMinutes: result.estimatedTimeSec / 60,
    collisionCount: result.collisionFlags.length,
    rapidFraction: total > 0 ? result.totalRapidMm / total : 0,
  };
}
