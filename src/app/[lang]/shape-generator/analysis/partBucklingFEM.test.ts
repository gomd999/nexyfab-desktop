/**
 * partBucklingFEM — linear buckling on the real TET10 part FEM (Track M / M2).
 *
 * Headless (no WASM). Acceptance: the lowest buckling load factor of a slender
 * fixed-free column under uniform axial compression matches the Euler critical
 * stress σ_cr = π²·E·I / (L_eff²·A), with L_eff = 2L for a cantilever column.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { runPartBuckling } from './partBucklingFEM';

const STEEL = { E: 210_000, nu: 0.3 };

describe('partBucklingFEM — TET10 part buckling', () => {
  it('cantilever column critical stress ≈ Euler π²EI/(4L²A)', () => {
    // Slender square column: length L along X, b×b cross-section. Fixed at X-min,
    // free at X-max. Uniform reference compression σ_xx = −1 MPa ⇒ λ_cr = σ_cr.
    const L = 200, b = 10;
    const res = runPartBuckling(new THREE.BoxGeometry(L, b, b).toNonIndexed(), {
      ...STEEL, prestress: { xx: -1, yy: 0, zz: 0 }, maxNodes: 1000, fixedAxis: 0, fixedSide: 'min', iters: 120,
    });

    // Euler cantilever (fixed-free): L_eff = 2L.
    const I = (b ** 4) / 12;
    const A = b * b;
    const sigmaCr = (Math.PI ** 2 * STEEL.E * I) / ((2 * L) ** 2 * A); // = π²E b²/(48 L²)

    expect(res.criticalLoadFactor).toBeGreaterThan(0);
    const err = Math.abs(res.criticalLoadFactor - sigmaCr) / sigmaCr;
    expect(err).toBeLessThan(0.2); // coarse TET10 (1 elem across); finer mesh tightens
  });

  it('critical load factor scales with E (E×2 → λ_cr×2)', () => {
    const L = 200, b = 10;
    const opts = {
      ...STEEL, prestress: { xx: -1, yy: 0, zz: 0 },
      maxNodes: 500, fixedAxis: 0 as const, fixedSide: 'min' as const, iters: 100,
    };
    const base = runPartBuckling(new THREE.BoxGeometry(L, b, b).toNonIndexed(), opts);
    const stiff = runPartBuckling(new THREE.BoxGeometry(L, b, b).toNonIndexed(), { ...opts, E: STEEL.E * 2 });
    const ratio = stiff.criticalLoadFactor / base.criticalLoadFactor;
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
  });
});
