/**
 * topology3D — verifies the true 3D SIMP optimiser (Track G / G1) on the standard
 * 3D cantilever: a block fixed at one end with a transverse tip load. Correct
 * behaviour (the "known optimal topology" acceptance, made into concrete checks):
 *   - compliance DECREASES — the design gets stiffer for the same volume;
 *   - the volume constraint is met;
 *   - material SEPARATES into solid/void (it is not the uniform start);
 *   - material concentrates near the fixed support (high stress) and thins out in
 *     a low-stress region — a real load path, not noise.
 */
import { describe, it, expect } from 'vitest';
import { optimizeTopology3D, cantileverBC, TopologyGrid } from './topology3D';

describe('topology3D — 3D SIMP cantilever (Track G)', () => {
  const nx = 16, ny = 8, nz = 4;
  const grid = new TopologyGrid(nx, ny, nz);
  const res = optimizeTopology3D(
    { nx, ny, nz, volfrac: 0.4, penal: 3, rmin: 1.5, maxIter: 30 },
    cantileverBC(grid, -1),
  );
  const dens = res.density;
  const eIdx = (ex: number, ey: number, ez: number) => (ez * ny + ey) * nx + ex;

  it('drives compliance down (a stiffer structure for the same material)', () => {
    const hist = res.complianceHistory;
    expect(hist.length).toBeGreaterThan(3);
    // every value is a real positive number
    for (const c of hist) { expect(Number.isFinite(c)).toBe(true); expect(c).toBeGreaterThan(0); }
    // final compliance is well below the uniform-start compliance
    expect(hist[hist.length - 1]).toBeLessThan(hist[0] * 0.85);
  });

  it('meets the volume constraint', () => {
    expect(res.volumeFraction).toBeGreaterThan(0.37);
    expect(res.volumeFraction).toBeLessThan(0.43);
  });

  it('produces a discrete-ish design (material separated into solid + void)', () => {
    let solid = 0, voidc = 0;
    for (let e = 0; e < dens.length; e++) { if (dens[e] > 0.7) solid++; else if (dens[e] < 0.3) voidc++; }
    // a meaningful fraction is clearly solid AND clearly void (not all grey/uniform)
    expect(solid).toBeGreaterThan(dens.length * 0.15);
    expect(voidc).toBeGreaterThan(dens.length * 0.25);
  });

  it('concentrates material on the load path: denser at the fixed support than at a low-stress corner', () => {
    // mean density in the support column (ex=0) vs a free-end mid-height region.
    let supSum = 0, supN = 0, freeSum = 0, freeN = 0;
    for (let ey = 0; ey < ny; ey++) for (let ez = 0; ez < nz; ez++) {
      supSum += dens[eIdx(0, ey, ez)]; supN++;
      freeSum += dens[eIdx(nx - 1, Math.floor(ny / 2), ez)]; freeN++;
    }
    const supMean = supSum / supN;
    const freeMean = freeSum / freeN;
    expect(supMean).toBeGreaterThan(freeMean);
  });
});
