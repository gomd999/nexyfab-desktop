/**
 * laminate — Classical Lamination Theory, verified against the standard CLT results:
 * an isotropic ply is angle-invariant and gives A = E/(1−ν²)·t, D = E t³/(12(1−ν²)),
 * B = 0 with effective Ex = E; a symmetric layup has B = 0 while an unsymmetric one
 * does not; a balanced angle-ply has no extension–shear coupling (A16 = A26 = 0).
 */
import { describe, it, expect } from 'vitest';
import { computeABD, effectiveInPlane, transformedStiffness, Ply } from './laminate';

const deg = (d: number) => (d * Math.PI) / 180;
const iso = (angle: number): Ply => {
  const E = 70000, nu = 0.33;
  return { E1: E, E2: E, G12: E / (2 * (1 + nu)), nu12: nu, thickness: 1, angle };
};
const cfrp = (angle: number): Ply => ({ E1: 140000, E2: 10000, G12: 5000, nu12: 0.3, thickness: 0.125, angle });

describe('laminate — Classical Lamination Theory (verified)', () => {
  it('an isotropic ply is angle-invariant and matches plate stiffness', () => {
    const q0 = transformedStiffness(iso(0)), q30 = transformedStiffness(iso(deg(30)));
    let maxDiff = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) maxDiff = Math.max(maxDiff, Math.abs(q0[i][j] - q30[i][j]));
    expect(maxDiff).toBeLessThan(1e-6);                  // isotropic ⇒ no angle dependence

    const E = 70000, nu = 0.33, t = 1;
    const { A, B, D } = computeABD([iso(0)]);
    expect(A[0][0]).toBeCloseTo((E / (1 - nu * nu)) * t, 2);
    expect(D[0][0]).toBeCloseTo((E * t ** 3) / (12 * (1 - nu * nu)), 4);
    expect(Math.abs(B[0][0])).toBeLessThan(1e-6);        // single ply centred ⇒ B = 0
  });

  it('effective in-plane constants of an isotropic ply recover (E, G, ν)', () => {
    const E = 70000, nu = 0.33, G = E / (2 * (1 + nu));
    const eff = effectiveInPlane([iso(0)]);
    expect(eff.Ex).toBeCloseTo(E, 2);
    expect(eff.Gxy).toBeCloseTo(G, 2);
    expect(eff.nuxy).toBeCloseTo(nu, 4);
  });

  it('a SYMMETRIC layup has zero coupling (B = 0); an unsymmetric one does not', () => {
    const sym = computeABD([cfrp(0), cfrp(deg(90)), cfrp(deg(90)), cfrp(0)]); // [0/90]s
    let maxBsym = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) maxBsym = Math.max(maxBsym, Math.abs(sym.B[i][j]));
    expect(maxBsym).toBeLessThan(1e-6);

    const uns = computeABD([cfrp(0), cfrp(deg(90))]);     // [0/90] unsymmetric
    let maxBuns = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) maxBuns = Math.max(maxBuns, Math.abs(uns.B[i][j]));
    expect(maxBuns).toBeGreaterThan(1);                   // genuine extension–bending coupling
  });

  it('a BALANCED angle-ply [±45]s has no extension–shear coupling (A16=A26=0)', () => {
    const bal = computeABD([cfrp(deg(45)), cfrp(deg(-45)), cfrp(deg(-45)), cfrp(deg(45))]);
    expect(Math.abs(bal.A[0][2])).toBeLessThan(1e-6);
    expect(Math.abs(bal.A[1][2])).toBeLessThan(1e-6);
    expect(bal.A[0][0]).toBeGreaterThan(0);
  });

  it('a unidirectional 0° CFRP ply has effective Ex ≈ E1', () => {
    const eff = effectiveInPlane([cfrp(0)]);
    expect(eff.Ex / 140000).toBeGreaterThan(0.99);
    expect(eff.Ex / 140000).toBeLessThan(1.01);
  });
});
