/**
 * boltPreloadCalculator.ts — Compute bolt preload (clamp force) from
 * tightening torque, and the resulting stresses, using the standard
 * torque–tension relation:
 *
 *   T = K · F · d
 *
 * where T = torque (N·m), K = nut factor (≈0.2 dry steel, 0.15 lubed,
 * 0.10 waxed), F = preload (N), d = nominal diameter (m).
 *
 * Recommended preload is typically 70–90 % of the bolt proof load:
 *   F_target = preloadFraction · A_t · σ_proof
 *
 * where A_t is the tensile stress area. We also report the tensile +
 * torsional stress during tightening and a combined von Mises check.
 */

export interface BoltPreloadInput {
  nominalDiameterMm: number;
  tensileStressAreaMm2: number; // A_t
  proofStrengthMpa: number;     // σ_proof (e.g. 830 for grade 8.8)
  nutFactor?: number;           // K, default 0.2
  preloadFraction?: number;     // default 0.75
  appliedTorqueNm?: number;     // if given, compute preload from torque instead
}

export interface BoltPreloadResult {
  targetPreloadN: number;
  requiredTorqueNm: number;
  actualPreloadN: number;       // from appliedTorque if supplied, else target
  tensileStressMpa: number;
  torsionalStressMpa: number;
  vonMisesMpa: number;
  proofUtilisation: number;     // vonMises / proof
  withinProof: boolean;
  warnings: string[];
}

export function calculate(input: BoltPreloadInput): BoltPreloadResult {
  const warnings: string[] = [];
  if (input.nominalDiameterMm <= 0) warnings.push('Nominal diameter must be positive.');
  if (input.tensileStressAreaMm2 <= 0) warnings.push('Tensile stress area must be positive.');
  if (input.proofStrengthMpa <= 0) warnings.push('Proof strength must be positive.');

  const K = input.nutFactor ?? 0.2;
  const frac = input.preloadFraction ?? 0.75;
  const dM = input.nominalDiameterMm / 1000; // mm → m

  const proofLoadN = input.tensileStressAreaMm2 * input.proofStrengthMpa; // N (mm²·MPa = N)
  const targetPreload = frac * proofLoadN;
  const requiredTorque = K * targetPreload * dM; // N·m

  const actualPreload = input.appliedTorqueNm != null
    ? (K * dM > 0 ? input.appliedTorqueNm / (K * dM) : 0)
    : targetPreload;

  // Tensile stress from preload.
  const tensile = actualPreload / input.tensileStressAreaMm2; // MPa

  // Torsional stress during tightening (≈ half the torque goes to thread friction torque).
  // τ = 16·T_thread / (π·d³); approximate thread torque ≈ 0.5·T.
  const dMm = input.nominalDiameterMm;
  const threadTorqueNmm = input.appliedTorqueNm != null
    ? input.appliedTorqueNm * 1000 * 0.5
    : requiredTorque * 1000 * 0.5;
  const torsional = (16 * threadTorqueNmm) / (Math.PI * Math.pow(dMm, 3)); // MPa

  const vonMises = Math.sqrt(tensile * tensile + 3 * torsional * torsional);
  const utilisation = input.proofStrengthMpa > 0 ? vonMises / input.proofStrengthMpa : 0;

  return {
    targetPreloadN: targetPreload,
    requiredTorqueNm: requiredTorque,
    actualPreloadN: actualPreload,
    tensileStressMpa: tensile,
    torsionalStressMpa: torsional,
    vonMisesMpa: vonMises,
    proofUtilisation: utilisation,
    withinProof: vonMises <= input.proofStrengthMpa + 1e-9,
    warnings,
  };
}

/** Nut factor lookup by lubrication condition. */
export type LubeCondition = 'dry' | 'lightly-oiled' | 'moly' | 'waxed' | 'PTFE';

export function nutFactorFor(condition: LubeCondition): number {
  switch (condition) {
    case 'dry': return 0.20;
    case 'lightly-oiled': return 0.15;
    case 'moly': return 0.12;
    case 'waxed': return 0.10;
    case 'PTFE': return 0.09;
  }
}

/** Scatter band of preload from torque control (typically ±25–35 %). */
export function preloadScatter(nominalPreloadN: number, scatterFraction: number = 0.3): { minN: number; maxN: number } {
  return {
    minN: nominalPreloadN * (1 - scatterFraction),
    maxN: nominalPreloadN * (1 + scatterFraction),
  };
}

export function summarize(r: BoltPreloadResult): { targetPreloadN: number; requiredTorqueNm: number; withinProof: boolean } {
  return { targetPreloadN: r.targetPreloadN, requiredTorqueNm: r.requiredTorqueNm, withinProof: r.withinProof };
}
