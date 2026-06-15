/**
 * responseSpectrum — design-spectrum (earthquake/shock) analysis on the HEX8 modal
 * kernel, verified against the standard response-spectrum identities: the modal
 * base shear equals M_eff·S_a, the effective masses sum to the total mass
 * ("missing-mass" theorem), the first-mode shear matches the known modal-mass
 * fraction, and the response is linear in the spectrum.
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid } from '../analysis/topology3D';
import { hex8ResponseSpectrum, plateauSpectrum, modalCorrelation, cqcCombine } from './responseSpectrum';
import { fixedFaceNodes } from './modalFEM';

const mat = { E: 210000, nu: 0.3, rho: 7.85e-9 };
const Sa0 = 9810; // mm/s² ≈ 1 g
// cantilever thin in Y → the lowest mode bends in Y (≈61% modal mass).
const grid = new TopologyGrid(16, 2, 4);
const fixed = fixedFaceNodes(grid, 'x');
const base = { ...mat, cell: 10, fixed, nModes: 10, direction: 1 as const };
// Each modal solve is costly — compute the flat-spectrum result once and reuse.
const flat = hex8ResponseSpectrum(grid, { ...base, spectrum: () => Sa0 });

describe('responseSpectrum — design-spectrum analysis (verified)', () => {
  it('flat-spectrum base shear equals S_a · Σ M_eff (modal shear = M_eff·S_a)', () => {
    expect(flat.baseShearSum / (Sa0 * flat.capturedMass)).toBeCloseTo(1.0, 6);
  });

  it('effective masses converge to the total mass (missing-mass theorem)', () => {
    expect(flat.capturedMass / flat.totalMass).toBeGreaterThan(0.85); // 10 modes capture most
    expect(flat.capturedMass / flat.totalMass).toBeLessThan(1.02);    // can't exceed total
  });

  it('the first-mode base shear matches the known modal-mass fraction (~0.61)', () => {
    const frac = flat.perMode[0].baseShear / (Sa0 * flat.totalMass);
    expect(frac).toBeGreaterThan(0.55); // Euler–Bernoulli first mode ≈ 0.613
    expect(frac).toBeLessThan(0.70);
    expect(flat.perMode[0].effectiveMass / flat.totalMass).toBeCloseTo(frac, 6); // V₁=M_eff·S_a
  });

  it('is linear in the spectrum (×3 spectrum → ×3 shear and displacement)', () => {
    const r3 = hex8ResponseSpectrum(grid, { ...base, spectrum: () => 3 * Sa0 });
    expect(r3.baseShearSRSS / flat.baseShearSRSS).toBeCloseTo(3, 4);
    const d1 = Math.max(...flat.peakDispByFreeDof), d3 = Math.max(...r3.peakDispByFreeDof);
    expect(d3 / d1).toBeCloseTo(3, 4);
  });

  it('SRSS combination is bounded by the algebraic modal sum', () => {
    const r = hex8ResponseSpectrum(grid, { ...base, spectrum: plateauSpectrum(Sa0, 500) });
    expect(r.baseShearSRSS).toBeGreaterThan(0);
    expect(r.baseShearSRSS).toBeLessThanOrEqual(r.baseShearSum + 1e-9);
  });
});

describe('responseSpectrum — CQC modal combination (closely-spaced-mode correlation)', () => {
  it('correlation ρ_ij = 1 at equal frequencies, → 0 when well separated, symmetric', () => {
    expect(modalCorrelation(100, 100, 0.05)).toBeCloseTo(1, 10);
    expect(modalCorrelation(100, 100000, 0.05)).toBeLessThan(1e-4);
    expect(modalCorrelation(100, 130, 0.05)).toBeCloseTo(modalCorrelation(130, 100, 0.05), 10);
    const r = modalCorrelation(100, 110, 0.05);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1);
  });

  it('CQC reduces to SRSS for well-separated modes', () => {
    // ρ_ij ≈ 0 ⇒ only the diagonal survives ⇒ CQC = SRSS = √(3²+4²) = 5.
    expect(cqcCombine([3, 4], [10, 1000], 0.05)).toBeCloseTo(5, 4);
  });

  it('CQC captures correlation for closely-spaced modes (→ algebraic sum)', () => {
    // ρ_ij ≈ 1 for nearly-equal frequencies ⇒ CQC → |Σ R_i| = 2, far above SRSS √2.
    const cqc = cqcCombine([1, 1], [100, 100.01], 0.05);
    expect(cqc).toBeCloseTo(2, 3);
    expect(cqc).toBeGreaterThan(Math.SQRT2 + 0.1); // strictly above SRSS
  });

  it('CQC → SRSS as damping → 0 (correlation vanishes)', () => {
    const srss = Math.SQRT2; // [1,1]
    const lowZeta = cqcCombine([1, 1], [100, 105], 0.001);
    const highZeta = cqcCombine([1, 1], [100, 105], 0.05);
    expect(lowZeta).toBeCloseTo(srss, 2);     // negligible correlation
    expect(highZeta).toBeGreaterThan(lowZeta); // more damping → more correlation
  });

  it('the FEM base shear: SRSS ≤ CQC ≤ algebraic sum; CQC ≈ SRSS for this well-separated cantilever', () => {
    expect(flat.baseShearCQC).toBeGreaterThanOrEqual(flat.baseShearSRSS - 1e-6);
    expect(flat.baseShearCQC).toBeLessThanOrEqual(flat.baseShearSum + 1e-6);
    // a slender cantilever's modes are well separated ⇒ CQC within a few % of SRSS.
    expect(flat.baseShearCQC / flat.baseShearSRSS).toBeLessThan(1.1);
  });
});
