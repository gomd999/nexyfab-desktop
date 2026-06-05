/**
 * piezoelectric — linear electro-mechanical coupling, verified against the closed
 * forms: the actuator free strain S = d·E and blocked stress T = −d·E/s; the sensor
 * open-circuit field E = −d·T/ε and short-circuit charge D = d·T; the coupling factor
 * k² = d²/(s·ε); and reciprocity (the same d couples both directions).
 */
import { describe, it, expect } from 'vitest';
import {
  freeStrain, blockedStress, openCircuitField, shortCircuitCharge,
  couplingFactorSquared, solvePiezo, PiezoMaterial,
} from './piezoelectric';

const mat: PiezoMaterial = { s: 15e-12, d: 300e-12, eps: 1.5e-8 }; // PZT-like

describe('piezoelectric — electro-mechanical coupling (verified)', () => {
  it('actuator: free strain S = d·E, blocked stress T = −d·E/s', () => {
    const E = 1e6;
    expect(freeStrain(E, mat)).toBeCloseTo(mat.d * E, 15);
    expect(blockedStress(E, mat)).toBeCloseTo(-(mat.d * E) / mat.s, 6);
    // the blocked state really has zero strain.
    const st = solvePiezo({ S: 0, E }, mat);
    expect(st.T).toBeCloseTo(blockedStress(E, mat), 3);
    expect(st.S).toBeCloseTo(0, 12);
  });

  it('sensor: open-circuit field E = −d·T/ε, short-circuit charge D = d·T', () => {
    const T = 20e6;
    expect(openCircuitField(T, mat)).toBeCloseTo(-(mat.d * T) / mat.eps, 6);
    expect(shortCircuitCharge(T, mat)).toBeCloseTo(mat.d * T, 12);
    // open circuit really has zero electric displacement.
    const st = solvePiezo({ T, D: 0 }, mat);
    expect(st.E).toBeCloseTo(openCircuitField(T, mat), 3);
    expect(st.D).toBeCloseTo(0, 12);
  });

  it('the electromechanical coupling factor is k² = d²/(s·ε)', () => {
    expect(couplingFactorSquared(mat)).toBeCloseTo((mat.d ** 2) / (mat.s * mat.eps), 12);
    expect(Math.sqrt(couplingFactorSquared(mat))).toBeGreaterThan(0.5); // strong PZT coupling
    expect(Math.sqrt(couplingFactorSquared(mat))).toBeLessThan(0.8);
  });

  it('is reciprocal: dS/dE|_T equals dD/dT|_E (the same d)', () => {
    const actuator = solvePiezo({ T: 0, E: 1 }, mat).S;   // strain per unit field
    const sensor = solvePiezo({ T: 1, E: 0 }, mat).D;      // charge per unit stress
    expect(actuator).toBeCloseTo(sensor, 18);
    expect(actuator).toBeCloseTo(mat.d, 18);
  });

  it('solves the coupled law from any independent pair consistently', () => {
    const ref = solvePiezo({ T: 5e6, E: 2e5 }, mat);       // a known state
    // recover it from (S, D)
    const fromSD = solvePiezo({ S: ref.S, D: ref.D }, mat);
    expect(fromSD.T).toBeCloseTo(ref.T, 1);
    expect(fromSD.E).toBeCloseTo(ref.E, 1);
  });
});
