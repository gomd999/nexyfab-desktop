/**
 * psychrometrics — moist-air HVAC properties, verified: the Magnus saturation
 * pressures (611 Pa at 0 °C, ~2.34 kPa at 20 °C); the humidity-ratio/relative-humidity
 * round trip; the dew-point round trip (p_sat(T_d)=p_v) and the φ=100% ⇒ dew point =
 * dry-bulb identity; and the relative-humidity drop when heating at constant W.
 */
import { describe, it, expect } from 'vitest';
import { saturationPressure, humidityRatio, relativeHumidity, vapourPressureFromRH, dewPoint, moistAirEnthalpy } from './psychrometrics';

describe('psychrometrics — moist air (verified)', () => {
  it('the Magnus saturation pressures match reference values', () => {
    expect(saturationPressure(0)).toBeCloseTo(611, -1);          // ~611 Pa
    expect(saturationPressure(20) / 2339).toBeGreaterThan(0.99); // ~2.34 kPa
    expect(saturationPressure(20) / 2339).toBeLessThan(1.01);
    expect(saturationPressure(30)).toBeGreaterThan(saturationPressure(20)); // monotone
  });

  it('humidity ratio and relative humidity round-trip', () => {
    const T = 20, phi = 0.5;
    const pv = vapourPressureFromRH(phi, T);
    expect(relativeHumidity(pv, T)).toBeCloseTo(0.5, 9);
    expect(humidityRatio(pv)).toBeCloseTo((0.622 * pv) / (101325 - pv), 9);
  });

  it('the dew point inverts the saturation curve (p_sat(T_d)=p_v)', () => {
    const pv = vapourPressureFromRH(0.5, 20);
    expect(saturationPressure(dewPoint(pv))).toBeCloseTo(pv, 6);
    // at 100% RH the dew point equals the dry-bulb temperature.
    expect(dewPoint(saturationPressure(20))).toBeCloseTo(20, 6);
    // the dew point is below the dry bulb for unsaturated air.
    expect(dewPoint(pv)).toBeLessThan(20);
  });

  it('heating at constant humidity ratio lowers the relative humidity', () => {
    const pv = vapourPressureFromRH(0.5, 20); // fix the moisture content
    expect(relativeHumidity(pv, 30)).toBeLessThan(0.5);  // warmer air ⇒ drier (lower φ)
    expect(relativeHumidity(pv, 10)).toBeGreaterThan(0.5); // cooler ⇒ higher φ
  });

  it('moist-air enthalpy combines dry-air and moisture terms', () => {
    const T = 20, W = 0.00725;
    expect(moistAirEnthalpy(T, W)).toBeCloseTo(1.006 * T + W * (2501 + 1.86 * T), 9);
    // adding moisture raises the enthalpy.
    expect(moistAirEnthalpy(T, 0.01)).toBeGreaterThan(moistAirEnthalpy(T, 0.005));
  });
});
