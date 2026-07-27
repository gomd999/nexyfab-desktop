/**
 * partBucklingFEM — linear buckling on the real TET10 part FEM (Track M / M2).
 *
 * Headless (no WASM). Acceptance: the lowest buckling load factor of a slender
 * fixed-free column under uniform axial compression matches the Euler critical
 * stress σ_cr = π²·E·I / (L_eff²·A), with L_eff = 2L for a cantilever column.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { runPartBuckling, computeBucklingForPanel, BUCKLING_MATERIALS } from './partBucklingFEM';
import { heavyTestBudgetMs } from '@/test/heavyTestBudget';

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

describe('computeBucklingForPanel — panel adapter', () => {
  it('clamps the named face, compresses its axis, and reports a positive λ_cr + stress', () => {
    // Column long axis = X; clamp 'left' (X-min) → loadAxis 0, compress σ_xx.
    const r = computeBucklingForPanel(new THREE.BoxGeometry(200, 10, 10), 'steel', 'left', 2);
    expect(r.loadAxis).toBe(0);
    expect(r.criticalLoadFactor).toBeGreaterThan(0);
    expect(r.refStressMPa).toBe(2);
    // Buckling stress = λ_cr · |ref|.
    expect(r.bucklingStressMPa).toBeCloseTo(r.criticalLoadFactor * 2, 6);
    expect(r.nodeCount).toBeGreaterThan(0);
    expect(r.freeDofCount).toBeGreaterThan(0);
  });

  it('a stiffer material yields a higher critical load factor (steel > ABS)', () => {
    const box = () => new THREE.BoxGeometry(200, 10, 10);
    const steel = computeBucklingForPanel(box(), 'steel', 'left', 1);
    const abs = computeBucklingForPanel(box(), 'abs', 'left', 1);
    expect(steel.criticalLoadFactor).toBeGreaterThan(abs.criticalLoadFactor);
    // λ_cr ∝ E → ratio tracks the modulus ratio within mesh tolerance.
    const eRatio = BUCKLING_MATERIALS.steel!.E / BUCKLING_MATERIALS.abs!.E;
    const lamRatio = steel.criticalLoadFactor / abs.criticalLoadFactor;
    expect(lamRatio).toBeGreaterThan(eRatio * 0.8);
    expect(lamRatio).toBeLessThan(eRatio * 1.2);
    // 260728 §6-4: 두 번의 고정 해석(steel·abs)이라 이 파일에서 가장 무겁다. 같은 파일의
    // 18s 짜리들은 전체 병렬에서 살아남고 이것만 죽었다. 근거=src/test/heavyTestBudget.ts.
  }, heavyTestBudgetMs(37_800)); // 격리 실측 37.8s

  it('falls back to steel/left for unknown material + face keys', () => {
    const r = computeBucklingForPanel(new THREE.BoxGeometry(200, 10, 10), 'nope', 'bogus', 1);
    expect(r.loadAxis).toBe(0); // left → axis 0
    expect(r.criticalLoadFactor).toBeGreaterThan(0);
  });
});
