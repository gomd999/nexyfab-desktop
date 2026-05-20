/**
 * psychrometricState.ts — Compute moist-air psychrometric properties from
 * dry-bulb temperature + relative humidity (at a given pressure), using
 * the standard ASHRAE relations.
 *
 *   Saturation pressure (Hyland-Wexler approx / Magnus):
 *     p_ws = 610.94 · exp(17.625·T / (T + 243.04))   [Pa], T in °C
 *   Partial vapour pressure:  p_w = RH · p_ws
 *   Humidity ratio:           W = 0.62198 · p_w / (P − p_w)   [kg/kg]
 *   Enthalpy:                 h = 1.006·T + W·(2501 + 1.86·T) [kJ/kg]
 *   Dew point:                T_d from inverting p_ws(p_w)
 *   Wet bulb (approx):        iterative match of enthalpy
 */

export interface PsychrometricInput {
  dryBulbC: number;
  relativeHumidity: number; // 0..1
  pressurePa?: number;      // default 101325
}

export interface PsychrometricResult {
  saturationPressurePa: number;
  vapourPressurePa: number;
  humidityRatio: number;     // kg water / kg dry air
  enthalpyKJkg: number;
  dewPointC: number;
  wetBulbC: number;
  specificVolumeM3kg: number;
  warnings: string[];
}

export function compute(input: PsychrometricInput): PsychrometricResult {
  const warnings: string[] = [];
  const T = input.dryBulbC;
  const RH = input.relativeHumidity;
  const P = input.pressurePa ?? 101325;
  if (RH < 0 || RH > 1) warnings.push('Relative humidity should be 0..1.');
  if (P <= 0) warnings.push('Pressure must be positive.');

  const pws = saturationPressurePa(T);
  const pw = Math.max(0, Math.min(pws, RH * pws));
  const W = 0.62198 * pw / Math.max(1e-6, P - pw);
  const h = 1.006 * T + W * (2501 + 1.86 * T);
  const Td = dewPointFromVapour(pw);
  const Twb = wetBulbApprox(T, W, P);
  // specific volume of moist air (m³/kg dry air): v = Ra·T_abs·(1+1.6078W)/P
  const Ra = 287.055;
  const v = (Ra * (T + 273.15) * (1 + 1.6078 * W)) / P;

  return {
    saturationPressurePa: pws,
    vapourPressurePa: pw,
    humidityRatio: W,
    enthalpyKJkg: h,
    dewPointC: Td,
    wetBulbC: Twb,
    specificVolumeM3kg: v,
    warnings,
  };
}

/** Magnus saturation pressure over water (Pa). */
export function saturationPressurePa(tempC: number): number {
  return 610.94 * Math.exp((17.625 * tempC) / (tempC + 243.04));
}

function dewPointFromVapour(pwPa: number): number {
  if (pwPa <= 0) return -100;
  const ln = Math.log(pwPa / 610.94);
  return (243.04 * ln) / (17.625 - ln);
}

function wetBulbApprox(dryBulbC: number, W: number, P: number): number {
  // Iterate Twb so that the wet-bulb humidity ratio matches the adiabatic line.
  let lo = -20, hi = dryBulbC;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const pwsWb = saturationPressurePa(mid);
    const Wswb = 0.62198 * pwsWb / Math.max(1e-6, P - pwsWb);
    // psychrometric energy balance: W·(line) ...
    const Wline = ((2501 - 2.326 * mid) * Wswb - 1.006 * (dryBulbC - mid)) / (2501 + 1.86 * dryBulbC - 4.186 * mid);
    if (Wline > W) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Inverse: relative humidity from dry-bulb + dew-point. */
export function rhFromDewPoint(dryBulbC: number, dewPointC: number): number {
  const pw = saturationPressurePa(dewPointC);
  const pws = saturationPressurePa(dryBulbC);
  return pws > 0 ? Math.max(0, Math.min(1, pw / pws)) : 0;
}

export function summarize(r: PsychrometricResult): { humidityRatio: number; enthalpyKJkg: number; dewPointC: number; wetBulbC: number } {
  return { humidityRatio: r.humidityRatio, enthalpyKJkg: r.enthalpyKJkg, dewPointC: r.dewPointC, wetBulbC: r.wetBulbC };
}
