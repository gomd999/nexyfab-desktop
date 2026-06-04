/**
 * topologyPassive — keep-in / keep-out regions for 3D SIMP (Track G, mfg).
 *
 * Real parts have non-negotiable regions: a bearing seat or mounting boss that
 * MUST be solid, and clearance holes / keep-out envelopes that MUST stay empty.
 * Passive regions pin those elements; the optimiser routes material around them.
 * Verified: keep-out stays exactly void, keep-in stays exactly solid, the volume
 * target is still met, and material is actually placed next to the keep-out (it
 * routes around, not through).
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid, optimizeTopology3D, cantileverBC } from './topology3D';

describe('topologyPassive — keep-in / keep-out regions (Track G)', () => {
  const nx = 20, ny = 10, nz = 4;
  const grid = new TopologyGrid(nx, ny, nz);

  const pVoid: number[] = [];   // a clearance hole through the middle
  const pSolid: number[] = [];  // a mounting boss at the support
  for (let ez = 0; ez < nz; ez++) for (let ey = 3; ey < 7; ey++) for (let ex = 8; ex < 12; ex++) pVoid.push(grid.eIdx(ex, ey, ez));
  for (let ez = 0; ez < nz; ez++) for (let ey = 4; ey < 6; ey++) for (let ex = 0; ex < 2; ex++) pSolid.push(grid.eIdx(ex, ey, ez));

  const res = optimizeTopology3D(
    { nx, ny, nz, volfrac: 0.4, maxIter: 35, passiveVoid: pVoid, passiveSolid: pSolid },
    cantileverBC(grid, -1),
  );

  it('keep-out region is EXACTLY void in the final design', () => {
    for (const e of pVoid) expect(res.density[e]).toBe(0);
  });

  it('keep-in region is EXACTLY solid in the final design', () => {
    for (const e of pSolid) expect(res.density[e]).toBe(1);
  });

  it('still meets the volume target with a finite compliance', () => {
    expect(res.volumeFraction).toBeGreaterThan(0.35);
    expect(res.volumeFraction).toBeLessThan(0.45);
    const c = res.complianceHistory[res.complianceHistory.length - 1];
    expect(Number.isFinite(c)).toBe(true);
    expect(c).toBeGreaterThan(0);
  });

  it('routes material AROUND the keep-out (solid borders the void block)', () => {
    // at least one solid element sits directly adjacent (±Y) to the keep-out band.
    let bordering = 0;
    for (let ez = 0; ez < nz; ez++) for (let ex = 8; ex < 12; ex++) {
      if (res.density[grid.eIdx(ex, 2, ez)] > 0.5) bordering++; // just below the hole
      if (res.density[grid.eIdx(ex, 7, ez)] > 0.5) bordering++; // just above the hole
    }
    expect(bordering).toBeGreaterThan(0);
  });
});
