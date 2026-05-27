/**
 * stockEngagementLimiter.ts — Limit radial stock engagement angle
 * along a milling tool-path to prevent overload.
 *
 * Adaptive (trochoidal / HSM) machining keeps engagement angle
 * ε constant ≤ 35° to keep cutting force predictable. Conventional
 * paths spike when entering pockets / corners.
 *
 * Module:
 *
 *   - For each tool path segment, computes radial engagement based
 *     on stepover ae and tool radius R.
 *     ε = 2·arccos(1 − ae/R)   (full slot ae = 2R → ε = 180°)
 *   - If ε exceeds the user limit, recommends a smaller ae (engaging
 *     step) or feedrate reduction.
 *   - Identifies the worst-offending segments.
 */

export interface ToolPathSegment {
  id: string;
  /** Step-over (radial DOC) commanded along this segment. */
  stepoverMm: number;
  /** Path length (mm). */
  lengthMm: number;
  /** Tool diameter (mm) — may vary if multi-tool path. */
  toolDiameterMm: number;
  /** Optional feed (mm/min) for time calculation. */
  feedMmMin?: number;
}

export interface LimitOptions {
  /** Maximum allowable engagement angle (deg). */
  maxEngagementDeg: number;
  /** Allow feedrate scaling instead of stepover reduction. */
  preferFeedOverride: boolean;
}

export const DEFAULT_OPTIONS: LimitOptions = {
  maxEngagementDeg: 35,
  preferFeedOverride: false,
};

export interface SegmentResult {
  segmentId: string;
  computedEngagementDeg: number;
  /** Adjusted stepover (if reduction recommended). */
  adjustedStepoverMm: number;
  /** Adjusted feed override (1.0 = no change). */
  feedOverride: number;
  recommendedAction: 'ok' | 'reduce-stepover' | 'reduce-feed' | 'remove-segment';
}

// ── Top-level entry ────────────────────────────────────────────

export function applyLimits(segments: ToolPathSegment[], options: Partial<LimitOptions> = {}): SegmentResult[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return segments.map(seg => evaluateSegment(seg, opts));
}

function evaluateSegment(seg: ToolPathSegment, opts: LimitOptions): SegmentResult {
  const R = seg.toolDiameterMm / 2;
  if (R <= 0) {
    return {
      segmentId: seg.id, computedEngagementDeg: 0, adjustedStepoverMm: seg.stepoverMm,
      feedOverride: 1, recommendedAction: 'ok',
    };
  }
  const eps = engagementAngleDeg(seg.stepoverMm, R);
  if (eps <= opts.maxEngagementDeg) {
    return { segmentId: seg.id, computedEngagementDeg: eps, adjustedStepoverMm: seg.stepoverMm, feedOverride: 1, recommendedAction: 'ok' };
  }
  if (opts.preferFeedOverride) {
    const ratio = opts.maxEngagementDeg / eps;
    return {
      segmentId: seg.id, computedEngagementDeg: eps,
      adjustedStepoverMm: seg.stepoverMm,
      feedOverride: Math.max(0.2, ratio),
      recommendedAction: 'reduce-feed',
    };
  }
  const maxAe = R * (1 - Math.cos(opts.maxEngagementDeg * Math.PI / 180));
  if (maxAe <= 0) {
    return { segmentId: seg.id, computedEngagementDeg: eps, adjustedStepoverMm: 0, feedOverride: 0, recommendedAction: 'remove-segment' };
  }
  return {
    segmentId: seg.id, computedEngagementDeg: eps,
    adjustedStepoverMm: maxAe, feedOverride: 1,
    recommendedAction: 'reduce-stepover',
  };
}

export function engagementAngleDeg(stepoverMm: number, radiusMm: number): number {
  if (radiusMm <= 0 || stepoverMm <= 0) return 0;
  const ae = Math.min(2 * radiusMm, Math.max(0, stepoverMm));
  // Peripheral milling engagement: ε = arccos((R − ae)/R); slot ae=2R → 180°.
  const arg = 1 - ae / radiusMm;
  const cos = Math.max(-1, Math.min(1, arg));
  return (Math.acos(cos) * 180) / Math.PI;
}

// ── Path metrics ──────────────────────────────────────────────

export interface PathSummary {
  totalSegments: number;
  overLimitSegments: number;
  worstEngagementDeg: number;
  averageEngagementDeg: number;
}

export function analyzePath(segments: ToolPathSegment[], results: SegmentResult[]): PathSummary {
  let worst = 0;
  let totalDeg = 0;
  let overLimit = 0;
  for (const r of results) {
    if (r.computedEngagementDeg > worst) worst = r.computedEngagementDeg;
    totalDeg += r.computedEngagementDeg;
    if (r.recommendedAction !== 'ok') overLimit++;
  }
  return {
    totalSegments: segments.length,
    overLimitSegments: overLimit,
    worstEngagementDeg: worst,
    averageEngagementDeg: results.length === 0 ? 0 : totalDeg / results.length,
  };
}

// ── Recommendation summary ────────────────────────────────────

export interface RecommendationCounts {
  ok: number;
  reduceStepover: number;
  reduceFeed: number;
  removeSegment: number;
}

export function tallyRecommendations(results: SegmentResult[]): RecommendationCounts {
  let ok = 0, rs = 0, rf = 0, rm = 0;
  for (const r of results) {
    if (r.recommendedAction === 'ok') ok++;
    else if (r.recommendedAction === 'reduce-stepover') rs++;
    else if (r.recommendedAction === 'reduce-feed') rf++;
    else rm++;
  }
  return { ok, reduceStepover: rs, reduceFeed: rf, removeSegment: rm };
}

// ── Summary ────────────────────────────────────────────────────

export interface LimiterSummary {
  segmentCount: number;
  worstEngagementDeg: number;
  overLimitCount: number;
  okCount: number;
}

export function summarize(results: SegmentResult[]): LimiterSummary {
  const counts = tallyRecommendations(results);
  let worst = 0;
  for (const r of results) if (r.computedEngagementDeg > worst) worst = r.computedEngagementDeg;
  return {
    segmentCount: results.length,
    worstEngagementDeg: worst,
    overLimitCount: results.length - counts.ok,
    okCount: counts.ok,
  };
}
