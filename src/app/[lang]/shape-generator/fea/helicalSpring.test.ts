/**
 * helicalSpring — coil compression-spring design, verified: the spring rate
 * Gd⁴/(8D³Na) and its strong d⁴/Na dependence; the spring index C=D/d and Wahl factor
 * (>1); the corrected shear stress Kw·8FD/(πd³); the deflection F/k; and the solid
 * length.
 */
import { describe, it, expect } from 'vitest';
import { springRate, springIndex, wahlFactor, shearStress, deflection, solidLength } from './helicalSpring';

const G = 79e9, d = 0.005, D = 0.04, Na = 8;

describe('helicalSpring — coil spring design (verified)', () => {
  it('the spring rate is Gd⁴/(8D³Na)', () => {
    expect(springRate(G, d, D, Na)).toBeCloseTo((G * d ** 4) / (8 * D ** 3 * Na), 3);
  });

  it('doubling the wire diameter makes it 16× stiffer; doubling coils halves it', () => {
    expect(springRate(G, 2 * d, D, Na) / springRate(G, d, D, Na)).toBeCloseTo(16, 6); // d⁴
    expect(springRate(G, d, D, 2 * Na) / springRate(G, d, D, Na)).toBeCloseTo(0.5, 9); // 1/Na
    expect(springRate(G, d, 2 * D, Na) / springRate(G, d, D, Na)).toBeCloseTo(1 / 8, 9); // 1/D³
  });

  it('the spring index C=D/d and the Wahl factor (>1)', () => {
    const C = springIndex(D, d);
    expect(C).toBeCloseTo(8, 12);
    expect(wahlFactor(C)).toBeCloseTo((4 * C - 1) / (4 * C - 4) + 0.615 / C, 9);
    expect(wahlFactor(C)).toBeGreaterThan(1);          // stress correction
    expect(wahlFactor(4)).toBeGreaterThan(wahlFactor(12)); // tighter index ⇒ larger correction
  });

  it('the corrected shear stress is Kw·8FD/(πd³) and the deflection is F/k', () => {
    const F = 100, Kw = wahlFactor(springIndex(D, d));
    expect(shearStress(F, D, d, Kw)).toBeCloseTo((Kw * 8 * F * D) / (Math.PI * d ** 3), 3);
    const k = springRate(G, d, D, Na);
    expect(deflection(F, k)).toBeCloseTo(F / k, 9);
  });

  it('the solid length is total coils × wire diameter', () => {
    expect(solidLength(0.005, 10)).toBeCloseTo(0.05, 12);
  });
});
