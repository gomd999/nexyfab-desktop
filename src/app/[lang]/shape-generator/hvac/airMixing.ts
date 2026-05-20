/**
 * airMixing.ts — Adiabatic mixing of two moist-air streams (e.g. return
 * air + outdoor air in an AHU mixing box). Mass + energy + moisture
 * balances give the mixed-stream state.
 *
 *   ṁ_mix = ṁ1 + ṁ2
 *   T_mix  = (ṁ1·T1 + ṁ2·T2) / ṁ_mix          (approx, cp const)
 *   W_mix  = (ṁ1·W1 + ṁ2·W2) / ṁ_mix
 *   h_mix  = (ṁ1·h1 + ṁ2·h2) / ṁ_mix
 *
 * Mass flows from volume flows × density. The mixed point lies on the
 * straight line between the two states (psychrometric chart property),
 * proportioned by mass-flow ratio.
 */

export interface AirStream {
  flowM3PerS: number;
  dryBulbC: number;
  humidityRatio: number;   // kg/kg
  enthalpyKJkg: number;
}

export interface AirMixingInput {
  stream1: AirStream;
  stream2: AirStream;
  airDensityKgM3?: number; // default 1.2
}

export interface AirMixingResult {
  massFlow1KgS: number;
  massFlow2KgS: number;
  mixedMassFlowKgS: number;
  mixRatio1: number;        // fraction from stream1
  mixedDryBulbC: number;
  mixedHumidityRatio: number;
  mixedEnthalpyKJkg: number;
  warnings: string[];
}

export function mix(input: AirMixingInput): AirMixingResult {
  const warnings: string[] = [];
  const rho = input.airDensityKgM3 ?? 1.2;
  if (input.stream1.flowM3PerS < 0 || input.stream2.flowM3PerS < 0) warnings.push('Flows must be non-negative.');

  const m1 = input.stream1.flowM3PerS * rho;
  const m2 = input.stream2.flowM3PerS * rho;
  const mTotal = m1 + m2;
  if (mTotal <= 0) {
    return {
      massFlow1KgS: 0, massFlow2KgS: 0, mixedMassFlowKgS: 0, mixRatio1: 0,
      mixedDryBulbC: 0, mixedHumidityRatio: 0, mixedEnthalpyKJkg: 0,
      warnings: [...warnings, 'Total mass flow is zero.'],
    };
  }

  const f1 = m1 / mTotal;
  const T = (m1 * input.stream1.dryBulbC + m2 * input.stream2.dryBulbC) / mTotal;
  const W = (m1 * input.stream1.humidityRatio + m2 * input.stream2.humidityRatio) / mTotal;
  const h = (m1 * input.stream1.enthalpyKJkg + m2 * input.stream2.enthalpyKJkg) / mTotal;

  return {
    massFlow1KgS: m1,
    massFlow2KgS: m2,
    mixedMassFlowKgS: mTotal,
    mixRatio1: f1,
    mixedDryBulbC: T,
    mixedHumidityRatio: W,
    mixedEnthalpyKJkg: h,
    warnings,
  };
}

/** Outdoor-air fraction needed to hit a target mixed dry-bulb temp. */
export function oaFractionForMixedTemp(returnC: number, outdoorC: number, targetMixedC: number): number {
  if (Math.abs(outdoorC - returnC) < 1e-9) return 0;
  const f = (targetMixedC - returnC) / (outdoorC - returnC);
  return Math.max(0, Math.min(1, f));
}

export function summarize(r: AirMixingResult): { mixedDryBulbC: number; mixedHumidityRatio: number; mixRatio1: number } {
  return { mixedDryBulbC: r.mixedDryBulbC, mixedHumidityRatio: r.mixedHumidityRatio, mixRatio1: r.mixRatio1 };
}
