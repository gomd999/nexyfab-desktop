/**
 * electrostatics — closed-form capacitance and energy, verified: the parallel-plate,
 * coaxial and spherical capacitances (with the isolated-sphere limit b→∞); the energy
 * identities ½CV²=½Q²/C=½QV; the dielectric (εr) and field (E=V/d) relations; and the
 * series/parallel combination rules.
 */
import { describe, it, expect } from 'vitest';
import {
  EPS0, parallelPlateCapacitance, coaxialCapacitance, sphericalCapacitance, isolatedSphereCapacitance,
  charge, energy, parallelPlateField, seriesCapacitance, parallelCapacitance,
} from './electrostatics';

describe('electrostatics — capacitance & energy (verified)', () => {
  it('parallel-plate capacitance scales as ε0·εr·A/d', () => {
    const A = 0.01, d = 1e-3;
    expect(parallelPlateCapacitance(A, d)).toBeCloseTo((EPS0 * A) / d, 18);
    expect(parallelPlateCapacitance(A, d, 5) / parallelPlateCapacitance(A, d)).toBeCloseTo(5, 12); // dielectric
    expect(parallelPlateField(100, d)).toBeCloseTo(100 / d, 9);  // E = V/d
  });

  it('coaxial and spherical capacitances match their formulas', () => {
    expect(coaxialCapacitance(1e-3, 3e-3, 1)).toBeCloseTo((2 * Math.PI * EPS0) / Math.log(3), 18);
    expect(sphericalCapacitance(0.05, 0.1)).toBeCloseTo((4 * Math.PI * EPS0 * 0.05 * 0.1) / 0.05, 18);
    // isolated sphere is the b→∞ limit.
    expect(sphericalCapacitance(0.05, 1e12)).toBeCloseTo(isolatedSphereCapacitance(0.05), 14);
  });

  it('the energy identities ½CV² = ½Q²/C = ½QV hold', () => {
    const C = parallelPlateCapacitance(0.01, 1e-3), V = 100, Q = charge(C, V);
    expect(energy(C, V)).toBeCloseTo(0.5 * Q * Q / C, 18);
    expect(energy(C, V)).toBeCloseTo(0.5 * Q * V, 18);
    // doubling the voltage quadruples the energy.
    expect(energy(C, 2 * V) / energy(C, V)).toBeCloseTo(4, 12);
  });

  it('series and parallel combination rules', () => {
    const c = [2e-12, 3e-12];
    expect(seriesCapacitance(c)).toBeCloseTo(1 / (1 / 2e-12 + 1 / 3e-12), 18); // 1.2 pF
    expect(parallelCapacitance(c)).toBeCloseTo(5e-12, 18);                      // 5 pF
    // series is always less than the smallest; parallel is the sum.
    expect(seriesCapacitance(c)).toBeLessThan(Math.min(...c));
    expect(parallelCapacitance(c)).toBeGreaterThan(Math.max(...c));
  });
});
