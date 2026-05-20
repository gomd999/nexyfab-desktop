/**
 * coilLoad.ts — Compute the sensible, latent, and total load of an
 * air-handling cooling (or heating) coil from entering/leaving air
 * conditions and airflow.
 *
 * Mass flow of dry air:  ṁ = Q_v · ρ      (ρ ≈ 1.2 kg/m³)
 *
 *   Sensible load:  Q_s = ṁ · c_p · (T_in − T_out)     [c_p ≈ 1.006 kJ/kg·K dry + moisture]
 *                 ≈ 1.23 · Q_v(L/s) · ΔT               (SI shortcut, W)
 *   Latent load:    Q_l = ṁ · h_fg · (W_in − W_out)    [h_fg ≈ 2501 kJ/kg]
 *                 ≈ 3010 · Q_v(L/s) · ΔW(kg/kg)        (W)
 *   Total:          Q_t = Q_s + Q_l = ṁ · (h_in − h_out)
 *
 * We accept full psychrometric points (T, W, h) and return loads in kW,
 * plus the sensible heat ratio SHR = Q_s/Q_t.
 */

export interface AirCondition {
  dryBulbC: number;
  humidityRatio: number; // kg/kg
  enthalpyKJkg: number;
}

export interface CoilLoadInput {
  flowRateM3PerS: number;
  entering: AirCondition;
  leaving: AirCondition;
  airDensityKgM3?: number; // default 1.2
}

export interface CoilLoadResult {
  massFlowKgS: number;
  sensibleKW: number;
  latentKW: number;
  totalKW: number;
  sensibleHeatRatio: number;
  mode: 'cooling' | 'heating';
  condensateKgH: number; // water removed (cooling)
  warnings: string[];
}

export function compute(input: CoilLoadInput): CoilLoadResult {
  const warnings: string[] = [];
  if (input.flowRateM3PerS <= 0) warnings.push('Flow rate must be positive.');
  const rho = input.airDensityKgM3 ?? 1.2;
  const mdot = input.flowRateM3PerS * rho; // kg/s

  const cp = 1.006; // kJ/kg·K (dry air; moisture adds ~1.86·W, small)
  const hfg = 2501;  // kJ/kg

  const dT = input.entering.dryBulbC - input.leaving.dryBulbC;
  const dW = input.entering.humidityRatio - input.leaving.humidityRatio;
  const dH = input.entering.enthalpyKJkg - input.leaving.enthalpyKJkg;

  const sensibleKW = mdot * cp * dT;
  const latentKW = mdot * hfg * dW;
  const totalKW = mdot * dH;

  const mode: 'cooling' | 'heating' = totalKW >= 0 ? 'cooling' : 'heating';
  const shr = Math.abs(totalKW) > 1e-9 ? sensibleKW / totalKW : 1;

  // Condensate (cooling only): water removed = ṁ·ΔW (kg/s) → kg/h.
  const condensate = dW > 0 ? mdot * dW * 3600 : 0;

  return {
    massFlowKgS: mdot,
    sensibleKW,
    latentKW,
    totalKW,
    sensibleHeatRatio: shr,
    mode,
    condensateKgH: condensate,
    warnings,
  };
}

/** SI shortcut sensible load (W) from airflow (L/s) and ΔT. */
export function sensibleShortcutW(flowLps: number, deltaTC: number): number {
  return 1.23 * flowLps * deltaTC;
}

/** SI shortcut latent load (W) from airflow (L/s) and ΔW (kg/kg). */
export function latentShortcutW(flowLps: number, deltaW: number): number {
  return 3010 * flowLps * deltaW;
}

export function summarize(r: CoilLoadResult): { totalKW: number; sensibleHeatRatio: number; mode: 'cooling' | 'heating' } {
  return { totalKW: r.totalKW, sensibleHeatRatio: r.sensibleHeatRatio, mode: r.mode };
}
