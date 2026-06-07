/**
 * partModalFEM — natural frequencies on the real TET10 part FEM (Track M / M2).
 *
 * Fully headless (no WASM): the tet mesher + dense eigensolver are pure JS.
 *
 * Acceptance:
 *  - HRZ-lumped TET10 mass fractions conserve element mass (and are positive —
 *    the trap that naive row-sum lumping falls into).
 *  - The first AXIAL mode of a fixed-free bar matches the analytic longitudinal
 *    frequency f = c/(4L), c = √(E/ρ), within a few %. (Bending modes are lower
 *    for a slender bar, so the axial mode is picked by its X-dominant shape.)
 *  - Frequency scaling laws: f ∝ √E.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { runPartModal, TET10_CORNER_MASS_FRAC, TET10_MIDSIDE_MASS_FRAC } from './partModalFEM';

// Steel in consistent N-mm-MPa-s units.
const STEEL = { E: 210_000, nu: 0.3, density: 7.85e-9 };

/** Non-indexed box (generateTetMesh consumes a flat triangle soup). */
function bar(lengthX: number, w: number, h: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(lengthX, w, h).toNonIndexed();
}

describe('partModalFEM — TET10 part modal', () => {
  it('HRZ-lumped TET10 mass fractions are positive and conserve element mass', () => {
    // 4 corners + 6 midsides must sum to exactly one element mass (ρV factor = 1).
    const total = 4 * TET10_CORNER_MASS_FRAC + 6 * TET10_MIDSIDE_MASS_FRAC;
    expect(total).toBeCloseTo(1, 12);
    expect(TET10_CORNER_MASS_FRAC).toBeGreaterThan(0);
    expect(TET10_MIDSIDE_MASS_FRAC).toBeGreaterThan(0);
    // Midside nodes carry more mass than corners (quadratic element), 16:3.
    expect(TET10_MIDSIDE_MASS_FRAC / TET10_CORNER_MASS_FRAC).toBeCloseTo(16 / 3, 6);
  });

  // Pure-axial idealization (constrainTransverse): only the X direction is free,
  // so the fundamental is the longitudinal mode f = c/(4L) and the dense
  // eigensolver stays small/fast. This validates the TET10 axial stiffness + the
  // HRZ mass matrix (the core M2 physics).
  it('first axial mode of a fixed-free bar ≈ c/(4L)', () => {
    const L = 100; // mm, along X
    // ν=0 so the transverse constraint adds no Poisson stiffening (uniaxial
    // strain = uniaxial stress), keeping the analytic f = c/(4L), c=√(E/ρ) exact.
    const res = runPartModal(bar(L, 12, 12), {
      ...STEEL, nu: 0, modeCount: 3, maxNodes: 600, fixedAxis: 0, fixedSide: 'min', constrainTransverse: true,
    });

    // All frequencies finite, positive, ascending.
    expect(res.frequenciesHz.length).toBe(3);
    for (const f of res.frequenciesHz) expect(f).toBeGreaterThan(0);
    for (let i = 1; i < res.frequenciesHz.length; i++) {
      expect(res.frequenciesHz[i]).toBeGreaterThanOrEqual(res.frequenciesHz[i - 1]! - 1e-6);
    }

    // Analytic longitudinal fundamental of a fixed-free bar.
    const c = Math.sqrt(STEEL.E / STEEL.density); // mm/s
    const fAxial = c / (4 * L);                   // Hz

    // Transverse-constrained ⇒ the fundamental IS the axial mode.
    const axial = res.modes[0]!;
    expect(axial.dominantDir).toBe(0);
    const err = Math.abs(axial.frequencyHz - fAxial) / fAxial;
    expect(err).toBeLessThan(0.06); // within 6% on a coarse TET10 mesh
  });

  it('full-3D first bending mode of a cantilever ≈ Euler-Bernoulli analytic', () => {
    // Slender beam: L along X, thin in Z (h=8 < b=20) so the lowest mode is
    // bending that deflects in Z (about the Y axis), unambiguously the fundamental.
    const L = 120, b = 20, h = 8;
    const res = runPartModal(new THREE.BoxGeometry(L, b, h).toNonIndexed(), {
      ...STEEL, modeCount: 4, maxNodes: 4000, fixedAxis: 0, fixedSide: 'min',
    });

    // Euler-Bernoulli cantilever first bending: f1 = (β1²/2π)·√(EI/(ρ A L⁴)).
    const beta1sq = 1.875104 ** 2;
    const I = (b * h ** 3) / 12; // bending in Z → second moment about Y
    const A = b * h;
    const f1 = (beta1sq / (2 * Math.PI)) * Math.sqrt((STEEL.E * I) / (STEEL.density * A * L ** 4));

    // Lowest mode should be the Z-deflection bending mode.
    const bending = res.modes[0]!;
    expect(bending.dominantDir).toBe(2);
    const err = Math.abs(bending.frequencyHz - f1) / f1;
    expect(err).toBeLessThan(0.15); // coarse TET10 + lumped mass; finer mesh tightens
  });

  it('first axial mode effective mass ≈ 8/π² of the total (participation)', () => {
    const L = 100;
    const res = runPartModal(bar(L, 12, 12), {
      ...STEEL, nu: 0, modeCount: 2, maxNodes: 600, fixedAxis: 0, fixedSide: 'min', constrainTransverse: true,
    });
    // Classic result: the fundamental longitudinal mode of a fixed-free bar
    // carries 8/π² ≈ 0.811 of the total mass in the axial direction.
    const frac = res.modes[0]!.effectiveMass[0] / res.totalMass[0];
    expect(frac).toBeGreaterThan(0.77);
    expect(frac).toBeLessThan(0.85);
  });

  it('axial frequency scales as √E (E×4 → f×2)', () => {
    const L = 100;
    const opts = {
      ...STEEL, modeCount: 1, maxNodes: 600,
      fixedAxis: 0 as const, fixedSide: 'min' as const, constrainTransverse: true,
    };
    const base = runPartModal(bar(L, 12, 12), opts);
    const stiff = runPartModal(bar(L, 12, 12), { ...opts, E: STEEL.E * 4 });

    const ratio = stiff.modes[0]!.frequencyHz / base.modes[0]!.frequencyHz;
    expect(ratio).toBeGreaterThan(1.95);
    expect(ratio).toBeLessThan(2.05);
  });
});
