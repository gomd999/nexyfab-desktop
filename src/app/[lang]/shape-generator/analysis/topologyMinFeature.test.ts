/**
 * topologyMinFeature — minimum-feature-size control for 3D SIMP (Track G, mfg).
 *
 * A plain optimiser leaves grey, checkerboard-thin members that no tool/nozzle
 * can make. Density filtering (radius = the length scale) + Heaviside projection
 * (with β-continuation) drives the design black-and-white with NO member thinner
 * than the radius. Verified: projection makes the design far more discrete, and a
 * larger filter radius yields a larger minimum feature — the manufacturable length
 * scale is a knob.
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid, optimizeTopology3D, cantileverBC } from './topology3D';

const grayFraction = (d: Float32Array): number => {
  let g = 0; for (const v of d) if (v > 0.05 && v < 0.95) g++; return g / d.length;
};
/** Smallest run of consecutive solid elements along X, over all (y,z) lines. */
function minSolidRun(d: Float32Array, grid: TopologyGrid): number {
  let mn = Infinity;
  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) {
    let run = 0;
    for (let ex = 0; ex < grid.nx; ex++) {
      const solid = d[(ez * grid.ny + ey) * grid.nx + ex] > 0.5;
      if (solid) run++; else { if (run > 0) mn = Math.min(mn, run); run = 0; }
    }
    if (run > 0) mn = Math.min(mn, run);
  }
  return mn === Infinity ? 0 : mn;
}

describe('topologyMinFeature — projection + length scale (Track G)', () => {
  const nx = 24, ny = 12, nz = 4;
  const grid = new TopologyGrid(nx, ny, nz);
  const base = optimizeTopology3D({ nx, ny, nz, volfrac: 0.4, maxIter: 40 }, cantileverBC(grid, -1));
  const projR15 = optimizeTopology3D({ nx, ny, nz, volfrac: 0.4, maxIter: 40, rmin: 1.5, projection: { beta: 16 } }, cantileverBC(grid, -1));
  const projR30 = optimizeTopology3D({ nx, ny, nz, volfrac: 0.4, maxIter: 40, rmin: 3.0, projection: { beta: 16 } }, cantileverBC(grid, -1));

  it('projection makes the design far more DISCRETE (manufacturable black-and-white)', () => {
    expect(grayFraction(base.density)).toBeGreaterThan(0.25);   // plain SIMP is grey
    expect(grayFraction(projR15.density)).toBeLessThan(0.15);   // projected is near 0/1
    expect(grayFraction(projR15.density)).toBeLessThan(grayFraction(base.density) * 0.5);
  });

  it('a larger filter radius yields a LARGER minimum feature (length-scale knob)', () => {
    expect(minSolidRun(projR30.density, grid)).toBeGreaterThan(minSolidRun(projR15.density, grid));
  });

  it('still solves a valid structure: finite densities, near-target volume, finite compliance', () => {
    for (const r of [projR15, projR30]) {
      expect(r.density.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
      expect(r.volumeFraction).toBeGreaterThan(0.3);
      expect(r.volumeFraction).toBeLessThan(0.55); // some drift: OC holds DESIGN volume
      const c = r.complianceHistory[r.complianceHistory.length - 1];
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThan(0);
    }
  });
});
