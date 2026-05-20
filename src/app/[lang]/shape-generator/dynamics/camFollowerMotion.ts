/**
 * camFollowerMotion.ts — Generate the follower displacement, velocity,
 * and acceleration profiles for a disc cam over a rise (or fall) segment,
 * for the standard motion laws.
 *
 * Over a segment of cam rotation β (rad) and total lift h, with
 * normalised angle τ = θ/β ∈ [0,1]:
 *
 *   Uniform (constant velocity):  s = h·τ          (infinite accel at ends)
 *   Parabolic (constant accel):   s = 2h·τ²  (0..0.5), symmetric
 *   Simple harmonic (SHM):        s = (h/2)(1 − cos(πτ))
 *   Cycloidal:                    s = h(τ − sin(2πτ)/(2π))   (zero end accel)
 *
 * Peak velocity and acceleration coefficients differ per law; cycloidal
 * has the smoothest (lowest jerk) profile. We return sampled profiles +
 * the peak velocity/acceleration for sizing.
 */

export type MotionLaw = 'uniform' | 'parabolic' | 'simple-harmonic' | 'cycloidal';

export interface CamSegmentInput {
  liftMm: number;          // h
  segmentAngleDeg: number; // β
  camSpeedRpm: number;
  law: MotionLaw;
  samples?: number;        // default 36
  fall?: boolean;          // descending segment
}

export interface CamProfilePoint {
  angleDeg: number;
  displacementMm: number;
  velocityMmS: number;
  accelerationMmS2: number;
}

export interface CamFollowerResult {
  profile: CamProfilePoint[];
  peakVelocityMmS: number;
  peakAccelerationMmS2: number;
  law: MotionLaw;
  warnings: string[];
}

export function generate(input: CamSegmentInput): CamFollowerResult {
  const warnings: string[] = [];
  if (input.liftMm <= 0) warnings.push('Lift must be positive.');
  if (input.segmentAngleDeg <= 0) warnings.push('Segment angle must be positive.');
  if (input.camSpeedRpm <= 0) warnings.push('Cam speed must be positive.');

  const h = input.liftMm;
  const beta = input.segmentAngleDeg * Math.PI / 180;
  const omega = (2 * Math.PI * input.camSpeedRpm) / 60; // rad/s
  const samples = Math.max(8, input.samples ?? 36);

  const profile: CamProfilePoint[] = [];
  let peakV = 0, peakA = 0;
  for (let i = 0; i <= samples; i++) {
    const tau = i / samples;
    const { s, dsdt, d2sdt2 } = lawDerivatives(input.law, tau, h, beta, omega);
    const disp = input.fall ? h - s : s;
    const vel = input.fall ? -dsdt : dsdt;
    profile.push({
      angleDeg: tau * input.segmentAngleDeg,
      displacementMm: disp,
      velocityMmS: vel,
      accelerationMmS2: input.fall ? -d2sdt2 : d2sdt2,
    });
    peakV = Math.max(peakV, Math.abs(vel));
    peakA = Math.max(peakA, Math.abs(d2sdt2));
  }

  return { profile, peakVelocityMmS: peakV, peakAccelerationMmS2: peakA, law: input.law, warnings };
}

function lawDerivatives(law: MotionLaw, tau: number, h: number, beta: number, omega: number): { s: number; dsdt: number; d2sdt2: number } {
  // ds/dθ then × ω for ds/dt; d²s/dθ² × ω² for d²s/dt².
  let s = 0, dsdth = 0, d2sdth2 = 0;
  switch (law) {
    case 'uniform':
      s = h * tau;
      dsdth = h / beta;
      d2sdth2 = 0;
      break;
    case 'parabolic':
      if (tau <= 0.5) {
        s = 2 * h * tau * tau;
        dsdth = (4 * h * tau) / beta;
        d2sdth2 = (4 * h) / (beta * beta);
      } else {
        s = h * (1 - 2 * (1 - tau) * (1 - tau));
        dsdth = (4 * h * (1 - tau)) / beta;
        d2sdth2 = -(4 * h) / (beta * beta);
      }
      break;
    case 'simple-harmonic':
      s = (h / 2) * (1 - Math.cos(Math.PI * tau));
      dsdth = (h * Math.PI / (2 * beta)) * Math.sin(Math.PI * tau);
      d2sdth2 = (h * Math.PI * Math.PI / (2 * beta * beta)) * Math.cos(Math.PI * tau);
      break;
    case 'cycloidal':
      s = h * (tau - Math.sin(2 * Math.PI * tau) / (2 * Math.PI));
      dsdth = (h / beta) * (1 - Math.cos(2 * Math.PI * tau));
      d2sdth2 = (h * 2 * Math.PI / (beta * beta)) * Math.sin(2 * Math.PI * tau);
      break;
  }
  return { s, dsdt: dsdth * omega, d2sdt2: d2sdth2 * omega * omega };
}

/** Theoretical peak-acceleration coefficient (× h·ω²/β²) for each law. */
export function peakAccelCoefficient(law: MotionLaw): number {
  switch (law) {
    case 'uniform': return Infinity;       // impulsive at ends
    case 'parabolic': return 4;
    case 'simple-harmonic': return Math.PI * Math.PI / 2; // ≈ 4.93
    case 'cycloidal': return 2 * Math.PI;  // ≈ 6.28
  }
}

export function summarize(r: CamFollowerResult): { law: MotionLaw; peakVelocityMmS: number; peakAccelerationMmS2: number } {
  return { law: r.law, peakVelocityMmS: r.peakVelocityMmS, peakAccelerationMmS2: r.peakAccelerationMmS2 };
}
