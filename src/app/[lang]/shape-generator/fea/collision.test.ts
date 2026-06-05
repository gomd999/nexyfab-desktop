/**
 * collision — 1-D direct central impact, verified: momentum conservation for every
 * restitution e; recovery of the input e from the outgoing velocities; zero
 * kinetic-energy loss for the elastic case e=1; and a common velocity (perfect stick)
 * for the perfectly-plastic case e=0, with the ΔKE formula matching the direct balance.
 */
import { describe, it, expect } from 'vitest';
import { finalVelocities, restitution, energyLoss, plasticVelocity } from './collision';

describe('collision — central impact (verified)', () => {
  const m1 = 2, m2 = 3, v1 = 5, v2 = -1;

  it('conserves momentum and recovers e for any restitution', () => {
    for (const e of [1, 0.7, 0.3, 0]) {
      const o = finalVelocities(m1, m2, v1, v2, e);
      expect(m1 * o.v1f + m2 * o.v2f).toBeCloseTo(m1 * v1 + m2 * v2, 9); // momentum
      expect(restitution(v1, v2, o.v1f, o.v2f)).toBeCloseTo(e, 9);       // round trip
    }
  });

  it('conserves kinetic energy for the elastic case (e=1)', () => {
    const o = finalVelocities(m1, m2, v1, v2, 1);
    const keB = 0.5 * m1 * v1 ** 2 + 0.5 * m2 * v2 ** 2;
    const keA = 0.5 * m1 * o.v1f ** 2 + 0.5 * m2 * o.v2f ** 2;
    expect(keA).toBeCloseTo(keB, 9);
    expect(energyLoss(m1, m2, v1, v2, 1)).toBeCloseTo(0, 12);
  });

  it('sticks to a common velocity for the perfectly-plastic case (e=0)', () => {
    const o = finalVelocities(m1, m2, v1, v2, 0);
    expect(o.v1f).toBeCloseTo(o.v2f, 12);
    expect(o.v1f).toBeCloseTo(plasticVelocity(m1, m2, v1, v2), 12); // (m1v1+m2v2)/(m1+m2)
  });

  it('matches the ΔKE = ½μ(1−e²)Δv² formula to the direct energy balance', () => {
    for (const e of [0, 0.5, 0.9]) {
      const o = finalVelocities(m1, m2, v1, v2, e);
      const keB = 0.5 * m1 * v1 ** 2 + 0.5 * m2 * v2 ** 2;
      const keA = 0.5 * m1 * o.v1f ** 2 + 0.5 * m2 * o.v2f ** 2;
      expect(energyLoss(m1, m2, v1, v2, e)).toBeCloseTo(keB - keA, 9);
    }
  });
});
