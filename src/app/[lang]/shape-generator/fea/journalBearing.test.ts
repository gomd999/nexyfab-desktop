/**
 * journalBearing — Petroff/Sommerfeld plain-bearing characteristics, verified: the
 * Petroff torque identity T ≡ f·W·r linking the friction coefficient and the viscous
 * drag torque; the friction–Sommerfeld relation f·(r/c) = 2π²S; and the clearance
 * scalings (f ∝ 1/c, S ∝ 1/c²).
 */
import { describe, it, expect } from 'vitest';
import { projectedPressure, sommerfeldNumber, petroffFriction, petroffTorque, frictionPower } from './journalBearing';

describe('journalBearing — Petroff/Sommerfeld (verified)', () => {
  const r = 0.025, c = 2.5e-5, L = 0.05, mu = 0.02, N = 30, W = 2000;
  const P = projectedPressure(W, r, L);

  it('the Petroff torque equals f·W·r', () => {
    const f = petroffFriction(mu, N, P, r, c);
    const T = petroffTorque(mu, N, r, L, c);
    expect(T).toBeCloseTo(f * W * r, 9);
  });

  it('relates friction to the Sommerfeld number: f·(r/c) = 2π²S', () => {
    const f = petroffFriction(mu, N, P, r, c);
    const S = sommerfeldNumber(r, c, mu, N, P);
    expect(f * (r / c)).toBeCloseTo(2 * Math.PI ** 2 * S, 9);
  });

  it('scales with clearance: f ∝ 1/c, S ∝ 1/c²', () => {
    const f1 = petroffFriction(mu, N, P, r, c), f2 = petroffFriction(mu, N, P, r, 2 * c);
    const S1 = sommerfeldNumber(r, c, mu, N, P), S2 = sommerfeldNumber(r, 2 * c, mu, N, P);
    expect(f2 / f1).toBeCloseTo(0.5, 9);
    expect(S2 / S1).toBeCloseTo(0.25, 9);
  });

  it('projected pressure is the load over the projected area, and power = T·ω', () => {
    expect(P).toBeCloseTo(W / (2 * r * L), 6);              // 800 kPa
    const T = petroffTorque(mu, N, r, L, c);
    expect(frictionPower(T, N)).toBeCloseTo(T * 2 * Math.PI * N, 9);
  });
});
