/**
 * adaptiveClearing.ts — Trochoidal (adaptive) roughing toolpath.
 *
 * Conventional pocketing engages the full tool diameter on every cut,
 * which spikes radial force when the tool enters tight corners. Modern
 * CAM (Mastercam Dynamic, Fusion Adaptive, HSMWorks) instead drives
 * the tool along *trochoidal* arcs that keep engagement angle constant.
 * Benefits:
 *   - Larger axial depths (full flute length)
 *   - Higher feeds at the same spindle load
 *   - Longer tool life (constant chip load)
 *
 * This module produces a simplified adaptive toolpath for a 2D pocket:
 *   - Walks the pocket centreline with a fixed step
 *   - Each centreline point emits a half-circle trochoid arc
 *   - Engagement angle clamped to the user-specified limit
 *
 * Real adaptive solvers track the remaining-material polygon and
 * re-solve engagement on the fly; this module is a teaching-grade
 * approximation suitable for preview + post-processor input.
 */

export interface AdaptiveClearingParams {
  /** Tool diameter (mm). */
  toolDiameterMm: number;
  /** Maximum tool engagement (% of tool diameter; e.g. 30 means
   *  the tool overlaps at most 30% with uncut stock). */
  maxEngagementPercent: number;
  /** Stepover between adjacent trochoid arcs (mm). */
  stepoverMm: number;
  /** Pocket centreline — list of 2D points the toolpath follows. */
  centreline: Array<[number, number]>;
  /** Axial depth per pass (mm). */
  axialDepthMm: number;
  /** Spindle speed (RPM). */
  spindleRpm: number;
  /** Feed rate (mm/min). */
  feedRateMmPerMin: number;
}

export interface TrochoidArc {
  /** Arc centre (mm). */
  centre: [number, number];
  /** Arc radius — half the tool diameter minus engagement. */
  radius: number;
  /** Start + end angle (radians). */
  startAngle: number;
  endAngle: number;
  /** Z depth of this pass. */
  zMm: number;
}

export interface AdaptiveToolpath {
  arcs: TrochoidArc[];
  /** Total path length (mm) — useful for cycle-time estimation. */
  totalLengthMm: number;
  /** Material removal rate (cm³/min). */
  mrrCm3PerMin: number;
}

/** Generate a trochoidal toolpath. */
export function generateAdaptiveClearing(params: AdaptiveClearingParams): AdaptiveToolpath {
  if (params.centreline.length < 2 || params.toolDiameterMm <= 0) {
    return { arcs: [], totalLengthMm: 0, mrrCm3PerMin: 0 };
  }
  const r = params.toolDiameterMm / 2;
  const engagementFraction = Math.min(0.95, Math.max(0.05, params.maxEngagementPercent / 100));
  // Arc radius such that engagement = engagementFraction × toolDia.
  const arcRadius = r * (1 - engagementFraction);
  const arcs: TrochoidArc[] = [];

  let totalLength = 0;
  for (let i = 0; i < params.centreline.length - 1; i++) {
    const a = params.centreline[i]!;
    const b = params.centreline[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const segLen = Math.hypot(dx, dy);
    if (segLen === 0) continue;
    const ux = dx / segLen;
    const uy = dy / segLen;
    // Walk segment in steps of stepoverMm.
    const stepLen = Math.max(0.1, params.stepoverMm);
    const stepCount = Math.max(1, Math.ceil(segLen / stepLen));
    for (let s = 0; s < stepCount; s++) {
      const t = (s + 0.5) / stepCount;
      const cx = a[0] + ux * segLen * t;
      const cy = a[1] + uy * segLen * t;
      // Trochoid arc — half-circle perpendicular to direction of travel.
      // Perp = (-uy, ux).
      arcs.push({
        centre: [cx, cy],
        radius: arcRadius,
        startAngle: Math.atan2(-ux, uy),  // perpendicular
        endAngle: Math.atan2(ux, -uy),    // opposite perpendicular
        zMm: -params.axialDepthMm,
      });
      totalLength += Math.PI * arcRadius;
    }
  }
  // MRR = engagement * axialDepth * feedRate
  const engagement = params.toolDiameterMm * engagementFraction;
  const chipAreaMm2 = engagement * params.axialDepthMm;
  const mrrMm3PerMin = chipAreaMm2 * params.feedRateMmPerMin;
  return {
    arcs,
    totalLengthMm: totalLength,
    mrrCm3PerMin: mrrMm3PerMin / 1000,
  };
}

/** Estimate cycle time (minutes) for the adaptive toolpath. */
export function estimateCycleTime(
  path: AdaptiveToolpath,
  feedRateMmPerMin: number,
): number {
  if (feedRateMmPerMin <= 0) return 0;
  return path.totalLengthMm / feedRateMmPerMin;
}

/** Suggest a feed rate that maintains a target chip load (mm per
 *  tooth). chipLoad × Nflutes × RPM = mm/min. */
export function feedForChipLoad(
  chipLoadMmPerTooth: number,
  flutes: number,
  spindleRpm: number,
): number {
  return chipLoadMmPerTooth * flutes * spindleRpm;
}
