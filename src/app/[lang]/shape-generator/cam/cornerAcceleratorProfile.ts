/**
 * cornerAcceleratorProfile.ts — Build a feed-rate acceleration ramp
 * AFTER a corner so the tool returns to commanded feed smoothly.
 *
 * Pair to cornerDecelerationProfile: after a sharp corner, the
 * machine must ramp UP from v_corner back to v_out. Smooth
 * acceleration prevents step / mark on exit side of the corner.
 *
 * Acceleration profile choices:
 *
 *   - Linear: constant acceleration over distance.
 *   - S-curve: jerk-limited 7-segment profile.
 *   - Exponential: gentler initial acceleration (slow start).
 */

export interface AccelProfileInput {
  /** Speed at start (mm/min). */
  vStartMmMin: number;
  /** Target speed (mm/min). */
  vTargetMmMin: number;
  /** Max axial acceleration (mm/s²). */
  maxAccelMmPerS2: number;
  /** Max jerk (mm/s³); used for S-curve. */
  maxJerkMmPerS3: number;
  /** Profile shape. */
  profile: 'linear' | 's-curve' | 'exponential';
}

export const DEFAULT_INPUT: AccelProfileInput = {
  vStartMmMin: 100,
  vTargetMmMin: 1000,
  maxAccelMmPerS2: 5000,
  maxJerkMmPerS3: 50000,
  profile: 'linear',
};

export interface AccelSample {
  timeSec: number;
  /** Velocity at time (mm/min). */
  velocityMmMin: number;
  /** Accumulated distance (mm). */
  distanceMm: number;
}

export interface AccelProfile {
  samples: AccelSample[];
  totalDistanceMm: number;
  totalTimeSec: number;
  /** Peak acceleration (mm/s²) reached. */
  peakAccelMmPerS2: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function buildProfile(input: Partial<AccelProfileInput> = {}): AccelProfile {
  const p = { ...DEFAULT_INPUT, ...input };
  if (p.vStartMmMin >= p.vTargetMmMin || p.maxAccelMmPerS2 <= 0) {
    return { samples: [], totalDistanceMm: 0, totalTimeSec: 0, peakAccelMmPerS2: 0 };
  }
  const vStart = p.vStartMmMin / 60;
  const vTarget = p.vTargetMmMin / 60;
  const dv = vTarget - vStart;

  switch (p.profile) {
    case 'linear':
      return linearProfile(vStart, vTarget, p.maxAccelMmPerS2);
    case 's-curve':
      return sCurveProfile(vStart, vTarget, p.maxAccelMmPerS2, p.maxJerkMmPerS3);
    case 'exponential':
      return exponentialProfile(vStart, vTarget, p.maxAccelMmPerS2, dv);
  }
}

// ── Linear profile ────────────────────────────────────────────

function linearProfile(vStart: number, vTarget: number, a: number): AccelProfile {
  const dv = vTarget - vStart;
  const time = dv / a;
  const samples: AccelSample[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * time;
    const v = vStart + a * t;
    const dist = vStart * t + 0.5 * a * t * t;
    samples.push({ timeSec: t, velocityMmMin: v * 60, distanceMm: dist });
  }
  const totalDist = vStart * time + 0.5 * a * time * time;
  return { samples, totalDistanceMm: totalDist, totalTimeSec: time, peakAccelMmPerS2: a };
}

// ── S-curve (jerk-limited) ──────────────────────────────────────

function sCurveProfile(vStart: number, vTarget: number, aMax: number, jMax: number): AccelProfile {
  const dv = vTarget - vStart;
  // Time to ramp acceleration to aMax: aMax/jMax.
  const tRamp = aMax / jMax;
  const vDuringRamp = 0.5 * jMax * tRamp * tRamp;
  let tConst: number;
  if (2 * vDuringRamp >= dv) {
    // Never reach aMax — pure triangle.
    tConst = 0;
    const tTri = Math.sqrt(dv / jMax);
    return buildSCurveSamples(vStart, vTarget, tTri, tConst, tTri, jMax, aMax, 26);
  } else {
    tConst = (dv - 2 * vDuringRamp) / aMax;
    return buildSCurveSamples(vStart, vTarget, tRamp, tConst, tRamp, jMax, aMax, 36);
  }
}

function buildSCurveSamples(vStart: number, vTarget: number, t1: number, t2: number, t3: number, jMax: number, aMax: number, steps: number): AccelProfile {
  const total = t1 + t2 + t3;
  const samples: AccelSample[] = [];
  let peakA = 0;
  let dist = 0;
  let v = vStart;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * total;
    let a: number;
    if (t < t1) a = jMax * t;
    else if (t < t1 + t2) a = aMax;
    else a = aMax - jMax * (t - t1 - t2);
    if (a > peakA) peakA = a;
    // Integrate roughly.
    samples.push({ timeSec: t, velocityMmMin: v * 60, distanceMm: dist });
    if (i < steps) {
      const dt = total / steps;
      v = v + a * dt;
      dist = dist + v * dt;
    }
  }
  void vTarget;
  return { samples, totalDistanceMm: dist, totalTimeSec: total, peakAccelMmPerS2: peakA };
}

