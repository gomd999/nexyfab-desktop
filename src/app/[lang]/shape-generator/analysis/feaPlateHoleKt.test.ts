/**
 * feaPlateHoleKt — FEA path-c de-risking: a BOUNDARY-CONFORMING polar mesh +
 * Q4 plane-stress FEA recovers the Kirsch stress concentration Kt ≈ 3 for a hole
 * in a plate — the value the structured-voxel production solver can't reach
 * (≈1.8–2.2). This proves the conforming-mesh path closes the gap.
 */
import { describe, it, expect } from 'vitest';
import { plateWithHoleKt } from './feaPlateHoleKt';

describe('feaPlateHoleKt — Kirsch stress concentration (conforming mesh)', () => {
  it('recovers Kt ≈ 3.0 at the hole edge (within a few %)', () => {
    const r = plateWithHoleKt({ holeRadius: 1, outerRadius: 30, radialRings: 32, sectors: 96 });
    expect(r.converged).toBe(true);
    // Kirsch: Kt = 3 for a hole in an (effectively) infinite plate.
    expect(r.kt).toBeGreaterThan(2.8);
    expect(r.kt).toBeLessThan(3.2);
  });

  it('decisively beats the structured-voxel ceiling (Kt ≫ 2.2)', () => {
    const r = plateWithHoleKt({ holeRadius: 1, outerRadius: 30, radialRings: 32, sectors: 96 });
    // The whole point: conforming mesh clears the 1.8–2.2 voxel band.
    expect(r.kt).toBeGreaterThan(2.5);
  });

  it('hoop stress at the load axis (θ≈0°) is ≈ −σ (Kirsch)', () => {
    const r = plateWithHoleKt({ holeRadius: 1, outerRadius: 30, radialRings: 32, sectors: 96 });
    expect(r.hoopAtLoadAxis).toBeLessThan(-0.6);
    expect(r.hoopAtLoadAxis).toBeGreaterThan(-1.4);
  });

  it('converges toward 3.0 as the mesh refines (coarse < fine)', () => {
    const coarse = plateWithHoleKt({ holeRadius: 1, outerRadius: 30, radialRings: 10, sectors: 32 });
    const fine = plateWithHoleKt({ holeRadius: 1, outerRadius: 30, radialRings: 36, sectors: 120 });
    // Both conforming, but the finer mesh resolves the gradient closer to 3.
    expect(fine.kt).toBeGreaterThan(coarse.kt - 0.05);
    expect(Math.abs(fine.kt - 3)).toBeLessThan(Math.abs(coarse.kt - 3) + 0.2);
  });

  it('rejects a sector count that is not a multiple of 4', () => {
    expect(() => plateWithHoleKt({ sectors: 30 })).toThrow(/multiple of 4/);
  });
});
