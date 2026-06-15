/**
 * rotorBalance — rotating-mass unbalance and static balancing, verified: the ω²
 * centrifugal-force scaling; the single-plane correction moment m_c·r_c = m·e; the
 * resultant of a vector sum of unbalance vectors; and a 180°-opposed equal pair being
 * statically balanced.
 */
import { describe, it, expect } from 'vitest';
import { unbalanceForce, correctionMass, staticUnbalance } from './rotorBalance';

describe('rotorBalance — unbalance + balancing (verified)', () => {
  it('scales the centrifugal force with ω²', () => {
    expect(unbalanceForce(0.5, 0.01, 100)).toBeCloseTo(0.5 * 0.01 * 100 ** 2, 9); // 50 N
    expect(unbalanceForce(0.5, 0.01, 200) / unbalanceForce(0.5, 0.01, 100)).toBeCloseTo(4, 9);
  });

  it('sizes the correction mass so m_c·r_c = m·e', () => {
    const mc = correctionMass(0.5, 0.01, 0.05);
    expect(mc * 0.05).toBeCloseTo(0.5 * 0.01, 12);          // moment balance
    // a larger correction radius needs less mass
    expect(correctionMass(0.5, 0.01, 0.1)).toBeLessThan(mc);
  });

  it('statically balances a 180°-opposed equal pair', () => {
    const r = staticUnbalance([2, 2], [0.1, 0.1], [0, Math.PI]);
    expect(r.magnitude).toBeCloseTo(0, 12);                 // resultant unbalance vanishes
  });

  it('returns the resultant magnitude and angle of a vector sum', () => {
    const r = staticUnbalance([3], [0.05], [Math.PI / 4]);
    expect(r.magnitude).toBeCloseTo(0.15, 9);              // m·r
    expect(r.angle).toBeCloseTo(Math.PI / 4, 9);
    // two equal masses 90° apart ⇒ resultant at 45°, magnitude √2·U
    const r2 = staticUnbalance([1, 1], [0.1, 0.1], [0, Math.PI / 2]);
    expect(r2.magnitude).toBeCloseTo(Math.SQRT2 * 0.1, 9);
    expect(r2.angle).toBeCloseTo(Math.PI / 4, 9);
  });
});
