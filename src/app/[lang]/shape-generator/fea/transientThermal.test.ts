/**
 * transientThermal — time-dependent heat conduction on the HEX8 kernel, verified
 * against the analytic transient solution: lumped heating (capacity + integrator),
 * modal decay rate α(π/L)² (capacity↔conductance coupling), and the steady-state
 * limit (backward Euler converges to the exact steady profile).
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid } from '../analysis/topology3D';
import { hex8TransientThermal } from './transientThermal';

const k = 0.05, rhoC = 0.0035; // steel-ish: α = k/ρc ≈ 14.3 mm²/s

describe('transientThermal — time-dependent conduction (verified)', () => {
  it('insulated body + uniform source rises linearly: dT/dt = Q/C', () => {
    const grid = new TopologyGrid(1, 1, 1);
    const h = 5, Q = 2;
    const heatSource = new Map<number, number>();
    for (let n = 0; n < 8; n++) heatSource.set(n, Q);   // every node of the single element
    const r = hex8TransientThermal(grid, {
      conductivity: k, volHeatCapacity: rhoC, cell: h, fixedTemp: new Map(), heatSource,
      initialTemp: 20, dt: 1, steps: 10, probeNodes: [0, 7],
    });
    const C = (rhoC * h ** 3) / 8;                       // lumped nodal capacity
    const expected = 20 + (Q / C) * 10;
    expect(r.probe[0][10]).toBeCloseTo(expected, 4);     // exact linear rise
    expect(Math.abs(r.probe[0][10] - r.probe[1][10])).toBeLessThan(1e-6); // stays uniform
  });

  it('a bar cooling with fixed ends decays at the analytic rate α(π/L)²', () => {
    const nx = 10, h = 5;
    const grid = new TopologyGrid(nx, 1, 1);
    const fixedTemp = new Map<number, number>();
    for (let iy = 0; iy <= 1; iy++) for (let iz = 0; iz <= 1; iz++) {
      fixedTemp.set(grid.node(0, iy, iz), 0); fixedTemp.set(grid.node(nx, iy, iz), 0);
    }
    const mid = grid.node(nx / 2, 0, 0);
    const r = hex8TransientThermal(grid, {
      conductivity: k, volHeatCapacity: rhoC, cell: h, fixedTemp, initialTemp: 100,
      dt: 0.5, steps: 160, probeNodes: [mid],
    });
    const L = nx * h, alpha = k / rhoC;
    const analyticRate = alpha * (Math.PI / L) ** 2;
    const i1 = r.times.indexOf(40), i2 = r.times.indexOf(70);  // late: higher modes gone
    const femRate = -Math.log(r.probe[0][i2] / r.probe[0][i1]) / (r.times[i2] - r.times[i1]);
    expect(femRate / analyticRate).toBeGreaterThan(0.92);
    expect(femRate / analyticRate).toBeLessThan(1.08);
    // monotonic cooling toward the fixed 0.
    expect(r.probe[0][i2]).toBeLessThan(r.probe[0][i1]);
    expect(r.probe[0][i2]).toBeGreaterThan(0);
  });

  it('converges to the exact steady-state linear profile (backward Euler stable at large Δt)', () => {
    const nx = 10, h = 5;
    const grid = new TopologyGrid(nx, 2, 2);
    const fixedTemp = new Map<number, number>();
    for (let iy = 0; iy <= 2; iy++) for (let iz = 0; iz <= 2; iz++) {
      fixedTemp.set(grid.node(0, iy, iz), 100); fixedTemp.set(grid.node(nx, iy, iz), 0);
    }
    const r = hex8TransientThermal(grid, {
      conductivity: k, volHeatCapacity: rhoC, cell: h, fixedTemp, initialTemp: 0,
      dt: 5, steps: 200,  // large Δt — implicit scheme stays stable
    });
    let maxErr = 0;
    for (let ix = 0; ix <= nx; ix++) {
      const T = r.temperature[grid.node(ix, 1, 1)];
      maxErr = Math.max(maxErr, Math.abs(T - 100 * (1 - ix / nx)));
    }
    expect(maxErr).toBeLessThan(1e-3);                  // matches the steady linear solution
  });
});
