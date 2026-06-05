/**
 * jetImpact — fluid-jet force from the momentum equation, verified: the flat-plate
 * F=ρQv ≡ ρAv²; the 90°-vane reduction to the flat-plate force and the 180°-vane
 * doubling; the relative-velocity moving-plate force; and the maximum power transfer at
 * u=v/3.
 */
import { describe, it, expect } from 'vitest';
import { jetForceFlatPlate, jetForceMovingPlate, jetForceVane, jetPower } from './jetImpact';

describe('jetImpact — momentum equation (verified)', () => {
  const rho = 1000, A = 0.001, v = 20, Q = A * v;

  it('flat-plate force F = ρAv² = ρQv', () => {
    expect(jetForceFlatPlate(rho, A, v)).toBeCloseTo(rho * Q * v, 9); // 400 N
    expect(jetForceVane(rho, Q, v, Math.PI / 2)).toBeCloseTo(jetForceFlatPlate(rho, A, v), 9); // 90° turn
  });

  it('doubles for a 180° vane', () => {
    expect(jetForceVane(rho, Q, v, Math.PI)).toBeCloseTo(2 * jetForceFlatPlate(rho, A, v), 9); // 800 N
    expect(jetForceVane(rho, Q, v, 0)).toBeCloseTo(0, 9);            // no deflection ⇒ no force
  });

  it('uses the relative velocity for a moving plate', () => {
    expect(jetForceMovingPlate(rho, A, v, 5)).toBeCloseTo(rho * A * (v - 5) ** 2, 9);
    expect(jetForceMovingPlate(rho, A, v, v)).toBeCloseTo(0, 9);     // plate keeps up ⇒ no impact
  });

  it('transfers maximum power at u=v/3 (flat plate)', () => {
    const P = (u: number) => jetPower(jetForceMovingPlate(rho, A, v, u), u);
    const uOpt = v / 3;
    expect(P(uOpt)).toBeGreaterThan(P(0.7 * uOpt));
    expect(P(uOpt)).toBeGreaterThan(P(1.3 * uOpt));
  });
});
