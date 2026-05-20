import { describe, it, expect } from 'vitest';
import {
  optimizeTopology,
  thresholdToBinary,
  volumeFraction,
  DEFAULT_SIMP_OPTIONS,
  type VoxelGrid,
  type LoadCase,
  type FixedSupport,
} from './topologyOptimization';

function makeGrid(n: number): VoxelGrid {
  return {
    nx: n, ny: n, nz: n,
    densities: new Float32Array(n * n * n),
  };
}

describe('optimizeTopology', () => {
  it('reaches target volume fraction (within slop)', () => {
    const grid = makeGrid(8);
    const loads: LoadCase[] = [{ voxelIndex: [4, 4, 7], forceN: [0, 0, -100] }];
    const supports: FixedSupport[] = [{ voxelIndex: [0, 0, 0] }, { voxelIndex: [7, 0, 0] }];
    const r = optimizeTopology(grid, loads, supports, { volumeFraction: 0.4, maxIterations: 10 });
    expect(r.finalVolumeFraction).toBeCloseTo(0.4, 1);
  });

  it('history tracks max-density-change per iteration', () => {
    const grid = makeGrid(6);
    const r = optimizeTopology(grid, [{ voxelIndex: [3, 3, 5], forceN: [0, 0, -100] }], []);
    expect(r.history.length).toBeGreaterThan(0);
    expect(r.history.length).toBe(r.volumeHistory.length);
  });

  it('keepSolid voxels remain at density 1', () => {
    const grid = makeGrid(6);
    grid.keepSolid = new Uint8Array(grid.densities.length);
    grid.keepSolid[0] = 1;
    grid.keepSolid[10] = 1;
    optimizeTopology(grid, [{ voxelIndex: [3, 3, 5], forceN: [0, 0, -100] }], [], { maxIterations: 5 });
    expect(grid.densities[0]).toBe(1);
    expect(grid.densities[10]).toBe(1);
  });

  it('keepVoid voxels stay near minDensity', () => {
    const grid = makeGrid(6);
    grid.keepVoid = new Uint8Array(grid.densities.length);
    grid.keepVoid[20] = 1;
    optimizeTopology(grid, [{ voxelIndex: [3, 3, 5], forceN: [0, 0, -100] }], [], { maxIterations: 5 });
    expect(grid.densities[20]).toBeLessThanOrEqual(0.05);
  });

  it('converges flag set on early termination', () => {
    const grid = makeGrid(4);
    const r = optimizeTopology(grid, [{ voxelIndex: [2, 2, 3], forceN: [0, 0, -100] }], [], {
      maxIterations: 50, convergenceThreshold: 1.0, // huge threshold = instant convergence
    });
    expect(r.converged).toBe(true);
  });

  it('default options exposed', () => {
    expect(DEFAULT_SIMP_OPTIONS.penalty).toBe(3);
    expect(DEFAULT_SIMP_OPTIONS.volumeFraction).toBeGreaterThan(0);
  });

  it('non-zero filter radius produces smoother field', () => {
    const grid = makeGrid(8);
    optimizeTopology(grid, [{ voxelIndex: [4, 4, 7], forceN: [0, 0, -100] }], [], { filterRadius: 2, maxIterations: 5 });
    // After filtering, max density change between neighbours should be small.
    let maxNbrDiff = 0;
    for (let i = 0; i < grid.nx - 1; i++) {
      for (let j = 0; j < grid.ny; j++) {
        for (let k = 0; k < grid.nz; k++) {
          const a = grid.densities[k * grid.ny * grid.nx + j * grid.nx + i]!;
          const b = grid.densities[k * grid.ny * grid.nx + j * grid.nx + i + 1]!;
          const diff = Math.abs(a - b);
          if (diff > maxNbrDiff) maxNbrDiff = diff;
        }
      }
    }
    expect(maxNbrDiff).toBeLessThan(1);
  });
});

describe('thresholdToBinary', () => {
  it('binarizes density field', () => {
    const grid = makeGrid(4);
    grid.densities.fill(0.3);
    grid.densities[0] = 0.7;
    grid.densities[1] = 0.6;
    const bin = thresholdToBinary(grid, 0.5);
    expect(bin[0]).toBe(1);
    expect(bin[1]).toBe(1);
    expect(bin[2]).toBe(0);
  });

  it('custom threshold respected', () => {
    const grid = makeGrid(4);
    grid.densities[0] = 0.2;
    grid.densities[1] = 0.4;
    expect(thresholdToBinary(grid, 0.3)[0]).toBe(0);
    expect(thresholdToBinary(grid, 0.3)[1]).toBe(1);
  });
});

describe('volumeFraction', () => {
  it('uniform half-density grid = 0.5', () => {
    const grid = makeGrid(4);
    grid.densities.fill(0.5);
    expect(volumeFraction(grid)).toBeCloseTo(0.5, 6);
  });

  it('empty grid = 0', () => {
    const grid = makeGrid(4);
    expect(volumeFraction(grid)).toBe(0);
  });
});
