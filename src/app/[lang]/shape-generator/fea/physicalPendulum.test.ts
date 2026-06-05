/**
 * physicalPendulum — compound-pendulum small oscillation, verified: the reduction to the
 * simple pendulum (I=mL², d=L ⇒ T=2π√(L/g)); the equivalent-length identity (compound
 * period = simple period of length L_eq); the uniform-rod-about-end case (L_eq=2L/3); and
 * ω=2π/T.
 */
import { describe, it, expect } from 'vitest';
import { physicalPendulumPeriod, simplePendulumPeriod, equivalentLength, pendulumAngularFrequency } from './physicalPendulum';

describe('physicalPendulum — compound oscillation (verified)', () => {
  const g = 9.80665, m = 2, L = 1;

  it('reduces to the simple pendulum for a point mass', () => {
    expect(physicalPendulumPeriod(m * L * L, m, g, L)).toBeCloseTo(simplePendulumPeriod(L, g), 9);
  });

  it('matches a simple pendulum of the equivalent length', () => {
    const I = (m * L * L) / 3, d = L / 2;          // uniform rod about one end
    expect(equivalentLength(I, m, d)).toBeCloseTo((2 * L) / 3, 9); // L_eq = 2L/3
    expect(physicalPendulumPeriod(I, m, g, d)).toBeCloseTo(simplePendulumPeriod(equivalentLength(I, m, d), g), 9);
  });

  it('relates angular frequency to the period ω=2π/T', () => {
    const I = (m * L * L) / 3, d = L / 2;
    expect(pendulumAngularFrequency(I, m, g, d)).toBeCloseTo((2 * Math.PI) / physicalPendulumPeriod(I, m, g, d), 9);
  });

  it('lengthens the period as the moment of inertia grows', () => {
    const d = L / 2;
    expect(physicalPendulumPeriod((m * L * L) / 3, m, g, d)).toBeGreaterThan(physicalPendulumPeriod((m * L * L) / 6, m, g, d));
    // period ∝ √I at fixed m,d
    expect(physicalPendulumPeriod(4, m, g, d) / physicalPendulumPeriod(1, m, g, d)).toBeCloseTo(2, 9);
  });
});
