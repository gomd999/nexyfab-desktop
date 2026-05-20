/**
 * ductTransitionLoss.ts — Compute the pressure loss through an HVAC duct
 * transition (expansion / contraction) using ASHRAE loss coefficients.
 *
 * Dynamic (velocity) pressure:  Pv = 0.5 · ρ · V²    (Pa)
 * Transition loss:              ΔP = C · Pv_ref      (Pa)
 *
 * The loss coefficient C depends on the area ratio and the included
 * (taper) angle:
 *   - Gradual expansion (diffuser): C rises with angle; minimal near 7°,
 *     approaching the sudden-expansion value (1 − A1/A2)² at large angle.
 *   - Gradual contraction: much lower C; sudden contraction ≈ 0.5·(1−A2/A1).
 *
 * We use the upstream velocity for expansions and downstream velocity for
 * contractions as the reference dynamic pressure (ASHRAE convention).
 */

export type TransitionKind = 'expansion' | 'contraction';

export interface DuctTransitionInput {
  upstreamAreaMm2: number;
  downstreamAreaMm2: number;
  flowRateM3PerS: number;
  airDensityKgM3?: number;  // default 1.2
  includedAngleDeg: number; // total taper angle
}

export interface DuctTransitionResult {
  kind: TransitionKind;
  lossCoefficient: number;
  referenceVelocityMS: number;
  dynamicPressurePa: number;
  pressureLossPa: number;
  warnings: string[];
}

export function compute(input: DuctTransitionInput): DuctTransitionResult {
  const warnings: string[] = [];
  const A1 = input.upstreamAreaMm2 * 1e-6;   // m²
  const A2 = input.downstreamAreaMm2 * 1e-6; // m²
  if (A1 <= 0 || A2 <= 0) warnings.push('Areas must be positive.');
  const rho = input.airDensityKgM3 ?? 1.2;
  const Q = input.flowRateM3PerS;

  const kind: TransitionKind = A2 > A1 ? 'expansion' : 'contraction';

  const V1 = A1 > 0 ? Q / A1 : 0;
  const V2 = A2 > 0 ? Q / A2 : 0;

  let C: number;
  let refV: number;
  const angle = Math.max(0, input.includedAngleDeg);
  if (kind === 'expansion') {
    refV = V1; // upstream (higher) velocity
    const sudden = Math.pow(1 - A1 / A2, 2);
    // angle factor: ~0.15 near 7°, → 1 (sudden) by ~60°.
    const angleFactor = Math.min(1, 0.15 + (Math.max(0, angle - 7) / 53) * 0.85);
    C = sudden * angleFactor;
  } else {
    refV = V2; // downstream (higher) velocity
    const sudden = 0.5 * (1 - A2 / A1);
    // gradual contraction is gentler; angle factor scales from ~0.05 to sudden.
    const angleFactor = Math.min(1, 0.1 + (Math.max(0, angle - 7) / 53) * 0.9);
    C = sudden * angleFactor;
  }

  const dynamicPressure = 0.5 * rho * refV * refV;
  const loss = C * dynamicPressure;

  return {
    kind,
    lossCoefficient: C,
    referenceVelocityMS: refV,
    dynamicPressurePa: dynamicPressure,
    pressureLossPa: loss,
    warnings,
  };
}

/** Optimum diffuser angle (lowest loss for a given area ratio ≈ 7°). */
export function optimumExpansionAngleDeg(): number {
  return 7;
}

/** Equivalent length of straight duct that gives the same loss (for sizing). */
export function equivalentLengthM(result: DuctTransitionResult, frictionPerM: number): number {
  if (frictionPerM <= 0) return 0;
  return result.pressureLossPa / frictionPerM;
}

export function summarize(r: DuctTransitionResult): { kind: TransitionKind; lossCoefficient: number; pressureLossPa: number } {
  return { kind: r.kind, lossCoefficient: r.lossCoefficient, pressureLossPa: r.pressureLossPa };
}
