/**
 * responseSpectrum — design-spectrum (earthquake/shock) analysis on the HEX8 modal
 * kernel, verified against the standard response-spectrum identities: the modal
 * base shear equals M_eff·S_a, the effective masses sum to the total mass
 * ("missing-mass" theorem), the first-mode shear matches the known modal-mass
 * fraction, and the response is linear in the spectrum.
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid } from '../analysis/topology3D';
import { hex8ResponseSpectrum, plateauSpectrum } from './responseSpectrum';
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
