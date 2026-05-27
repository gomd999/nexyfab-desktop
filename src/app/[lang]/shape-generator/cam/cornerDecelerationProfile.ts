/**
 * cornerDecelerationProfile.ts — Generate feed-rate deceleration
 * profile around a corner.
 *
 * Sharp corners with high feed rates produce:
 *   - Acceleration spikes that the spindle servo cannot follow.
 *   - Visible chatter / mark on the workpiece.
 *
 * Solution: decelerate before the corner, hold low speed through
 * the corner, then accelerate after. The deceleration distance is
 * driven by the machine's max axial acceleration:
 *
 *   d_decel = (v_in² − v_corner²) / (2 · a_max)
 *
 * Module computes:
 *   - Corner speed v_corner that yields centripetal a = a_max for
 *     a given corner radius.
 *   - Deceleration ramp distance.
 *   - S-curve (jerk-limited) ramp for better surface finish.
 */

export interface MachineProfile {
  /** Maximum cutting feed rate (mm/min). */
  maxFeedMmMin: number;
  /** Maximum axial acceleration (mm/s²). */
  maxAccelMmPerS2: number;
  /** Maximum jerk (mm/s³) — used for S-curve. */
  maxJerkMmPerS3: number;
}

export interface Corner {
  id: string;
  /** Interior corner angle (degrees, < 180 = sharp). */
  interiorAngleDeg: number;
  /** Effective corner radius (filleted) (mm). */
  cornerRadiusMm: number;
  /** Incoming feedrate command (mm/min). */
  feedInMmMin: number;
  /** Outgoing feedrate command. */
  feedOutMmMin: number;
}

export interface ProfileOptions {
  /** Use jerk-limited (S-curve) ramps. */
  useSCurve: boolean;
  /** Minimum corner speed floor (mm/min). */
  minCornerFeed: number;
}

export const DEFAULT_OPTIONS: ProfileOptions = {
  useSCurve: false,
  minCornerFeed: 50,
};

export interface CornerProfile {
  cornerId: string;
  cornerSpeedMmMin: number;
  decelDistanceMm: number;
  accelDistanceMm: number;
  /** Estimated time loss vs constant-feed (seconds). */
  timeLossSec: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function generateProfile(corner: Corner, machine: MachineProfile, options: Partial<ProfileOptions> = {}): CornerProfile {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];

  // Convert feeds to mm/s.
  const vIn = corner.feedInMmMin / 60;
  const vOut = corner.feedOutMmMin / 60;
  const a = machine.maxAccelMmPerS2;
  if (a <= 0) {
    warnings.push('Machine maxAccel must be positive.');
    return { cornerId: corner.id, cornerSpeedMmMin: 0, decelDistanceMm: 0, accelDistanceMm: 0, timeLossSec: 0, warnings };
  }

  // Corner speed from centripetal: v_corner = sqrt(a · r).
  const r = Math.max(0.001, corner.cornerRadiusMm);
  let vCorner = Math.sqrt(a * r);
  // Apply angle penalty: sharper angle → slower allowed.
  const anglePenalty = Math.min(1, corner.interiorAngleDeg / 180);
  vCorner *= anglePenalty;
  // Don't exceed incoming feed.
  vCorner = Math.min(vCorner, vIn, vOut);
  // Apply floor.
  const minMmS = opts.minCornerFeed / 60;
  if (vCorner < minMmS) vCorner = minMmS;

  // Decel / accel distance (linear ramp).
  let decel = vIn > vCorner ? (vIn * vIn - vCorner * vCorner) / (2 * a) : 0;
  let accel = vOut > vCorner ? (vOut * vOut - vCorner * vCorner) / (2 * a) : 0;
  if (opts.useSCurve && machine.maxJerkMmPerS3 > 0) {
    // S-curve ramp is ~30% longer.
    decel *= 1.3;
    accel *= 1.3;
  }

  // Approximate time loss: extra time vs cruising at vIn / vOut.
  const cruiseTime = (decel + accel) / Math.max(0.01, vIn);
  const rampTime = decel / Math.max(0.01, (vIn + vCorner) / 2) + accel / Math.max(0.01, (vOut + vCorner) / 2);
  const timeLoss = Math.max(0, rampTime - cruiseTime);

  if (vCorner === minMmS) warnings.push(`Corner ${corner.id} speed clamped to minCornerFeed; sharp corner.`);
  if (corner.cornerRadiusMm < 0.01) warnings.push(`Corner ${corner.id} radius near zero; expect chatter.`);

  return {
    cornerId: corner.id,
    cornerSpeedMmMin: vCorner * 60,
    decelDistanceMm: decel,
    accelDistanceMm: accel,
    timeLossSec: timeLoss,
    warnings,
  };
}

// ── Batch profile ─────────────────────────────────────────────

export function batchProfile(corners: Corner[], machine: MachineProfile, options: Partial<ProfileOptions> = {}): CornerProfile[] {
  return corners.map(c => generateProfile(c, machine, options));
}

// ── Aggregate time loss ──────────────────────────────────────

export interface TimeLossReport {
  totalTimeLossSec: number;
  worstCornerId: string | null;
  averageCornerSpeedMmMin: number;
}

export function aggregate(profiles: CornerProfile[]): TimeLossReport {
  let total = 0;
  let worstLoss = 0;
  let worstId: string | null = null;
  let speedSum = 0;
  for (const p of profiles) {
    total += p.timeLossSec;
    if (p.timeLossSec > worstLoss) { worstLoss = p.timeLossSec; worstId = p.cornerId; }
    speedSum += p.cornerSpeedMmMin;
  }
  return {
    totalTimeLossSec: total,
    worstCornerId: worstId,
    averageCornerSpeedMmMin: profiles.length === 0 ? 0 : speedSum / profiles.length,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface ProfileSummary {
  cornerCount: number;
  averageCornerSpeed: number;
  totalTimeLossSec: number;
  warningsCount: number;
}

export function summarize(profiles: CornerProfile[]): ProfileSummary {
  const agg = aggregate(profiles);
  let warns = 0;
  for (const p of profiles) warns += p.warnings.length;
  return {
    cornerCount: profiles.length,
    averageCornerSpeed: agg.averageCornerSpeedMmMin,
    totalTimeLossSec: agg.totalTimeLossSec,
    warningsCount: warns,
  };
}
