/**
 * thermocouple — Seebeck-effect thermoelectric measurement, verified: the linear
 * V=S·ΔT (zero at ΔT=0); the cold-junction recovery of the hot temperature; the
 * polynomial sensitivity dV/dT = a+bΔT; and the b=0 reduction to the linear law.
 */
import { describe, it, expect } from 'vitest';
import { seebeckVoltage, seebeckVoltageQuadratic, sensitivity, coldJunctionCompensation, relativeSeebeck } from './thermocouple';

describe('thermocouple — Seebeck effect (verified)', () => {
  const S = 41e-6; // ~type-K, V/K

  it('gives a linear V = S·ΔT, zero at ΔT=0', () => {
    expect(seebeckVoltage(S, 125, 25)).toBeCloseTo(S * 100, 15); // 4.1 mV
    expect(seebeckVoltage(S, 25, 25)).toBeCloseTo(0, 15);
    // sign flips when the junction is colder than the reference
    expect(seebeckVoltage(S, 0, 25)).toBeLessThan(0);
  });

  it('recovers the hot-junction temperature with cold-junction compensation', () => {
    const V = seebeckVoltage(S, 125, 25);
    expect(coldJunctionCompensation(V, S, 25)).toBeCloseTo(125, 9);
    expect(relativeSeebeck(6.5e-6, -35e-6)).toBeCloseTo(41.5e-6, 15); // pair difference
  });

  it('has polynomial sensitivity dV/dT = a + bΔT and reduces to linear at b=0', () => {
    const a = 40e-6, b = 0.04e-6;
    expect(seebeckVoltageQuadratic(a, 0, 100)).toBeCloseTo(a * 100, 15); // b=0 ⇒ linear
    expect(sensitivity(a, b, 100)).toBeCloseTo(a + b * 100, 15);
    expect(sensitivity(a, b, 0)).toBeCloseTo(a, 15);       // base slope at ΔT=0
  });
});