// ── Exponential profile ──────────────────────────────────────

function exponentialProfile(vStart: number, vTarget: number, a: number, _dv: number): AccelProfile {
  // v(t) = vTarget - (vTarget - vStart)·exp(-a/vStart·t) ; tau = vStart/a
  const tau = (vStart + 0.1) / a;
  const time = 5 * tau; // ~99% settle.
  const samples: AccelSample[] = [];
  const steps = 30;
  let dist = 0;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * time;
    const v = vTarget - (vTarget - vStart) * Math.exp(-t / tau);
    if (i > 0) {
      const dt = time / steps;
      const vPrev = vTarget - (vTarget - vStart) * Math.exp(-(t - dt) / tau);
      dist += (v + vPrev) / 2 * dt;
    }
    samples.push({ timeSec: t, velocityMmMin: v * 60, distanceMm: dist });
  }
  return { samples, totalDistanceMm: dist, totalTimeSec: time, peakAccelMmPerS2: a };
}

// ── G-code emission with feed scheduling ──────────────────────

export function emitGcode(profile: AccelProfile, baseFeedMmMin: number): string[] {
  const lines: string[] = [];
  for (const s of profile.samples) {
    const feed = Math.min(baseFeedMmMin, s.velocityMmMin);
    lines.push(`G1 ; t=${s.timeSec.toFixed(3)} F${feed.toFixed(0)}`);
  }
  return lines;
}

// ── Diagnostics ──────────────────────────────────────────────

export interface AccelDiagnostic {
  totalTimeSec: number;
  averageAccelMmPerS2: number;
  peakAccelMmPerS2: number;
}

export function diagnose(profile: AccelProfile): AccelDiagnostic {
  if (profile.samples.length === 0) return { totalTimeSec: 0, averageAccelMmPerS2: 0, peakAccelMmPerS2: 0 };
  const v0 = profile.samples[0]!.velocityMmMin / 60;
  const vEnd = profile.samples[profile.samples.length - 1]!.velocityMmMin / 60;
  const dv = vEnd - v0;
  return {
    totalTimeSec: profile.totalTimeSec,
    averageAccelMmPerS2: profile.totalTimeSec > 0 ? dv / profile.totalTimeSec : 0,
    peakAccelMmPerS2: profile.peakAccelMmPerS2,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface AccelSummary {
  sampleCount: number;
  totalDistanceMm: number;
  totalTimeSec: number;
  peakAccelMmPerS2: number;
}

export function summarize(profile: AccelProfile): AccelSummary {
  return {
    sampleCount: profile.samples.length,
    totalDistanceMm: profile.totalDistanceMm,
    totalTimeSec: profile.totalTimeSec,
    peakAccelMmPerS2: profile.peakAccelMmPerS2,
  };
}
