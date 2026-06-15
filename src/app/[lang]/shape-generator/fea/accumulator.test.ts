/**
 * accumulator — gas-charged hydraulic accumulator, verified: the Boyle product
 * P₁V₁=P₂V₂; the compression V₂<V₁ for P₂>P₁; the stiffer adiabatic response (smaller
 * volume swing than isothermal); and the positive usable fluid volume over a valid band.
 */
import { describe, it, expect } from 'vitest';
import { boyleVolume, polytropicVolume, usableVolume, accumulatorEnergy } from './accumulator';

describe('accumulator — gas-charged hydraulics (verified)', () => {
  const P1 = 1e7, V1 = 2, P2 = 2e7;

  it('obeys Boyle PV=const and compresses the gas', () => {
    const V2 = boyleVolume(P1, V1, P2);
    expect(P1 * V1).toBeCloseTo(P2 * V2, 3);               // P₁V₁ = P₂V₂
    expect(V2).toBeLessThan(V1);                           // higher pressure ⇒ smaller volume
  });

  it('responds stiffer when adiabatic (smaller volume swing)', () => {
    const swingIso = V1 - boyleVolume(P1, V1, P2);
    const swingAdiabatic = V1 - polytropicVolume(P1, V1, P2, 1.4);
    expect(swingAdiabatic).toBeLessThan(swingIso);         // fast cycling is stiffer
    expect(swingAdiabatic).toBeGreaterThan(0);
  });

  it('delivers a positive usable fluid volume over the pressure band', () => {
    const P0 = 8e6, V0 = 4;
    expect(usableVolume(P0, V0, P1, P2)).toBeCloseTo(P0 * V0 * (1 / P1 - 1 / P2), 9);
    expect(usableVolume(P0, V0, P1, P2)).toBeGreaterThan(0);
    // a wider pressure band delivers more fluid
    expect(usableVolume(P0, V0, P1, 3e7)).toBeGreaterThan(usableVolume(P0, V0, P1, P2));
  });

  it('stores positive isothermal energy', () => {
    expect(accumulatorEnergy(P1, V1, P2)).toBeCloseTo(P1 * V1 * Math.log(2), 3);
    expect(accumulatorEnergy(P1, V1, P2)).toBeGreaterThan(0);
  });
});
