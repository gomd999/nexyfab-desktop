/**
 * acousticImpedance — plane-wave reflection/transmission at a media boundary, verified:
 * the matched-impedance full transmission (R=0, τ=1); the energy conservation τ+R²=1; the
 * rigid-wall full reflection (Z₂→∞ ⇒ R→1); and Z=ρc.
 */
import { describe, it, expect } from 'vitest';
import { acousticImpedance, reflectionCoefficient, transmissionCoefficient, powerTransmission, powerReflection } from './acousticImpedance';

describe('acousticImpedance — reflection/transmission (verified)', () => {
  const Zair = acousticImpedance(1.225, 343);
  const Zwater = acousticImpedance(1000, 1480);

  it('fully transmits at matched impedance (R=0, τ=1)', () => {
    expect(reflectionCoefficient(500, 500)).toBeCloseTo(0, 12);
    expect(powerTransmission(500, 500)).toBeCloseTo(1, 12);
    expect(transmissionCoefficient(500, 500)).toBeCloseTo(1, 12);
  });

  it('conserves energy τ + R² = 1', () => {
    expect(powerTransmission(Zair, Zwater) + powerReflection(Zair, Zwater)).toBeCloseTo(1, 9);
    expect(powerTransmission(500, 1500) + powerReflection(500, 1500)).toBeCloseTo(1, 12);
  });

  it('reflects almost everything across the air–water mismatch', () => {
    expect(Math.abs(reflectionCoefficient(Zair, Zwater))).toBeGreaterThan(0.99);
    expect(powerTransmission(Zair, Zwater)).toBeLessThan(0.002); // very little couples in
  });

  it('fully reflects off a rigid wall (Z₂→∞ ⇒ R→1)', () => {
    expect(reflectionCoefficient(Zair, 1e12)).toBeCloseTo(1, 6);
    expect(powerTransmission(Zair, 1e12)).toBeLessThan(1e-6);
    expect(acousticImpedance(1.225, 343)).toBeCloseTo(1.225 * 343, 9); // Z = ρc
  });
});
