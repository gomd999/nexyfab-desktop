/**
 * microLiftRetract.ts — Generate micro-lift retract moves between CAM
 * segments to prevent dragging the tool across the cut.
 *
 * Without retract, when a tool finishes one cut segment and rapids to
 * the next, the rapid path stays at cutting depth — dragging the
 * tool tip across the finished surface and leaving scratches.
 *
 * Micro-lift: raise the tool a small amount (0.1-1 mm) before rapid
 * move, then plunge back to cut depth at the next segment. Module:
 *
 *   - Detects segment endpoints that are not contiguous.
 *   - Inserts micro-lift retract + plunge moves.
 *   - Computes added cycle time.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface PathSegment {
  id: string;
  start: Vec3;
  end: Vec3;
  /** Feed rate (mm/min) for the cut segment. */
  feedMmMin: number;
}

export interface MicroLiftOptions {
  /** Lift height (mm). */
  liftHeightMm: number;
  /** Plunge feed rate. */
  plungeFeedMmMin: number;
  /** Rapid feed rate. */
  rapidFeedMmMin: number;
  /** Minimum gap that triggers a lift (mm). */
  minGapMm: number;
}

export const DEFAULT_OPTIONS: MicroLiftOptions = {
  liftHeightMm: 0.5,
  plungeFeedMmMin: 500,
  rapidFeedMmMin: 5000,
  minGapMm: 0.1,
};

export interface AugmentedMove {
  command: 'feed' | 'lift' | 'rapid' | 'plunge';
  start: Vec3;
  end: Vec3;
  feedMmMin: number;
}

export interface AugmentResult {
  moves: AugmentedMove[];
  liftCount: number;
  /** Total added time vs no-lift baseline (seconds). */
  addedTimeSec: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function augmentWithMicroLift(segments: PathSegment[], options: Partial<MicroLiftOptions> = {}): AugmentResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const moves: AugmentedMove[] = [];
  let liftCount = 0;
  let addedTime = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    moves.push({ command: 'feed', start: seg.start, end: seg.end, feedMmMin: seg.feedMmMin });
    if (i + 1 >= segments.length) continue;
    const next = segments[i + 1]!;
    const gap = distance(seg.end, next.start);
    if (gap < opts.minGapMm) continue;
    // Insert lift + rapid + plunge.
    liftCount++;
    const liftStart = seg.end;
    const liftEnd: Vec3 = { x: seg.end.x, y: seg.end.y, z: seg.end.z + opts.liftHeightMm };
    const rapidEnd: Vec3 = { x: next.start.x, y: next.start.y, z: next.start.z + opts.liftHeightMm };
    const plungeEnd: Vec3 = next.start;
    moves.push({ command: 'lift', start: liftStart, end: liftEnd, feedMmMin: opts.plungeFeedMmMin });
    moves.push({ command: 'rapid', start: liftEnd, end: rapidEnd, feedMmMin: opts.rapidFeedMmMin });
    moves.push({ command: 'plunge', start: rapidEnd, end: plungeEnd, feedMmMin: opts.plungeFeedMmMin });
    // Added time vs straight-line rapid at rapidFeed.
    const liftDist = opts.liftHeightMm;
    const rapidDist = distance(liftEnd, rapidEnd);
    const plungeDist = opts.liftHeightMm;
    const augTime = liftDist / opts.plungeFeedMmMin + rapidDist / opts.rapidFeedMmMin + plungeDist / opts.plungeFeedMmMin;
    const baselineTime = distance(seg.end, next.start) / opts.rapidFeedMmMin;
    addedTime += (augTime - baselineTime) * 60;
  }
  return { moves, liftCount, addedTimeSec: addedTime };
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// ── G-code emit ───────────────────────────────────────────────

export function emitGcode(result: AugmentResult): string[] {
  const lines: string[] = [];
  for (const m of result.moves) {
    const cmd = m.command === 'rapid' ? 'G0' : 'G1';
    const f = m.command === 'rapid' ? '' : ` F${m.feedMmMin.toFixed(0)}`;
    lines.push(`${cmd} X${m.end.x.toFixed(3)} Y${m.end.y.toFixed(3)} Z${m.end.z.toFixed(3)}${f}`);
  }
  return lines;
}

// ── Time / motion stats ──────────────────────────────────────

export interface MotionStats {
  totalDistanceMm: number;
  totalTimeSec: number;
  feedDistance: number;
  rapidDistance: number;
  plungeDistance: number;
}

export function motionStats(result: AugmentResult): MotionStats {
  let feed = 0, rapid = 0, plunge = 0, total = 0, time = 0;
  for (const m of result.moves) {
    const d = distance(m.start, m.end);
    total += d;
    time += (d / Math.max(0.001, m.feedMmMin)) * 60;
    if (m.command === 'feed') feed += d;
    else if (m.command === 'rapid') rapid += d;
    else if (m.command === 'plunge' || m.command === 'lift') plunge += d;
  }
  return {
    totalDistanceMm: total,
    totalTimeSec: time,
    feedDistance: feed,
    rapidDistance: rapid,
    plungeDistance: plunge,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface MicroLiftSummary {
  segmentCount: number;
  liftCount: number;
  addedTimeSec: number;
  totalMoveCount: number;
}

export function summarize(segments: PathSegment[], result: AugmentResult): MicroLiftSummary {
  return {
    segmentCount: segments.length,
    liftCount: result.liftCount,
    addedTimeSec: result.addedTimeSec,
    totalMoveCount: result.moves.length,
  };
}
