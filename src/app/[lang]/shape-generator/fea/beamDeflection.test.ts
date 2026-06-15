/**
 * beamDeflection — standard beam deflection cases + superposition, verified: the textbook
 * coefficients; the 16× cantilever-to-simply-supported point-load stiffness ratio; the
 * linear superposition of combined loads; and the L³/L⁴ scalings.
 */
import { describe, it, expect } from 'vitest';
import { cantileverPointLoad, cantileverUDL, simplySupportedPointLoad, simplySupportedUDL, superpose } from './beamDeflection';

describe('beamDeflection — standard cases (verified)', () => {
  const P = 1000, w = 500, L = 2, E = 200e9, I = 1e-5;

  it('matches the textbook deflection coefficients', () => {
    expect(cantileverPointLoad(P, L, E, I)).toBeCloseTo((P * L ** 3) / (3 * E * I), 15);
    expect(cantileverUDL(w, L, E, I)).toBeCloseTo((w * L ** 4) / (8 * E * I), 15);
    expect(simplySupportedPointLoad(P, L, E, I)).toBeCloseTo((P * L ** 3) / (48 * E * I), 15);
    expect(simplySupportedUDL(w, L, E, I)).toBeCloseTo((5 * w * L ** 4) / (384 * E * I), 15);
  });

  it('makes a simply-supported beam 16× stiffer than a cantilever under a point load', () => {
    expect(cantileverPointLoad(P, L, E, I) / simplySupportedPointLoad(P, L, E, I)).toBeCloseTo(16, 9);
  });

  it('superposes combined load cases linearly', () => {
    const combined = superpose(simplySupportedPointLoad(P, L, E, I), simplySupportedUDL(w, L, E, I));
    expect(combined).toBeCloseTo(simplySupportedPointLoad(P, L, E, I) + simplySupportedUDL(w, L, E, I), 15);
  });

  it('scales as L³ (point) and L⁴ (UDL)', () => {
    expect(cantileverPointLoad(P, 2 * L, E, I) / cantileverPointLoad(P, L, E, I)).toBeCloseTo(8, 9);  // L³
    expect(cantileverUDL(w, 2 * L, E, I) / cantileverUDL(w, L, E, I)).toBeCloseTo(16, 9);             // L⁴
  });
});
