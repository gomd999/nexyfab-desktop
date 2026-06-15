/**
 * sectionProperties — cross-section geometry, verified: the rectangle bh³/12 and
 * circle πd⁴/64 inertias; the parallel-axis theorem I_c+Ad²; a composite T-section's
 * centroid and moment of inertia (vs hand calculation); and the section modulus and
 * radius of gyration (h/√12 for a rectangle).
 */
import { describe, it, expect } from 'vitest';
import { rectangle, circle, parallelAxis, compositeCentroid, compositeInertia, sectionModulus, radiusOfGyration } from './sectionProperties';

describe('sectionProperties — section geometry (verified)', () => {
  it('rectangle and circle inertias match the standard formulas', () => {
    const r = rectangle(0.1, 0.2);
    expect(r.A).toBeCloseTo(0.02, 12);
    expect(r.I).toBeCloseTo((0.1 * 0.2 ** 3) / 12, 12);
    const c = circle(0.05);
    expect(c.A).toBeCloseTo((Math.PI * 0.05 ** 2) / 4, 12);
    expect(c.I).toBeCloseTo((Math.PI * 0.05 ** 4) / 64, 15);
  });

  it('the parallel-axis theorem is I = I_c + A·d²', () => {
    const r = rectangle(0.1, 0.2);
    expect(parallelAxis(r.I, r.A, 0.1)).toBeCloseTo(r.I + r.A * 0.01, 12);
    expect(parallelAxis(r.I, r.A, 0)).toBeCloseTo(r.I, 12); // no offset ⇒ unchanged
  });

  it('a composite T-section centroid and inertia match a hand calculation', () => {
    const flange = { ...rectangle(0.1, 0.02), y: 0.11 };
    const web = { ...rectangle(0.02, 0.1), y: 0.05 };
    expect(compositeCentroid([flange, web])).toBeCloseTo(0.08, 6);
    expect(compositeInertia([flange, web])).toBeCloseTo(5.3333e-6, 9);
    // a built-up section is stiffer than either part alone about the composite axis.
    expect(compositeInertia([flange, web])).toBeGreaterThan(flange.I);
  });

  it('section modulus S=I/c and radius of gyration r=√(I/A)', () => {
    const r = rectangle(0.1, 0.2);
    expect(sectionModulus(r.I, 0.1)).toBeCloseTo(r.I / 0.1, 12);
    expect(radiusOfGyration(r.I, r.A)).toBeCloseTo(0.2 / Math.sqrt(12), 9); // h/√12
  });

  it('moving material away from the axis raises the inertia (d² term)', () => {
    const A = rectangle(0.1, 0.02);
    expect(parallelAxis(A.I, A.A, 0.2)).toBeGreaterThan(parallelAxis(A.I, A.A, 0.1)); // farther ⇒ stiffer
  });
});
