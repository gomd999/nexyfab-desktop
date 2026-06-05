/**
 * powerScrew — square-thread lead screw, verified: the lead angle tanλ=L/(πd_m); the
 * efficiency η matching its energy definition W·L/(2π·T↑); the frictionless η=1 limit;
 * and the self-locking ⇔ lowering-torque ≥ 0 equivalence.
 */
import { describe, it, expect } from 'vitest';
import { leadAngle, raiseTorque, lowerTorque, screwEfficiency, isSelfLocking } from './powerScrew';

describe('powerScrew — lead screw (verified)', () => {
  const W = 10000, dm = 0.04, L = 0.007;
  const lambda = leadAngle(L, dm);

  it('has lead angle tanλ = L/(π·d_m)', () => {
    expect(Math.tan(lambda)).toBeCloseTo(L / (Math.PI * dm), 12);
  });

  it('efficiency equals the energy definition W·L/(2π·T↑)', () => {
    const mu = 0.15;
    const Tr = raiseTorque(W, dm, lambda, mu);
    expect(screwEfficiency(lambda, mu)).toBeCloseTo((W * L) / (2 * Math.PI * Tr), 9); // ~0.27
  });

  it('reaches η=1 in the frictionless limit', () => {
    expect(screwEfficiency(lambda, 0)).toBeCloseTo(1, 9);
  });

  it('self-locks exactly when the lowering torque is non-negative', () => {
    const muLock = 0.15, muFree = 0.05;
    expect(isSelfLocking(lambda, muLock)).toBe(true);
    expect(lowerTorque(W, dm, lambda, muLock)).toBeGreaterThan(0);   // resists back-drive
    expect(isSelfLocking(lambda, muFree)).toBe(false);
    expect(lowerTorque(W, dm, lambda, muFree)).toBeLessThan(0);      // back-drives (overhauls)
    // boundary: μ = tanλ ⇒ lowering torque exactly zero
    expect(lowerTorque(W, dm, lambda, Math.tan(lambda))).toBeCloseTo(0, 9);
  });
});
