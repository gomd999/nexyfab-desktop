/**
 * thermoElastic — coupled thermo-mechanical analysis, verified against the analytic
 * thermal-stress limits: free expansion (zero stress, u = α·ΔT·x), full axial
 * restraint (σ = −E·α·ΔT), and the conduction→structural coupling (a linear
 * temperature field from hex8Thermal is stress-free up to the trilinear
 * discretization).
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid } from '../analysis/topology3D';
import { hex8ThermoElastic } from './thermoElastic';
import { hex8Thermal, fixFaceTemp } from './thermalFEM';

const E = 210000, nu = 0.3, alpha = 1.2e-5;
const nx = 4, ny = 2, nz = 2, h = 10;
const grid = new TopologyGrid(nx, ny, nz);
const L = nx * h;

/** Symmetry-plane supports (x=0,y=0,z=0): correct for a uniform-expansion field. */
function symmetryBC(): Map<number, number> {
  const m = new Map<number, number>();
  for (let iy = 0; iy <= ny; iy++) for (let iz = 0; iz <= nz; iz++) m.set(grid.node(0, iy, iz) * 3 + 0, 0);
  for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) m.set(grid.node(ix, 0, iz) * 3 + 1, 0);
  for (let ix = 0; ix <= nx; ix++) for (let iy = 0; iy <= ny; iy++) m.set(grid.node(ix, iy, 0) * 3 + 2, 0);
  return m;
}

describe('thermoElastic — coupled thermal stress (verified)', () => {
  it('free uniform expansion: zero stress, end displacement = α·ΔT·L', () => {
    const dT = 100;
    const r = hex8ThermoElastic(grid, { E, nu, cell: h, alpha, deltaT: dT, fixed: symmetryBC() });
    expect(r.displacement[grid.node(nx, 1, 1) * 3 + 0]).toBeCloseTo(alpha * dT * L, 6);
    expect(r.maxVonMises).toBeLessThan(1e-6);             // unconstrained ⇒ stress-free
  });

  it('fully axially restrained bar develops σ = −E·α·ΔT (compression)', () => {
    const dT = 100;
    const fixed = symmetryBC();
    for (let iy = 0; iy <= ny; iy++) for (let iz = 0; iz <= nz; iz++) fixed.set(grid.node(nx, iy, iz) * 3 + 0, 0); // also clamp x=L
    const r = hex8ThermoElastic(grid, { E, nu, cell: h, alpha, deltaT: dT, fixed });
    const sig = r.elementStress[0];
    expect(sig[0]).toBeCloseTo(-E * alpha * dT, 1);       // uniaxial thermal stress
    expect(sig[0]).toBeLessThan(0);                        // heating + restraint ⇒ compression
    expect(Math.abs(sig[1])).toBeLessThan(1);              // σyy ≈ 0 (free to expand laterally)
  });

  it('couples to the conduction solver: a linear T field is ~stress-free', () => {
    // 3-2-1 statically-determinate supports so the body can take the stress-free shape.
    const A = grid.node(0, 0, 0), B = grid.node(nx, 0, 0), C = grid.node(0, ny, 0);
    const fixed = new Map<number, number>([
      [A * 3 + 0, 0], [A * 3 + 1, 0], [A * 3 + 2, 0], [B * 3 + 1, 0], [B * 3 + 2, 0], [C * 3 + 2, 0],
    ]);
    const ft = new Map<number, number>();
    fixFaceTemp(grid, 'x', false, 100, ft); fixFaceTemp(grid, 'x', true, 0, ft);
    const th = hex8Thermal(grid, { conductivity: 0.05, cell: h, fixedTemp: ft }); // linear 100→0
    const r = hex8ThermoElastic(grid, { E, nu, cell: h, alpha, deltaT: th.temperature, fixed });
    // end displacement = α·T_avg·L (T_avg = 50).
    expect(r.displacement[B * 3 + 0]).toBeCloseTo(alpha * 50 * L, 5);
    // linear T is theoretically stress-free; the trilinear element leaves only a
    // small residual (the exact stress-free field is quadratic), ≪ the restrained stress.
    expect(r.maxVonMises).toBeLessThan(0.02 * E * alpha * 100);
  });
});
