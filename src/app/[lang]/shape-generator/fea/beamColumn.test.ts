/**
 * beamColumn — axial-load amplification of bending, verified: the amplification factor
 * 1/(1−P/Pcr) (1 at no load, 2 at half the buckling load, diverging at Pcr); the exact
 * secant amplification sec((L/2)√(P/EI)) which also diverges at Pcr and agrees with the
 * code factor for small P; and the moment magnification and interaction ratio.
 */
import { describe, it, expect } from 'vitest';
import { eulerLoad, amplificationFactor, secantAmplification, magnifiedMoment, interactionRatio } from './beamColumn';

const EI = 1e6, L = 1;
const Pcr = eulerLoad(EI, L);

describe('beamColumn — beam-column amplification (verified)', () => {
  it('the Euler load is π²EI/L²', () => {
    expect(Pcr).toBeCloseTo((Math.PI ** 2 * EI) / (L * L), 4);
  });

  it('the amplification factor is 1 at no load, 2 at half Pcr, and diverges at Pcr', () => {
    expect(amplificationFactor(0, Pcr)).toBeCloseTo(1, 12);
    expect(amplificationFactor(0.5 * Pcr, Pcr)).toBeCloseTo(2, 12);
    expect(amplificationFactor(0.9 * Pcr, Pcr)).toBeCloseTo(10, 9);
    expect(amplificationFactor(0.999 * Pcr, Pcr)).toBeGreaterThan(900); // → ∞
  });

  it('the exact secant amplification also diverges at Pcr and matches AF for small P', () => {
    // u = (L/2)√(P/EI) → π/2 as P → Pcr, where sec → ∞.
    expect(secantAmplification(0.05 * Pcr, EI, L) / amplificationFactor(0.05 * Pcr, Pcr)).toBeCloseTo(1, 1);
    expect(secantAmplification(0.999 * Pcr, EI, L)).toBeGreaterThan(100);
    // secant exceeds the linear AF (AF is the conservative first term).
    expect(secantAmplification(0.5 * Pcr, EI, L)).toBeGreaterThan(amplificationFactor(0.5 * Pcr, Pcr));
  });

  it('the moment magnifies as M0·AF', () => {
    expect(magnifiedMoment(100, 0.5 * Pcr, Pcr)).toBeCloseTo(200, 9);
    expect(magnifiedMoment(100, 0, Pcr)).toBeCloseTo(100, 12); // no axial ⇒ no magnification
  });

  it('the interaction ratio sums the axial and bending utilisations', () => {
    expect(interactionRatio(0.3 * Pcr, Pcr, 50, 200)).toBeCloseTo(0.3 + 0.25, 9);
    // a fully-loaded member reaches 1.
    expect(interactionRatio(0.5 * Pcr, Pcr, 100, 200)).toBeCloseTo(1, 9);
  });
});
