/**
 * genevaMechanism.ts — Kinematics of an external Geneva (Maltese-cross)
 * intermittent-motion mechanism: index angle, geometry, and the peak
 * angular velocity / acceleration of the driven wheel.
 *
 * For n slots, the driven wheel advances 2π/n per drive revolution.
 *   driveCrankAngleForIndex β = π·(1 − 2/n)   (drive rotates this during motion)
 *   centreDistance C = drivePinRadius / sin(π/n)
 *
 * Angular position of the driven wheel as the crank rotates by α
 * (measured from engagement):
 *   φ = atan( sin α / (C/r − cos α) ),  with m = C/r = 1/sin(π/n)
 *
 * Peak velocity occurs at engagement (α = β/2 offset); we sample the
 * motion to find peak ω and acceleration ratios (× drive ω).
 */

export interface GenevaInput {
  slots: number;               // n (≥ 3)
  drivePinRadiusMm: number;    // r (crank pin radius)
  driveSpeedRpm: number;
  samples?: number;            // motion-phase samples, default 36
}

export interface GenevaResult {
  indexAngleDeg: number;       // driven advance per cycle = 360/n
  motionAngleDeg: number;      // drive rotation during motion
  dwellAngleDeg: number;       // drive rotation during dwell
  centreDistanceMm: number;
  drivenWheelRadiusMm: number;
  peakVelocityRatio: number;   // ω_driven_max / ω_drive
  peakAccelRatio: number;      // α_driven_max / ω_drive²
  warnings: string[];
}

export function compute(input: GenevaInput): GenevaResult {
  const warnings: string[] = [];
  const n = Math.floor(input.slots);
  if (n < 3) warnings.push('Geneva needs at least 3 slots.');
  if (input.drivePinRadiusMm <= 0) warnings.push('Drive pin radius must be positive.');

  const indexAngle = 360 / n;
  const motionAngle = 360 / n;          // drive turns 360/n during engagement (external Geneva)
  const dwellAngle = 360 - motionAngle;

  const m = 1 / Math.sin(Math.PI / n);  // C/r ratio
  const C = m * input.drivePinRadiusMm;
  const drivenRadius = C * Math.cos(Math.PI / n); // slot length ≈ wheel radius

  const omegaDrive = (2 * Math.PI * input.driveSpeedRpm) / 60; // rad/s

  // Sample driven velocity ratio over the motion phase.
  // φ(α) = atan( sinα / (m − cosα) ); dφ/dα is the velocity ratio.
  const samples = Math.max(8, input.samples ?? 36);
  const halfMotion = (motionAngle * Math.PI / 180) / 2; // α ranges −β/2 … +β/2
  let peakVel = 0, peakAcc = 0;
  let prevVel = 0, prevAlpha = 0;
  for (let i = 0; i <= samples; i++) {
    const alpha = -halfMotion + (i / samples) * 2 * halfMotion;
    const denom = m - Math.cos(alpha);
    // dφ/dα = m·cosα − 1) / (1 − 2 m cosα + m²)   (standard Geneva velocity ratio)
    const velRatio = (m * Math.cos(alpha) - 1) / (1 - 2 * m * Math.cos(alpha) + m * m);
    peakVel = Math.max(peakVel, Math.abs(velRatio));
    void denom;
    if (i > 0) {
      const dAlpha = alpha - prevAlpha;
      if (Math.abs(dAlpha) > 1e-9) {
        const accRatio = (velRatio - prevVel) / dAlpha;
        peakAcc = Math.max(peakAcc, Math.abs(accRatio));
      }
    }
    prevVel = velRatio; prevAlpha = alpha;
  }

  void omegaDrive;
  return {
    indexAngleDeg: indexAngle,
    motionAngleDeg: motionAngle,
    dwellAngleDeg: dwellAngle,
    centreDistanceMm: C,
    drivenWheelRadiusMm: drivenRadius,
    peakVelocityRatio: peakVel,
    peakAccelRatio: peakAcc,
    warnings,
  };
}

/** Fraction of the cycle the driven wheel is moving (vs dwelling). */
export function motionFraction(slots: number): number {
  return slots >= 3 ? 1 / slots : 0;
}

/** Driven wheel peak angular velocity (rad/s) at a drive speed. */
export function peakDrivenVelocityRadS(result: GenevaResult, driveSpeedRpm: number): number {
  const omegaDrive = (2 * Math.PI * driveSpeedRpm) / 60;
  return result.peakVelocityRatio * omegaDrive;
}

export function summarize(r: GenevaResult): { indexAngleDeg: number; peakVelocityRatio: number; dwellAngleDeg: number } {
  return { indexAngleDeg: r.indexAngleDeg, peakVelocityRatio: r.peakVelocityRatio, dwellAngleDeg: r.dwellAngleDeg };
}
