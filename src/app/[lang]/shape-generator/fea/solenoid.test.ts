/**
 * solenoid — solenoid/electromagnet magnetics, verified: the interior field B=μ₀nI; the
 * inductance L=μ₀N²A/ℓ; the equivalence of ½LI² and the B-field energy (B²/2μ₀)·(Aℓ);
 * and the Maxwell-stress armature force.
 */
import { describe, it, expect } from 'vitest';
import { MU0, solenoidField, solenoidInductance, magneticEnergy, magneticForce, flux } from './solenoid';

describe('solenoid — electromagnet (verified)', () => {
  const N = 1000, length = 0.5, A = 1e-4, I = 2;
  const n = N / length;
  const B = solenoidField(n, I);

  it('gives the interior field B = μ₀nI', () => {
    expect(B).toBeCloseTo(MU0 * n * I, 15);
    expect(MU0).toBeCloseTo(4 * Math.PI * 1e-7, 18);
    expect(flux(B, A)).toBeCloseTo(B * A, 18);
  });

  it('has inductance L = μ₀N²A/ℓ', () => {
    expect(solenoidInductance(N, A, length)).toBeCloseTo((MU0 * N * N * A) / length, 18);
    expect(solenoidInductance(2 * N, A, length) / solenoidInductance(N, A, length)).toBeCloseTo(4, 9); // ∝ N²
  });

  it('agrees ½LI² with the B-field energy (B²/2μ₀)·(Aℓ)', () => {
    const L = solenoidInductance(N, A, length);
    expect(magneticEnergy(L, I)).toBeCloseTo((B * B) / (2 * MU0) * (A * length), 15);
  });

  it('pulls an armature with the Maxwell-stress force B²A/(2μ₀)', () => {
    expect(magneticForce(B, A)).toBeCloseTo((B * B * A) / (2 * MU0), 15);
    expect(magneticForce(2 * B, A) / magneticForce(B, A)).toBeCloseTo(4, 9); // ∝ B²
  });
});
