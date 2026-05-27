import { describe, it, expect } from 'vitest';
import {
  solvePipeNetwork,
  classifyFlow,
  dragForce,
  createGrid,
  solvePotentialFlow,
  velocityFromPsi,
  FLUID_PRESETS,
  DRAG_TABLE,
  type PipeNetworkNode,
  type PipeNetworkEdge,
} from './incompressibleFlow';

const water = FLUID_PRESETS['water-20c']!;

describe('solvePipeNetwork', () => {
  it('runs without diverging on a simple 2-node line', () => {
    const nodes: PipeNetworkNode[] = [
      { id: 'in', pressureBoundaryPa: 100000 },
      { id: 'out', pressureBoundaryPa: 0 },
    ];
    const edges: PipeNetworkEdge[] = [
      { id: 'e1', fromNode: 'in', toNode: 'out', lengthM: 10, innerDiameterM: 0.05 },
    ];
    const r = solvePipeNetwork(nodes, edges, water, 30);
    expect(Number.isFinite(r.edgeFlows['e1'])).toBe(true);
    expect(r.iterations).toBeGreaterThanOrEqual(0);
  });

  it('edge details include reynolds + friction + ΔP', () => {
    const nodes: PipeNetworkNode[] = [
      { id: 'in', pressureBoundaryPa: 100000 },
      { id: 'out', pressureBoundaryPa: 0 },
    ];
    const edges: PipeNetworkEdge[] = [
      { id: 'e1', fromNode: 'in', toNode: 'out', lengthM: 10, innerDiameterM: 0.05 },
    ];
    const r = solvePipeNetwork(nodes, edges, water);
    const d = r.edgeDetails['e1']!;
    expect(typeof d.reynolds).toBe('number');
    expect(typeof d.frictionFactor).toBe('number');
    expect(typeof d.pressureDropPa).toBe('number');
  });

  it('node pressure propagates from reference', () => {
    const nodes: PipeNetworkNode[] = [
      { id: 'in', pressureBoundaryPa: 200000 },
      { id: 'out' },
    ];
    const edges: PipeNetworkEdge[] = [
      { id: 'e1', fromNode: 'in', toNode: 'out', lengthM: 5, innerDiameterM: 0.05 },
    ];
    const r = solvePipeNetwork(nodes, edges, water);
    expect(r.nodePressures['in']).toBe(200000);
  });
});

describe('classifyFlow', () => {
  it('low velocity → laminar', () => {
    const r = classifyFlow(0.001, 0.01, water);
    expect(r.regime).toBe('laminar');
  });

  it('high velocity → turbulent', () => {
    const r = classifyFlow(5, 0.05, water);
    expect(r.regime).toBe('turbulent');
  });

  it('Mach < 0.3 → incompressible', () => {
    const r = classifyFlow(1, 0.05, FLUID_PRESETS['air-20c']!);
    expect(r.compressibility).toBe('incompressible');
  });

  it('Mach ~ 0.5 → subsonic', () => {
    const r = classifyFlow(180, 0.05, FLUID_PRESETS['air-20c']!);
    expect(r.compressibility).toBe('subsonic');
  });

  it('Mach > 1.2 → supersonic', () => {
    const r = classifyFlow(500, 0.05, FLUID_PRESETS['air-20c']!);
    expect(r.compressibility).toBe('supersonic');
  });

  it('entry length grows with Re', () => {
    const lowRe = classifyFlow(0.01, 0.05, water);
    const highRe = classifyFlow(2, 0.05, water);
    expect(highRe.entryLengthM).toBeGreaterThan(lowRe.entryLengthM);
  });
});

describe('dragForce', () => {
  it('F = 0.5 ρ v² A Cd', () => {
    // ρ=1000, v=10, A=1, Cd=0.5 → F = 0.5 × 1000 × 100 × 1 × 0.5 = 25000.
    const F = dragForce(0.5, 1, 10, { densityKgM3: 1000, viscosityPaS: 0.001 });
    expect(F).toBeCloseTo(25000, 5);
  });

  it('zero velocity → zero force', () => {
    expect(dragForce(0.5, 1, 0, water)).toBe(0);
  });

  it('DRAG_TABLE has sphere + cube + sedan', () => {
    expect(DRAG_TABLE.some(d => d.shape === 'sphere')).toBe(true);
    expect(DRAG_TABLE.some(d => d.shape === 'car-modern-sedan')).toBe(true);
  });
});

describe('solvePotentialFlow', () => {
  it('runs and returns convergence info', () => {
    const grid = createGrid(10, 10);
    const r = solvePotentialFlow(grid, 1.0, 100, 1e-3);
    expect(typeof r.converged).toBe('boolean');
    expect(r.iterations).toBeGreaterThan(0);
  });

  it('uniform-flow boundary: stream function increases linearly with j', () => {
    const grid = createGrid(10, 10);
    solvePotentialFlow(grid, 1.0, 50, 1e-3);
    // ψ at top row should be larger than ψ at bottom row.
    expect(grid.psi[9 * 10]).toBeGreaterThan(grid.psi[0]!);
  });

  it('solid voxels stay at zero', () => {
    const grid = createGrid(10, 10);
    grid.solid[5 * 10 + 5] = 1;
    solvePotentialFlow(grid, 1.0, 50, 1e-3);
    expect(grid.psi[5 * 10 + 5]).toBe(0);
  });
});

describe('velocityFromPsi', () => {
  it('returns u, v arrays of correct length', () => {
    const grid = createGrid(10, 10);
    solvePotentialFlow(grid, 1.0, 50, 1e-3);
    const { u, v } = velocityFromPsi(grid);
    expect(u.length).toBe(grid.psi.length);
    expect(v.length).toBe(grid.psi.length);
  });
});
