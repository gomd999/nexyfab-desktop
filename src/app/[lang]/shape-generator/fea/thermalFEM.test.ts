/**
 * thermalFEM — steady-state conduction on the HEX8 kernel, verified against the
 * analytic 1-D conduction solution (replacing the crude "uniform conductance"
 * lumped-node approximation).
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid } from '../analysis/topology3D';
import { hex8Thermal, fixFaceTemp } from './thermalFEM';

describe('thermalFEM — steady-state conduction (verified)', () => {
  it('fixed-temperature bar reproduces the EXACT linear profile', () => {
    const nx = 10, ny = 2, nz = 2, h = 5;
    const grid = new TopologyGrid(nx, ny, nz);
    const fixedTemp = new Map<number, number>();
    fixFaceTemp(grid, 'x', false, 100, fixedTemp); // x=0 → 100 °C
    fixFaceTemp(grid, 'x', true, 0, fixedTemp);     // x=L → 0 °C
    const r = hex8Thermal(grid, { conductivity: 0.05, cell: h, fixedTemp });

    let maxErr = 0;
    for (let ix = 0; ix <= nx; ix++) {
      for (let iy = 0; iy <= ny; iy++) for (let iz = 0; iz <= nz; iz++) {
        const T = r.temperature[grid.node(ix, iy, iz)];
        const analytic = 100 * (1 - ix / nx);     // linear, independent of y,z
        maxErr = Math.max(maxErr, Math.abs(T - analytic));
      }
    }
    expect(maxErr).toBeLessThan(1e-4);             // exact to round-off
    expect(r.maxTemp).toBeCloseTo(100, 3);
    expect(r.minTemp).toBeCloseTo(0, 3);
  });

  it('uniform heat flux obeys the thermal-resistance law ΔT = Q·L/(k·A)', () => {
    const nx = 10, ny = 2, nz = 2, h = 5;
    const grid = new TopologyGrid(nx, ny, nz);
    const k = 0.05;                                // W/(mm·K)
    const L = nx * h, A = (ny * h) * (nz * h);     // 50 mm, 100 mm²
    const Qtotal = 10;                             // W

    const fixedTemp = new Map<number, number>();
    fixFaceTemp(grid, 'x', false, 0, fixedTemp);   // near face held at 0 °C
    // distribute the total power uniformly over the far-face nodes (uniform flux).
    const farNodes: number[] = [];
    for (let iy = 0; iy <= ny; iy++) for (let iz = 0; iz <= nz; iz++) farNodes.push(grid.node(nx, iy, iz));
    const heatSource = new Map<number, number>();
    for (const n of farNodes) heatSource.set(n, Qtotal / farNodes.length);

    const r = hex8Thermal(grid, { conductivity: k, cell: h, fixedTemp, heatSource });
    const expectedRise = (Qtotal * L) / (k * A);   // = 100 K

    // far face is ~uniform and matches the resistance law.
    let farMean = 0;
    for (const n of farNodes) farMean += r.temperature[n];
    farMean /= farNodes.length;
    expect(farMean / expectedRise).toBeGreaterThan(0.95);
    expect(farMean / expectedRise).toBeLessThan(1.05);
  });

  it('temperature is monotonic from hot to cold (no spurious oscillation)', () => {
    const nx = 12, ny = 1, nz = 1, h = 4;
    const grid = new TopologyGrid(nx, ny, nz);
    const fixedTemp = new Map<number, number>();
    fixFaceTemp(grid, 'x', false, 80, fixedTemp);
    fixFaceTemp(grid, 'x', true, 20, fixedTemp);
    const r = hex8Thermal(grid, { conductivity: 0.2, cell: h, fixedTemp });
    let prev = Infinity;
    for (let ix = 0; ix <= nx; ix++) {
      const T = r.temperature[grid.node(ix, 0, 0)];
      expect(T).toBeLessThanOrEqual(prev + 1e-6);
      prev = T;
    }
  });
});
