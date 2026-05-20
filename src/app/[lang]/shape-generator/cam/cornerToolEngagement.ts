/**
 * cornerToolEngagement.ts — Compute radial tool engagement around
 * an internal corner.
 *
 * When a milling tool follows an outline with an inside corner, the
 * radial engagement (chip width) spikes at the corner. Excessive
 * engagement causes:
 *
 *   - Chatter / squeal
 *   - Tool deflection / breakage
 *   - Surface defects on the wall
 *
 * Mitigation: either slow down at the corner (feed rate override)
 * or pre-rough with a smaller cutter so the engagement stays bounded.
 *
 * Engagement formula (Otkur 2007):
 *
 *   ae_max ≈ R · (1 - cos(α/2))    (semi-circle approximation)
 *
 * for a corner whose interior angle is α and tool radius R. Module
 * computes engagement, ramps feed override, and suggests pre-rough
 * tool diameter.
 */

export interface CornerSpec {
  id: string;
  /** Interior angle of the corner (degrees). */
  interiorAngleDeg: number;
  /** Wall fillet radius (mm); 0 for sharp. */
  filletRadiusMm: number;
  /** Side step (radial DOC) commanded for the outline pass. */
  commandedAeMm: number;
}

export interface ToolSpec {
  diameterMm: number;
  flutes: number;
  maxRadialEngagementMm: number;
}

export interface EngagementOptions {
  /** Maximum allowable feed override factor (e.g., 0.3 = 30%). */
  minFeedOverride: number;
  /** Whether to suggest a pre-rough tool when engagement too high. */
  allowPreRough: boolean;
}

export const DEFAULT_OPTIONS: EngagementOptions = {
  minFeedOverride: 0.3,
  allowPreRough: true,
};

export interface CornerEngagement {
  cornerId: string;
  /** Peak radial engagement (mm) at the corner. */
  peakEngagementMm: number;
  /** Engagement ratio (peak / commanded). */
  spikeRatio: number;
  /** Feed override at the corner (1.0 = no slowdown). */
  feedOverride: number;
  /** Pre-rough tool diameter suggestion, if needed. */
  preRoughDiameterMm?: number;
  /** Whether action is required to safely cut this corner. */
  unsafe: boolean;
}

// ── Top-level entry ────────────────────────────────────────────

export function evaluateCorners(
  corners: CornerSpec[],
  tool: ToolSpec,
  options: Partial<EngagementOptions> = {},
): CornerEngagement[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return corners.map(c => evaluateOne(c, tool, opts));
}

function evaluateOne(corner: CornerSpec, tool: ToolSpec, opts: EngagementOptions): CornerEngagement {
  const toolRadius = tool.diameterMm / 2;
  const alphaRad = (corner.interiorAngleDeg * Math.PI) / 180;

  // For sharp inner corner, peak engagement ≈ toolRadius (full diameter sweeps the inside).
  // For filleted corner with radius rF ≥ tool radius, peak ≈ commanded ae.
  let peak: number;
  if (corner.filletRadiusMm >= toolRadius) {
    peak = corner.commandedAeMm;
  } else {
    // Approximate using semi-circle penetration depth.
    const penetration = toolRadius * (1 - Math.cos((Math.PI - alphaRad) / 2));
    peak = Math.max(corner.commandedAeMm, corner.commandedAeMm + penetration);
  }
  const spike = peak / Math.max(0.0001, corner.commandedAeMm);
  let override = 1.0;
  if (peak > tool.maxRadialEngagementMm) {
    override = Math.max(opts.minFeedOverride, tool.maxRadialEngagementMm / peak);
  }
  const unsafe = peak > tool.maxRadialEngagementMm * 1.5;
  const result: CornerEngagement = {
    cornerId: corner.id,
    peakEngagementMm: peak,
    spikeRatio: spike,
    feedOverride: override,
    unsafe,
  };
  if (opts.allowPreRough && unsafe) {
    // Suggest a tool small enough that its diameter < remaining fillet pocket.
    result.preRoughDiameterMm = Math.max(1, tool.diameterMm * 0.5);
  }
  return result;
}

// ── Feed-rate trajectory ──────────────────────────────────────

export interface FeedSchedule {
  cornerId: string;
  approachOverride: number;
  cornerOverride: number;
  exitOverride: number;
}

export function buildFeedSchedule(engagements: CornerEngagement[]): FeedSchedule[] {
  return engagements.map(e => ({
    cornerId: e.cornerId,
    approachOverride: Math.max(0.5, e.feedOverride + 0.1),
    cornerOverride: e.feedOverride,
    exitOverride: Math.max(0.6, e.feedOverride + 0.2),
  }));
}

// ── Aggregate analysis ────────────────────────────────────────

export interface CornerAnalysis {
  totalCorners: number;
  unsafeCount: number;
  worstSpikeRatio: number;
  averageOverride: number;
}

export function aggregateCorners(engagements: CornerEngagement[]): CornerAnalysis {
  let worstSpike = 0;
  let unsafe = 0;
  let totalOverride = 0;
  for (const e of engagements) {
    if (e.spikeRatio > worstSpike) worstSpike = e.spikeRatio;
    if (e.unsafe) unsafe++;
    totalOverride += e.feedOverride;
  }
  return {
    totalCorners: engagements.length,
    unsafeCount: unsafe,
    worstSpikeRatio: worstSpike,
    averageOverride: engagements.length === 0 ? 1 : totalOverride / engagements.length,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface EngagementSummary {
  cornerCount: number;
  unsafeCount: number;
  worstPeakEngagementMm: number;
  averageOverride: number;
}

export function summarize(engagements: CornerEngagement[]): EngagementSummary {
  const agg = aggregateCorners(engagements);
  let worstPeak = 0;
  for (const e of engagements) if (e.peakEngagementMm > worstPeak) worstPeak = e.peakEngagementMm;
  return {
    cornerCount: engagements.length,
    unsafeCount: agg.unsafeCount,
    worstPeakEngagementMm: worstPeak,
    averageOverride: agg.averageOverride,
  };
}
