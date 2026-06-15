/**
 * stressWave — 1-D elastic stress-wave propagation in a bar, verified: the steel wave
 * speed √(E/ρ) ≈ 5050 m/s; the impact-stress identity σ = ρcv ≡ v√(Eρ) ≡ E·ε; the
 * particle-velocity inverse v = σ/(ρc); and the L/c traversal time.
 */
import { describe, it, expect } from 'vitest';
import { barWaveSpeed, hopkinsonStress, waveStrain, particleVelocity, traversalTime } from './stressWave';

describe('stressWave — elastic bar wave (verified)', () => {
  const E = 200e9, rho = 7850; // steel
  const c = barWaveSpeed(E, rho);

  it('propagates at c = √(E/ρ)', () => {
    expect(c).toBeCloseTo(Math.sqrt(E / rho), 6); // ≈ 5047.5 m/s
    expect(c).toBeGreaterThan(5000);
  });

  it('gives the impact stress σ = ρcv ≡ v√(Eρ) ≡ E·ε', () => {
    const v = 10;
    const sigma = hopkinsonStress(rho, c, v);
    expect(sigma).toBeCloseTo(v * Math.sqrt(E * rho), 3);   // 396 MPa
    expect(sigma).toBeCloseTo(E * waveStrain(v, c), 3);     // σ = Eε
  });

  it('recovers the particle velocity from the stress', () => {
    const v = 10;
    expect(particleVelocity(hopkinsonStress(rho, c, v), rho, c)).toBeCloseTo(v, 9);
  });

  it('traverses a length L in t = L/c', () => {
    expect(traversalTime(2, c)).toBeCloseTo(2 / c, 12);     // ~0.4 ms
    expect(traversalTime(4, c)).toBeCloseTo(2 * traversalTime(2, c), 12); // ∝ L
  });
});
