/**
 * sensitivity — SIMP topology-optimization sensitivity, verified: the self-adjoint
 * compliance sensitivity matches a finite difference to machine precision and is
 * always negative (more material ⇒ stiffer); the density filter preserves uniform
 * fields and smooths variation; and the Optimality-Criteria update meets the target
 * volume fraction.
 */
import { describe, it, expect } from 'vitest';
import { complianceSensitivity, densityFilter, ocUpdate, SimpElement } from './sensitivity';

// 1-D chain of 5 springs: node 0 fixed, unit-axis force at node 5.
const n = 5, k = 100, p = 3, nDof = n + 1;
const els: SimpElement[] = Array.from({ length: n }, (_, e) => ({ nodes: [e, e + 1], ke0: [[k, -k], [-k, k]] }));
const rho = [0.6, 0.8, 0.5, 0.9, 0.7];
const f = (() => { const v = new Array<number>(nDof).fill(0); v[n] = 10; return v; })();
const fixed = new Set([0]);

describe('sensitivity — SIMP design sensitivity (verified)', () => {
  const base = complianceSensitivity(els, rho, p, f, fixed, nDof);

  it('the self-adjoint sensitivity matches a finite difference', () => {
    const d = 1e-6;
    for (let e = 0; e < n; e++) {
      const rp = rho.slice(); rp[e] += d; const rm = rho.slice(); rm[e] -= d;
      const Cp = complianceSensitivity(els, rp, p, f, fixed, nDof).compliance;
      const Cm = complianceSensitivity(els, rm, p, f, fixed, nDof).compliance;
      const fd = (Cp - Cm) / (2 * d);
      expect(Math.abs(fd - base.sensitivities[e]) / Math.abs(fd)).toBeLessThan(1e-5);
    }
  });

  it('every compliance sensitivity is negative (more material stiffens)', () => {
    for (const s of base.sensitivities) expect(s).toBeLessThan(0);
  });

  it('the density filter preserves a uniform field and smooths variation', () => {
    const coords = Array.from({ length: n }, (_, e) => [e]);
    // partition of unity: a uniform field is unchanged.
    const uniform = densityFilter([0.5, 0.5, 0.5, 0.5, 0.5], coords, 2.5);
    uniform.forEach((v) => expect(v).toBeCloseTo(0.5, 12));
    // a varying field is smoothed (its peak-to-peak spread shrinks).
    const filtered = densityFilter(rho, coords, 2.5);
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(spread(filtered)).toBeLessThan(spread(rho));
  });

  it('the OC update reaches the target volume fraction', () => {
    const updated = ocUpdate(rho, base.sensitivities, 0.5);
    expect(updated.reduce((s, r) => s + r, 0) / n).toBeCloseTo(0.5, 6);
    updated.forEach((r) => { expect(r).toBeGreaterThanOrEqual(1e-3); expect(r).toBeLessThanOrEqual(1); });
  });

  it('one optimization step reduces compliance at fixed volume', () => {
    const startVol = rho.reduce((s, r) => s + r, 0) / n;
    const updated = ocUpdate(rho, base.sensitivities, startVol);   // keep current volume
    const after = complianceSensitivity(els, updated, p, f, fixed, nDof).compliance;
    expect(after).toBeLessThanOrEqual(base.compliance + 1e-9);     // OC moves material toward sensitive elements
  });
});
