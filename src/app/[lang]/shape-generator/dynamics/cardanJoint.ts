/**
 * cardanJoint.ts — Compute the output-shaft speed/torque fluctuation of a
 * single Cardan (Hooke / universal) joint at a given operating angle, and
 * the phasing needed for a double-joint to cancel it.
 *
 * For a single joint at angle β, the instantaneous velocity ratio:
 *   ω2/ω1 = cos(β) / (1 − sin²(β)·cos²(θ1))
 *
 * which oscillates twice per revolution between cos(β) and 1/cos(β).
 * Peak-to-peak speed fluctuation:
 *   ratioMax = 1/cos(β),  ratioMin = cos(β)
 *
 * Torque varies inversely (T2/T1 = ω1/ω2). A double Cardan cancels the
 * fluctuation when the two joint angles are equal and the yokes are
 * phased correctly (intermediate-shaft yokes in-plane).
 */

export interface CardanInput {
  jointAngleDeg: number;     // β
  inputSpeedRpm: number;
  inputTorqueNm?: number;
  samples?: number;          // points over one revolution, default 36
}

export interface CardanPoint {
  inputAngleDeg: number;
  speedRatio: number;
  outputSpeedRpm: number;
  outputTorqueNm: number | null;
}

export interface CardanResult {
  ratioMax: number;
  ratioMin: number;
  speedFluctuationPercent: number; // peak-to-peak / mean
  curve: CardanPoint[];
  warnings: string[];
}

export function compute(input: CardanInput): CardanResult {
  const warnings: string[] = [];
  const beta = input.jointAngleDeg * Math.PI / 180;
  if (input.jointAngleDeg < 0 || input.jointAngleDeg >= 90) warnings.push('Joint angle should be in [0, 90).');
  if (input.inputSpeedRpm <= 0) warnings.push('Input speed must be positive.');

  const cosB = Math.cos(beta);
  const ratioMax = cosB > 0 ? 1 / cosB : Infinity;
  const ratioMin = cosB;

  const samples = Math.max(8, input.samples ?? 36);
  const curve: CardanPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const theta = (i / samples) * 2 * Math.PI;
    const denom = 1 - Math.sin(beta) ** 2 * Math.cos(theta) ** 2;
    const ratio = denom > 0 ? cosB / denom : 0;
    curve.push({
      inputAngleDeg: (i / samples) * 360,
      speedRatio: ratio,
      outputSpeedRpm: input.inputSpeedRpm * ratio,
      outputTorqueNm: input.inputTorqueNm != null && ratio > 0 ? input.inputTorqueNm / ratio : null,
    });
  }

  // Peak-to-peak fluctuation relative to mean (≈1).
  const fluctuation = (ratioMax - ratioMin) * 100;

  return {
    ratioMax,
    ratioMin,
    speedFluctuationPercent: fluctuation,
    curve,
    warnings,
  };
}

/** Does a double Cardan cancel fluctuation? Needs equal angles + correct phasing. */
export function doubleJointCancels(angle1Deg: number, angle2Deg: number, yokesInPhase: boolean): boolean {
  return Math.abs(angle1Deg - angle2Deg) < 0.5 && yokesInPhase;
}

/** Max joint angle to keep speed fluctuation under a target %. */
export function maxAngleForFluctuationDeg(targetPercent: number): number {
  // fluctuation = (1/cosβ − cosβ)·100. Solve numerically.
  let lo = 0, hi = 89;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const c = Math.cos(mid * Math.PI / 180);
    const f = (1 / c - c) * 100;
    if (f > targetPercent) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

export function summarize(r: CardanResult): { ratioMax: number; ratioMin: number; speedFluctuationPercent: number } {
  return { ratioMax: r.ratioMax, ratioMin: r.ratioMin, speedFluctuationPercent: r.speedFluctuationPercent };
}
