/**
 * ductLeakage.ts — Estimate HVAC duct air leakage from the SMACNA leakage
 * class and check it against an allowable fraction of system airflow.
 *
 * SMACNA leakage:  Q_leak = C_L · P^0.65   (per unit surface area)
 * where C_L is the leakage class (cfm/100ft² at 1 in.wg) and P is the
 * static pressure (in.wg). Working in SI-ish terms, we accept the class,
 * the duct surface area, and the operating pressure, and report total
 * leakage + the % of system airflow lost.
 *
 * Leakage class by construction (SMACNA): sealed metal ≈ 3–6, unsealed
 * ≈ 12–48. Lower class = tighter duct.
 */

export interface DuctLeakageInput {
  leakageClass: number;        // C_L (cfm/100ft² @ 1 in.wg) — SMACNA
  surfaceAreaM2: number;       // total duct surface
  staticPressurePa: number;    // operating static pressure
  systemFlowM3PerS: number;    // total system airflow (for % loss)
  allowableLeakFraction?: number; // default 0.05 (5%)
}

export interface DuctLeakageResult {
  staticPressureInWg: number;
  leakageFactor: number;       // P^0.65 multiplier
  leakageFlowM3PerS: number;
  leakagePercent: number;
  withinAllowable: boolean;
  warnings: string[];
}

const M2_TO_100FT2 = 1 / 9.2903; // 1 m² = 1/9.29 of 100 ft²... actually 100 ft² = 9.2903 m²
const CFM_TO_M3S = 0.000471947;
const PA_TO_INWG = 1 / 248.84;

export function compute(input: DuctLeakageInput): DuctLeakageResult {
  const warnings: string[] = [];
  if (input.leakageClass <= 0) warnings.push('Leakage class must be positive.');
  if (input.surfaceAreaM2 <= 0) warnings.push('Surface area must be positive.');

  const pInWg = Math.max(0, input.staticPressurePa) * PA_TO_INWG;
  const factor = Math.pow(Math.max(0, pInWg), 0.65);

  // Leakage (cfm) = C_L · P^0.65 · (area in 100ft² units).
  const area100ft2 = input.surfaceAreaM2 * M2_TO_100FT2; // m² → units of 100ft²
  const leakCfm = input.leakageClass * factor * area100ft2;
  const leakM3s = leakCfm * CFM_TO_M3S;

  const pct = input.systemFlowM3PerS > 0 ? (leakM3s / input.systemFlowM3PerS) * 100 : 0;
  const allow = (input.allowableLeakFraction ?? 0.05) * 100;
  const within = pct <= allow;
  if (!within) warnings.push(`Leakage ${pct.toFixed(1)}% exceeds allowable ${allow.toFixed(0)}%; specify a tighter seal class.`);

  return {
    staticPressureInWg: pInWg,
    leakageFactor: factor,
    leakageFlowM3PerS: leakM3s,
    leakagePercent: pct,
    withinAllowable: within,
    warnings,
  };
}

/** Recommended leakage class to stay within an allowable % at given conditions. */
export function recommendClass(input: Omit<DuctLeakageInput, 'leakageClass'>): number {
  const target = (input.allowableLeakFraction ?? 0.05) * input.systemFlowM3PerS; // m³/s allowed
  const pInWg = Math.max(0.01, input.staticPressurePa * PA_TO_INWG);
  const factor = Math.pow(pInWg, 0.65);
  const area100ft2 = input.surfaceAreaM2 * M2_TO_100FT2;
  const denom = factor * area100ft2 * CFM_TO_M3S;
  return denom > 0 ? target / denom : Infinity;
}

export function summarize(r: DuctLeakageResult): { leakageFlowM3PerS: number; leakagePercent: number; withinAllowable: boolean } {
  return { leakageFlowM3PerS: r.leakageFlowM3PerS, leakagePercent: r.leakagePercent, withinAllowable: r.withinAllowable };
}
