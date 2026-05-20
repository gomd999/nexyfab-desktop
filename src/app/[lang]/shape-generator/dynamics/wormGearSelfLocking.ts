/**
 * wormGearSelfLocking.ts — Worm-gear drive: lead angle, gear ratio,
 * efficiency, and the self-locking condition.
 *
 *   leadAngle λ = atan( z_w · m / d_w )       (z_w = worm starts, m module,
 *                                              d_w worm pitch dia)
 *   ratio i = z_g / z_w                        (gear teeth / worm starts)
 *
 * Forward efficiency (worm driving):
 *   η = tan(λ)·(1 − μ·tanλ) / (tanλ + μ)
 *
 * Self-locking (gear cannot back-drive the worm) when:
 *   λ ≤ atan(μ)   →   tan(λ) ≤ μ
 *
 * Back-driving efficiency η' = tan(λ)·(μ − tanλ)/... < 0 when self-locking.
 */

export interface WormGearInput {
  wormStarts: number;          // z_w (1, 2, 4...)
  gearTeeth: number;           // z_g
  moduleMm: number;
  wormPitchDiameterMm: number; // d_w
  frictionCoefficient: number; // μ at the contact
}

export interface WormGearResult {
  leadAngleDeg: number;
  ratio: number;
  forwardEfficiency: number;   // 0..1
  selfLocking: boolean;
  staticSelfLocking: boolean;  // λ ≤ atan(μ_static); reversible only if false
  frictionAngleDeg: number;
  warnings: string[];
}

export function compute(input: WormGearInput): WormGearResult {
  const warnings: string[] = [];
  if (input.wormStarts <= 0 || input.gearTeeth <= 0) warnings.push('Worm starts + gear teeth must be positive.');
  if (input.wormPitchDiameterMm <= 0) warnings.push('Worm pitch diameter must be positive.');

  // tan(λ) = lead / (π·d_w) = z_w·m / d_w
  const tanLambda = input.wormPitchDiameterMm > 0
    ? (input.wormStarts * input.moduleMm) / input.wormPitchDiameterMm
    : 0;
  const lambda = Math.atan(tanLambda);
  const lambdaDeg = lambda * 180 / Math.PI;

  const ratio = input.wormStarts > 0 ? input.gearTeeth / input.wormStarts : Infinity;

  const mu = input.frictionCoefficient;
  // Forward efficiency.
  const num = tanLambda * (1 - mu * tanLambda);
  const den = tanLambda + mu;
  const forwardEff = den > 0 ? Math.max(0, num / den) : 0;

  const frictionAngle = Math.atan(mu);
  const frictionAngleDeg = frictionAngle * 180 / Math.PI;
  const selfLocking = lambda <= frictionAngle;       // dynamic
  const staticSelfLocking = tanLambda <= mu;          // ≈ same form (static μ)

  if (selfLocking) warnings.push('Self-locking: gear cannot back-drive the worm (good for hoists; low efficiency).');

  return {
    leadAngleDeg: lambdaDeg,
    ratio,
    forwardEfficiency: forwardEff,
    selfLocking,
    staticSelfLocking,
    frictionAngleDeg,
    warnings,
  };
}

/** Output torque from input torque (× ratio × efficiency). */
export function outputTorqueNm(result: WormGearResult, inputTorqueNm: number): number {
  return inputTorqueNm * result.ratio * result.forwardEfficiency;
}

/** Max lead angle that still self-locks for a friction coefficient (deg). */
export function maxSelfLockingLeadAngleDeg(frictionCoefficient: number): number {
  return Math.atan(frictionCoefficient) * 180 / Math.PI;
}

export function summarize(r: WormGearResult): { ratio: number; forwardEfficiency: number; selfLocking: boolean } {
  return { ratio: r.ratio, forwardEfficiency: r.forwardEfficiency, selfLocking: r.selfLocking };
}
