/**
 * acoustic — 1-D acoustic (Helmholtz) duct modes by FEM, verified against the
 * analytic resonances: a closed–open duct rings at the odd harmonics
 * f_n = (2n−1)c/(4L), while closed–closed and open–open ducts ring at f_n = nc/(2L).
 * The all-closed case (singular stiffness, constant-pressure mode) is handled by a
 * spectral shift. Convergence improves with mesh refinement.
 */
import { describe, it, expect } from 'vitest';
import { ductModes, analyticDuctModes } from './acoustic';

const L = 1, c = 340;

describe('acoustic — Helmholtz duct modes (verified)', () => {
  it('closed–open duct rings at the odd harmonics (2n−1)c/(4L)', () => {
    const fem = ductModes(L, c, 80, 'closed', 'open', 3);
    const an = analyticDuctModes(L, c, 'closed', 'open', 3); // 85, 255, 425
    fem.forEach((f, i) => expect(f / an[i]).toBeCloseTo(1, 2));
    expect(an[0]).toBeCloseTo(c / (4 * L), 6);
  });

  it('closed–closed and open–open ducts ring at nc/(2L)', () => {
    const closed = ductModes(L, c, 80, 'closed', 'closed', 3);
    const open = ductModes(L, c, 80, 'open', 'open', 3);
    const an = analyticDuctModes(L, c, 'closed', 'closed', 3);  // 170, 340, 510
    closed.forEach((f, i) => expect(f / an[i]).toBeCloseTo(1, 2));
    open.forEach((f, i) => expect(f / an[i]).toBeCloseTo(1, 2));
    expect(an[0]).toBeCloseTo(c / (2 * L), 6);
  });

  it('open–closed equals closed–open (symmetric mixed duct)', () => {
    const oc = ductModes(L, c, 80, 'open', 'closed', 2);
    const co = ductModes(L, c, 80, 'closed', 'open', 2);
    oc.forEach((f, i) => expect(f).toBeCloseTo(co[i], 1));
    expect(oc[0] / (c / (4 * L))).toBeCloseTo(1, 2);
  });

  it('converges to the analytic fundamental as the mesh refines', () => {
    const target = c / (4 * L); // 85 Hz, closed–open
    const errs = [20, 80, 200].map((n) => Math.abs(ductModes(L, c, n, 'closed', 'open', 1)[0] - target));
    expect(errs[2]).toBeLessThan(errs[1]);
    expect(errs[1]).toBeLessThan(errs[0]);
    expect(errs[2] / target).toBeLessThan(1e-3); // <0.1% at 200 elements
  });
});
