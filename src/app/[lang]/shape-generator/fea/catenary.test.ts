/**
 * catenary — the uniform cable hanging under its own weight, verified: the vertex
 * (minimum) tension T_min = H = w·a; the catenary identity T(x) = w·y(x); the arc
 * length exceeding the horizontal span; and the shallow-cable reduction to the
 * parabolic sag wL²/(8H).
 */
import { describe, it, expect } from 'vitest';
import { catenaryParam, catenaryHeight, catenarySag, catenaryArcLength, catenaryTension, parabolicSag } from './catenary';

describe('catenary — hanging cable (verified)', () => {
  const H = 1000, w = 10, a = catenaryParam(H, w); // a = 100 m

  it('the tension is minimum at the vertex and equals the horizontal tension H', () => {
    expect(a).toBeCloseTo(100, 12);
    expect(catenaryTension(0, a, w)).toBeCloseTo(H, 9);   // T_min = H = w·a
    expect(catenaryTension(0, a, w)).toBeCloseTo(w * a, 9);
    // tension grows monotonically toward the supports
    expect(catenaryTension(50, a, w)).toBeGreaterThan(catenaryTension(0, a, w));
  });

  it('obeys the catenary identity T(x) = w·y(x)', () => {
    for (const x of [10, 30, 50]) {
      expect(catenaryTension(x, a, w)).toBeCloseTo(w * catenaryHeight(x, a), 9);
    }
  });

  it('the cable arc length exceeds the horizontal span', () => {
    const c = 50;
    const s = catenaryArcLength(c, a);
    expect(s).toBeGreaterThan(c);                          // slack: longer than the chord
    expect(s).toBeCloseTo(a * Math.sinh(c / a), 9);
  });

  it('reduces to the parabolic sag wL²/(8H) in the shallow limit', () => {
    const Hi = 1e5, ai = catenaryParam(Hi, w), L = 10;     // very high tension ⇒ taut/shallow
    expect(catenarySag(L / 2, ai)).toBeCloseTo(parabolicSag(w, L, Hi), 6);
  });
});
