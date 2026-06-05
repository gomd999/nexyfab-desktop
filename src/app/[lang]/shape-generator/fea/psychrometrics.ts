/**
 * psychrometrics.ts — moist-air (HVAC) properties.
 *
 *   saturation pressure (Magnus):  p_sat = 610.94·exp(17.625·T/(T+243.04))   [Pa, T in °C]
 *   humidity ratio:   W = 0.622·p_v/(p − p_v)
 *   relative humidity: φ = p_v/p_sat(T)
 *   dew point:        T_d such that p_sat(T_d) = p_v
 *   moist-air enthalpy: h = 1.006·T + W·(2501 + 1.86·T)   [kJ/kg dry air]
 *
 * Verified against reference saturation pressures, the φ=100% ⇒ dew point = dry-bulb
 * identity, the dew-point round trip, and the relative-humidity drop on heating at
 * constant humidity ratio.
 */

const STD_P = 101325; // standard atmospheric pressure (Pa)

/** Saturation vapour pressure over water (Magnus formula), T in °C → Pa. */
export function saturationPressure(T: number): number {
  return 610.94 * Math.exp((17.625 * T) / (T + 243.04));
}

/** Humidity ratio W = 0.622·p_v/(p − p_v). */
export function humidityRatio(pv: number, p = STD_P): number {
  return (0.622 * pv) / (p - pv);
}

/** Relative humidity φ = p_v/p_sat(T). */
export function relativeHumidity(pv: number, T: number): number {
  return pv / saturationPressure(T);
}

/** Vapour partial pressure from relative humidity: p_v = φ·p_sat(T). */
export function vapourPressureFromRH(phi: number, T: number): number {
  return phi * saturationPressure(T);
}

/** Dew-point temperature: invert the Magnus formula so p_sat(T_d) = p_v. */
export function dewPoint(pv: number): number {
  const ln = Math.log(pv / 610.94);
  return (243.04 * ln) / (17.625 - ln);
}

/** Moist-air specific enthalpy h = 1.006·T + W·(2501 + 1.86·T) [kJ/kg dry air]. */
export function moistAirEnthalpy(T: number, W: number): number {
  return 1.006 * T + W * (2501 + 1.86 * T);
}
