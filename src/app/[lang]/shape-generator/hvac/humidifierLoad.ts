/**
 * humidifierLoad.ts — Compute the moisture load + energy a humidifier must
 * add to raise supply air to a target humidity ratio, and size steam vs
 * evaporative (adiabatic) duty.
 *
 *   ṁ_air     = Q · ρ                                  [kg/s dry air]
 *   moisture  = ṁ_air · (W_target − W_supply)          [kg/s water]
 *   steamLoad = moisture · h_vapor                      (steam: latent added)
 *   evapDrop  = moisture · h_fg / (ṁ_air · cp)          (adiabatic cooling ΔT)
 *
 * Steam humidification adds heat (isothermal-ish); evaporative cools the
 * air (latent drawn from sensible). We report water rate (kg/h, L/h),
 * steam kW, and the evaporative supply-temp drop.
 */

export type HumidifierType = 'steam' | 'evaporative';

export interface HumidifierInput {
  flowRateM3PerS: number;
  supplyHumidityRatio: number;   // W in (kg/kg)
  targetHumidityRatio: number;   // W out
  supplyTempC: number;
  type: HumidifierType;
  airDensityKgM3?: number;       // default 1.2
  steamEnthalpyKJkg?: number;    // default 2675 (sat steam ~100°C)
  evapEffectiveness?: number;    // default 0.85 (saturation efficiency)
}

export interface HumidifierResult {
  dryAirMassFlowKgS: number;
  moistureLoadKgH: number;
  waterRateLPerH: number;
  steamLoadKW: number | null;
  evapTempDropC: number | null;
  effectiveTargetW: number;      // after evaporative effectiveness cap
  warnings: string[];
}

export function compute(input: HumidifierInput): HumidifierResult {
  const warnings: string[] = [];
  if (input.flowRateM3PerS <= 0) warnings.push('Flow rate must be positive.');
  if (input.targetHumidityRatio < input.supplyHumidityRatio) warnings.push('Target humidity below supply — no humidification needed.');

  const rho = input.airDensityKgM3 ?? 1.2;
  const mAir = input.flowRateM3PerS * rho; // kg/s dry air (approx)

  let effectiveTarget = input.targetHumidityRatio;
  if (input.type === 'evaporative') {
    const eff = input.evapEffectiveness ?? 0.85;
    // Evaporative can only approach saturation; effective gain = eff × (target − supply).
    effectiveTarget = input.supplyHumidityRatio + eff * (input.targetHumidityRatio - input.supplyHumidityRatio);
  }

  const dW = Math.max(0, effectiveTarget - input.supplyHumidityRatio);
  const moistureKgS = mAir * dW;
  const moistureKgH = moistureKgS * 3600;
  const waterLPerH = moistureKgH; // 1 kg water ≈ 1 L

  let steamLoadKW: number | null = null;
  let evapDrop: number | null = null;

  if (input.type === 'steam') {
    const hSteam = input.steamEnthalpyKJkg ?? 2675;
    steamLoadKW = moistureKgS * hSteam; // kJ/s = kW
  } else {
    // Adiabatic: latent for evaporation drawn from sensible → ΔT drop.
    const hfg = 2454; // kJ/kg at ~20°C
    const cpAir = 1.006; // kJ/kg·K
    evapDrop = mAir > 0 ? (moistureKgS * hfg) / (mAir * cpAir) : 0;
  }

  return {
    dryAirMassFlowKgS: mAir,
    moistureLoadKgH: moistureKgH,
    waterRateLPerH: waterLPerH,
    steamLoadKW,
    evapTempDropC: evapDrop,
    effectiveTargetW: effectiveTarget,
    warnings,
  };
}

/** Water consumption over a run time (litres). */
export function waterConsumptionL(result: HumidifierResult, hours: number): number {
  return result.waterRateLPerH * Math.max(0, hours);
}

export function summarize(r: HumidifierResult): { moistureLoadKgH: number; steamLoadKW: number | null; evapTempDropC: number | null } {
  return { moistureLoadKgH: r.moistureLoadKgH, steamLoadKW: r.steamLoadKW, evapTempDropC: r.evapTempDropC };
}
