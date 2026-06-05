/**
 * thermalConvection — conduction with surface convection (Robin) and radiation,
 * verified against the analytic 1-D balances: the convective end temperature
 * T_L = (k·T0 + h·L·T∞)/(k + h·L) with its insulated (h→0) and Dirichlet (h→∞)
 * limits, and the nonlinear radiation energy balance k(T0−T_L)/L = εσ(T_L⁴−T∞⁴).
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid } from '../analysis/topology3D';
import { hex8ThermalConvection, SIGMA_SB } from './thermalConvection';

const nx = 10, ny = 2, nz = 2, cell = 5, k = 0.05;
const L = nx * cell;
const grid = new TopologyGrid(nx, ny, nz);
function fixRoot(T: number): Map<number, number> {
  const m = new Map<number, number>();
  for (let iy = 0; iy <= ny; iy++) for (let iz = 0; iz <= nz; iz++) m.set(grid.node(0, iy, iz), T);
  return m;
}
const endNode = grid.node(nx, 1, 1);

describe('thermalConvection — convection + radiation BCs (verified)', () => {
  it('convective end temperature matches T_L = (k·T0 + h·L·T∞)/(k + h·L)', () => {
    const T0 = 100, h = 0.001, Tinf = 0;
    const r = hex8ThermalConvection(grid, { conductivity: k, cell, fixedTemp: fixRoot(T0), convection: [{ axis: 'x', atMax: true, h, Tinf }] });
    const analytic = (k * T0 + h * L * Tinf) / (k + h * L);  // = 50
    expect(r.temperature[endNode]).toBeCloseTo(analytic, 2);
  });

  it('reproduces the insulated (h→0) and perfect-sink (h→∞) limits', () => {
    const T0 = 100;
    const insulated = hex8ThermalConvection(grid, { conductivity: k, cell, fixedTemp: fixRoot(T0), convection: [{ axis: 'x', atMax: true, h: 1e-6, Tinf: 0 }] });
    expect(insulated.temperature[endNode]).toBeGreaterThan(99.5);   // ≈ uniform T0
    const sink = hex8ThermalConvection(grid, { conductivity: k, cell, fixedTemp: fixRoot(T0), convection: [{ axis: 'x', atMax: true, h: 1e3, Tinf: 0 }] });
    expect(sink.temperature[endNode]).toBeLessThan(0.5);            // ≈ Dirichlet T∞
  });

  it('keeps a linear interior profile (no internal generation)', () => {
    const T0 = 100, h = 0.001;
    const r = hex8ThermalConvection(grid, { conductivity: k, cell, fixedTemp: fixRoot(T0), convection: [{ axis: 'x', atMax: true, h, Tinf: 0 }] });
    const TL = r.temperature[endNode];
    let maxErr = 0;
    for (let ix = 0; ix <= nx; ix++) {
      const T = r.temperature[grid.node(ix, 1, 1)];
      maxErr = Math.max(maxErr, Math.abs(T - (T0 + (TL - T0) * (ix / nx))));
    }
    expect(maxErr).toBeLessThan(1e-3);
  });

  it('radiation satisfies the nonlinear energy balance k(T0−T_L)/L = εσ(T_L⁴−T∞⁴)', () => {
    const T0 = 1000, Tinf = 300, eps = 0.8;  // absolute K
    const r = hex8ThermalConvection(grid, {
      conductivity: k, cell, fixedTemp: fixRoot(T0),
      radiation: [{ axis: 'x', atMax: true, emissivity: eps, Tinf }], initialTemp: 800,
    });
    const TL = r.temperature[endNode];
    // analytic root of the 1-D balance.
    let lo = Tinf, hi = T0;
    for (let i = 0; i < 80; i++) {
      const m = (lo + hi) / 2;
      const f = k * (T0 - m) / L - eps * SIGMA_SB * (m ** 4 - Tinf ** 4);
      if (f > 0) lo = m; else hi = m;
    }
    const analyticTL = (lo + hi) / 2;
    expect(TL).toBeCloseTo(analyticTL, 0);                          // within ~1 K
    // residual of the nonlinear balance at the FEM solution.
    const cond = k * (T0 - TL) / L, rad = eps * SIGMA_SB * (TL ** 4 - Tinf ** 4);
    expect(Math.abs(cond - rad) / rad).toBeLessThan(0.02);
    expect(r.iterations).toBeGreaterThan(1);                        // Picard actually iterated
  });
});
