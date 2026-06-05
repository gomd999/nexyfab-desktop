/**
 * radiationView — thermal-radiation view factors and gray-body exchange, verified:
 * the concentric (F12=1, F21=A1/A2) and coaxial-disk factors with reciprocity and the
 * summation rule; the close-disk limit F12→1; and the two-surface exchange reducing
 * to the black-body limit at ε=1 while a gray surface (ε<1) transfers less.
 */
import { describe, it, expect } from 'vitest';
import { concentricViewFactors, coaxialDisksViewFactor, reciprocal, grayBodyExchange, blackBodyExchange } from './radiationView';

describe('radiationView — view factors + gray-body exchange (verified)', () => {
  it('concentric enclosure: F12=1, F21=A1/A2, and the row sums to 1', () => {
    const A1 = 4 * Math.PI * 0.25, A2 = 4 * Math.PI; // spheres r=0.5, 1
    const c = concentricViewFactors(A1, A2);
    expect(c.F12).toBe(1);
    expect(c.F21).toBeCloseTo(A1 / A2, 12);
    expect(c.F21 + c.F22).toBeCloseTo(1, 12);          // summation rule for surface 2
  });

  it('coaxial disks: known factor, reciprocity, and the close-spacing limit', () => {
    const F12 = coaxialDisksViewFactor(0.1, 0.1, 0.1);
    expect(F12).toBeCloseTo(0.382, 3);                 // textbook value
    const A = Math.PI * 0.01;                           // equal disks ⇒ F21 = F12
    expect(reciprocal(A, F12, A)).toBeCloseTo(F12, 12);
    expect(coaxialDisksViewFactor(0.1, 0.1, 0.001)).toBeGreaterThan(0.98); // L → 0 ⇒ F → 1
  });

  it('reciprocity holds for unequal coaxial disks (A1 F12 = A2 F21)', () => {
    const r1 = 0.1, r2 = 0.2, L = 0.15;
    const F12 = coaxialDisksViewFactor(r1, r2, L);
    const F21 = coaxialDisksViewFactor(r2, r1, L);
    const A1 = Math.PI * r1 * r1, A2 = Math.PI * r2 * r2;
    expect(A1 * F12).toBeCloseTo(A2 * F21, 6);
  });

  it('gray-body exchange reduces to the black-body limit at ε=1', () => {
    const A1 = Math.PI, A2 = 4 * Math.PI, T1 = 500, T2 = 300;
    expect(grayBodyExchange(T1, T2, 1, 1, A1, A2, 1)).toBeCloseTo(blackBodyExchange(T1, T2, A1, 1), 6);
  });

  it('a gray surface transfers less than a black one, and respects heat direction', () => {
    const A1 = Math.PI, A2 = 4 * Math.PI, T1 = 500, T2 = 300;
    const black = blackBodyExchange(T1, T2, A1, 1);
    const gray = grayBodyExchange(T1, T2, 0.8, 0.8, A1, A2, 1);
    expect(gray).toBeGreaterThan(0);
    expect(gray).toBeLessThan(black);                  // surface resistance lowers Q
    expect(grayBodyExchange(T2, T1, 0.8, 0.8, A1, A2, 1)).toBeCloseTo(-gray, 6); // hot → cold
  });
});
