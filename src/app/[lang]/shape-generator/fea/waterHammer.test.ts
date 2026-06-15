/**
 * waterHammer — Joukowsky valve-closure surge and elastic-pipe wave speed, verified:
 * the rigid-pipe acoustic limit a→√(K/ρ) ≈ 1483 m/s for water; pipe-wall compliance
 * lowering the wave speed below the acoustic value; the surge-head identity
 * Δh = ΔP/(ρg); and the 2L/a reflection time.
 */
import { describe, it, expect } from 'vitest';
import { joukowskySurge, surgeHead, waveSpeed, acousticSpeed, criticalTime } from './waterHammer';

describe('waterHammer — Joukowsky surge (verified)', () => {
  const K = 2.2e9, rho = 1000; // water

  it('approaches the fluid acoustic speed for a rigid pipe', () => {
    expect(acousticSpeed(K, rho)).toBeCloseTo(Math.sqrt(K / rho), 6); // ≈ 1483 m/s
    expect(acousticSpeed(K, rho)).toBeGreaterThan(1480);
    expect(waveSpeed(K, rho, 1e15, 0.1, 0.005)).toBeCloseTo(acousticSpeed(K, rho), 1); // E→∞
  });

  it('pipe-wall elasticity lowers the wave speed below the acoustic value', () => {
    const a = waveSpeed(K, rho, 200e9, 0.1, 0.005); // steel pipe
    expect(a).toBeLessThan(acousticSpeed(K, rho));
    expect(a).toBeGreaterThan(1300);                       // ~1343 m/s
    // a thinner wall is more compliant ⇒ slower wave
    expect(waveSpeed(K, rho, 200e9, 0.1, 0.002)).toBeLessThan(a);
  });

  it('gives the surge head Δh = ΔP/(ρg) and a severe pressure rise', () => {
    const a = waveSpeed(K, rho, 200e9, 0.1, 0.005), dv = 2;
    const dP = joukowskySurge(rho, a, dv);
    expect(surgeHead(a, dv)).toBeCloseTo(dP / (rho * 9.80665), 6);
    expect(dP).toBeGreaterThan(2e6);                       // >20 bar from a 2 m/s stop
    // surge is linear in the velocity change
    expect(joukowskySurge(rho, a, 4)).toBeCloseTo(2 * dP, 6);
  });

  it('the critical (reflection) time is 2L/a', () => {
    const a = acousticSpeed(K, rho);
    expect(criticalTime(500, a)).toBeCloseTo((2 * 500) / a, 9);
    expect(criticalTime(1000, a)).toBeCloseTo(2 * criticalTime(500, a), 9); // ∝ L
  });
});
