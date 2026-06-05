/**
 * torsion — Saint-Venant torsion, verified: the solid/hollow circular shaft
 * (J=πd⁴/32, τ_max=16T/πd³, θ=TL/GJ); the thin strip (J=ab³/3, τ_max=3T/ab²); the
 * Bredt thin-walled tube (τ=T/2A_m t); the closed≫open section stiffness contrast;
 * and the shaft power P=Tω.
 */
import { describe, it, expect } from 'vitest';
import {
  polarMomentSolid, polarMomentHollow, maxShearCircular, twistAngle,
  thinStripTorsionConstant, thinStripMaxShear, bredtShearStress,
  closedSectionTorsionConstant, openSectionTorsionConstant, shaftPower,
} from './torsion';

const d = 0.05, T = 1000, G = 80e9, L = 1;

describe('torsion — shaft & thin-section torsion (verified)', () => {
  it('solid circular shaft: J=πd⁴/32, τ_max=Tr/J=16T/πd³, θ=TL/GJ', () => {
    const J = polarMomentSolid(d);
    expect(J).toBeCloseTo((Math.PI * d ** 4) / 32, 18);
    expect(maxShearCircular(T, d)).toBeCloseTo((T * (d / 2)) / J, 4); // = Tr/J
    expect(maxShearCircular(T, d)).toBeCloseTo((16 * T) / (Math.PI * d ** 3), 4);
    expect(twistAngle(T, L, G, J)).toBeCloseTo((T * L) / (G * J), 12);
  });

  it('hollow circular shaft: J = π(do⁴−di⁴)/32', () => {
    expect(polarMomentHollow(0.05, 0.03)).toBeCloseTo((Math.PI * (0.05 ** 4 - 0.03 ** 4)) / 32, 18);
    expect(polarMomentHollow(0.05, 0)).toBeCloseTo(polarMomentSolid(0.05), 18); // di=0 ⇒ solid
  });

  it('thin rectangular strip: J = ab³/3 and τ_max = 3T/ab²', () => {
    const a = 0.1, b = 0.005;
    expect(thinStripTorsionConstant(a, b)).toBeCloseTo((a * b ** 3) / 3, 18);
    expect(thinStripMaxShear(T, a, b)).toBeCloseTo((3 * T) / (a * b * b), 6);
  });

  it('Bredt thin-walled closed tube: τ = T/(2·A_m·t)', () => {
    const Am = 0.0025, t = 0.002;
    expect(bredtShearStress(T, Am, t)).toBeCloseTo(T / (2 * Am * t), 6);
  });

  it('a closed section is far stiffer in torsion than an open one', () => {
    const Am = 0.0025, perimeter = 0.2, t = 0.002;
    const closed = closedSectionTorsionConstant(Am, perimeter, t);
    const open = openSectionTorsionConstant(perimeter, t);
    expect(closed / open).toBeGreaterThan(100);        // ~469× here
  });

  it('transmits power P = T·ω', () => {
    expect(shaftPower(1000, 100)).toBe(100000);
  });
});
