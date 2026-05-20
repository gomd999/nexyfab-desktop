/**
 * cutVsAirTimeRatio.ts — Analyze CAM toolpaths for cutting vs
 * non-cutting (air) time.
 *
 * Operators want to know how much of the cycle is *productive*
 * (chips flying) vs wasted on rapids, lift-up, tool changes, dwell
 * times. Good toolpaths achieve > 70% cutting fraction.
 *
 * Module accepts a list of motion segments (already classified by
 * the CAM library) and returns:
 *
 *   - Cutting time / air time / dwell time totals.
 *   - Cutting fraction.
 *   - Breakdown per operation (e.g., per tool change).
 *   - Suggested improvements (e.g., reduce retract height).
 */

export type MotionKind = 'cutting' | 'rapid' | 'feed-no-cut' | 'dwell' | 'tool-change' | 'positioning';

export interface MotionSegment {
  /** Operation id this segment belongs to (e.g., "OP10"). */
  opId: string;
  kind: MotionKind;
  /** Time consumed by this segment, seconds. */
  timeSec: number;
  /** Distance moved (0 for dwells / tool changes), mm. */
  distanceMm: number;
}

export interface OperationStat {
  opId: string;
  totalSec: number;
  cuttingSec: number;
  cuttingFraction: number;
  segmentCount: number;
}

export interface CycleAnalysisResult {
  totalSec: number;
  cuttingSec: number;
  rapidSec: number;
  feedNoCutSec: number;
  dwellSec: number;
  toolChangeSec: number;
  positioningSec: number;
  cuttingFraction: number;
  perOperation: OperationStat[];
  recommendations: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function analyzeCycle(segments: MotionSegment[]): CycleAnalysisResult {
  if (segments.length === 0) {
    return {
      totalSec: 0, cuttingSec: 0, rapidSec: 0, feedNoCutSec: 0, dwellSec: 0, toolChangeSec: 0, positioningSec: 0,
      cuttingFraction: 0, perOperation: [], recommendations: [],
    };
  }
  const totals = { cutting: 0, rapid: 0, 'feed-no-cut': 0, dwell: 0, 'tool-change': 0, positioning: 0 };
  const opMap = new Map<string, OperationStat>();
  for (const seg of segments) {
    totals[seg.kind] += seg.timeSec;
    const op = opMap.get(seg.opId) ?? {
      opId: seg.opId, totalSec: 0, cuttingSec: 0, cuttingFraction: 0, segmentCount: 0,
    };
    op.totalSec += seg.timeSec;
    if (seg.kind === 'cutting') op.cuttingSec += seg.timeSec;
    op.segmentCount++;
    opMap.set(seg.opId, op);
  }
  for (const op of opMap.values()) {
    op.cuttingFraction = op.totalSec > 0 ? op.cuttingSec / op.totalSec : 0;
  }

  const total = totals.cutting + totals.rapid + totals['feed-no-cut'] + totals.dwell + totals['tool-change'] + totals.positioning;
  const cuttingFraction = total > 0 ? totals.cutting / total : 0;

  // Recommendations.
  const recs: string[] = [];
  if (cuttingFraction < 0.5) {
    recs.push('Cutting fraction below 50% — review rapid retract heights and tool changes.');
  }
  if (totals['tool-change'] > total * 0.15) {
    recs.push('Tool changes consume > 15% of cycle. Group operations by tool.');
  }
  if (totals.rapid > totals.cutting) {
    recs.push('Air (rapid) time exceeds cutting time — large stock-to-part gap or clamp clearance issues.');
  }
  if (totals.dwell > total * 0.05) {
    recs.push('Dwell time is significant; check for unnecessary M0 stops.');
  }

  return {
    totalSec: total,
    cuttingSec: totals.cutting,
    rapidSec: totals.rapid,
    feedNoCutSec: totals['feed-no-cut'],
    dwellSec: totals.dwell,
    toolChangeSec: totals['tool-change'],
    positioningSec: totals.positioning,
    cuttingFraction,
    perOperation: [...opMap.values()].sort((a, b) => b.totalSec - a.totalSec),
    recommendations: recs,
  };
}

// ── Comparison helper ─────────────────────────────────────────

export interface CycleComparison {
  beforeFraction: number;
  afterFraction: number;
  fractionDelta: number;
  beforeTotalSec: number;
  afterTotalSec: number;
  /** Time saved (positive = better). */
  timeSavedSec: number;
}

export function compareCycles(before: CycleAnalysisResult, after: CycleAnalysisResult): CycleComparison {
  return {
    beforeFraction: before.cuttingFraction,
    afterFraction: after.cuttingFraction,
    fractionDelta: after.cuttingFraction - before.cuttingFraction,
    beforeTotalSec: before.totalSec,
    afterTotalSec: after.totalSec,
    timeSavedSec: before.totalSec - after.totalSec,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface CycleSummary {
  totalMinutes: number;
  cuttingFraction: number;
  cuttingPercentage: number;
  operationCount: number;
  recommendationCount: number;
  isEfficient: boolean;
}

export function summarize(result: CycleAnalysisResult): CycleSummary {
  return {
    totalMinutes: result.totalSec / 60,
    cuttingFraction: result.cuttingFraction,
    cuttingPercentage: result.cuttingFraction * 100,
    operationCount: result.perOperation.length,
    recommendationCount: result.recommendations.length,
    isEfficient: result.cuttingFraction >= 0.7,
  };
}
