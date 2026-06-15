/**
 * topologyOverhang — additive-manufacturing constraint for 3D SIMP (Track G, mfg).
 *
 * A topology-optimised part is full of overhangs that can't 3D-print without
 * support structures. The overhang filter constrains the design so every solid
 * element is supported from the build plate within a ~45° cone — the result
 * prints support-free. Verified: the filter only removes material and provably
 * suppresses floating overhangs; the constrained optimiser yields a GUARANTEED
 * support-free design, at the expected stiffness cost (printable ⇒ less optimal).
 */
import { describe, it, expect } from 'vitest';
import {
  TopologyGrid, optimizeTopology3D, cantileverBC, amOverhangFilter, countUnsupportedOverhang,
} from './topology3D';

describe('topologyOverhang — AM build-direction constraint (Track G)', () => {
  it('the filter only removes material (printable ≤ design everywhere)', () => {
    const grid = new TopologyGrid(6, 6, 4);
    const d = new Float32Array(grid.nElems).map((_, i) => ((i * 2654435761) % 1000) / 1000); // pseudo-random
    const f = amOverhangFilter(d, grid, 'Y');
    for (let e = 0; e < d.length; e++) expect(f[e]).toBeLessThanOrEqual(d[e] + 1e-6);
  });

  it('suppresses a FLOATING block (solid above, nothing below)', () => {
    const grid = new TopologyGrid(6, 6, 2);
    const d = new Float32Array(grid.nElems);
    for (let ez = 0; ez < 2; ez++) for (let ey = 3; ey < 6; ey++) for (let ex = 2; ex < 5; ex++) {
      d[(ez * 6 + ey) * 6 + ex] = 1; // floating block in the upper Y layers
    }
    expect(countUnsupportedOverhang(d, grid, 'Y')).toBeGreaterThan(0);
    const f = amOverhangFilter(d, grid, 'Y');
    // the floating material is driven toward void.
    let maxInBlock = 0;
    for (let ez = 0; ez < 2; ez++) for (let ey = 3; ey < 6; ey++) for (let ex = 2; ex < 5; ex++) {
      maxInBlock = Math.max(maxInBlock, f[(ez * 6 + ey) * 6 + ex]);
    }
    expect(maxInBlock).toBeLessThan(0.2);
  });

  it('the HARD projection guarantees a support-free field', () => {
    const grid = new TopologyGrid(8, 8, 3);
    const d = new Float32Array(grid.nElems).map((_, i) => ((i * 40503) % 100) / 100);
    const hard = amOverhangFilter(d, grid, 'Y', 50, true);
    expect(countUnsupportedOverhang(hard, grid, 'Y')).toBe(0);
  });

  it('the constrained optimiser yields a support-free design at a stiffness cost', () => {
    const nx = 16, ny = 8, nz = 4;
    const grid = new TopologyGrid(nx, ny, nz);
    const base = optimizeTopology3D({ nx, ny, nz, volfrac: 0.4, maxIter: 30 }, cantileverBC(grid, -1));
    const am = optimizeTopology3D({ nx, ny, nz, volfrac: 0.4, maxIter: 30, overhang: 'Y' }, cantileverBC(grid, -1));

    // the unconstrained optimum has overhangs; the AM design has NONE.
    expect(countUnsupportedOverhang(base.density, grid, 'Y')).toBeGreaterThan(0);
    expect(countUnsupportedOverhang(am.density, grid, 'Y')).toBe(0);
    // printability costs stiffness: the constrained compliance is higher.
    const baseC = base.complianceHistory[base.complianceHistory.length - 1];
    const amC = am.complianceHistory[am.complianceHistory.length - 1];
    expect(amC).toBeGreaterThan(baseC);
  });
});
