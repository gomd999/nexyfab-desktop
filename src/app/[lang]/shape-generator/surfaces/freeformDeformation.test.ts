import { describe, it, expect } from 'vitest';
import {
  pushPullControlPoints,
  controlPointDisplacements,
  buildLattice,
  deformPoint,
  deformPoints,
  moveLatticeNode,
  type NurbsSurfaceGrid,
  type Vec3,
} from './freeformDeformation';

function flatSurfaceGrid(nU: number, nV: number): NurbsSurfaceGrid {
  const cps: number[] = [];
  for (let j = 0; j < nV; j++) {
    for (let i = 0; i < nU; i++) {
      cps.push(i, j, 0);
    }
  }
  return { nU, nV, controlPoints: cps };
}

describe('pushPullControlPoints', () => {
  it('picked point moves by full amount', () => {
    const grid = flatSurfaceGrid(5, 5);
    const r = pushPullControlPoints(grid, {
      picked: [{ i: 2, j: 2 }],
      direction: [0, 0, 1],
      amount: 5,
      falloffRadius: 0,
      falloff: 'sharp',
    });
    expect(r.controlPoints[(2 * 5 + 2) * 3 + 2]).toBe(5);
  });

  it('neighbour points unaffected with falloffRadius 0', () => {
    const grid = flatSurfaceGrid(5, 5);
    const r = pushPullControlPoints(grid, {
      picked: [{ i: 2, j: 2 }],
      direction: [0, 0, 1],
      amount: 5,
      falloffRadius: 0,
      falloff: 'sharp',
    });
    expect(r.controlPoints[(2 * 5 + 1) * 3 + 2]).toBe(0);
  });

  it('Gaussian falloff smoothly affects neighbours', () => {
    const grid = flatSurfaceGrid(5, 5);
    const r = pushPullControlPoints(grid, {
      picked: [{ i: 2, j: 2 }],
      direction: [0, 0, 1],
      amount: 5,
      falloffRadius: 2,
      falloff: 'gaussian',
    });
    const center = r.controlPoints[(2 * 5 + 2) * 3 + 2]!;
    const neighbour = r.controlPoints[(2 * 5 + 3) * 3 + 2]!;
    expect(center).toBe(5);
    expect(neighbour).toBeGreaterThan(0);
    expect(neighbour).toBeLessThan(5);
  });

  it('linear falloff zeroes at radius edge', () => {
    const grid = flatSurfaceGrid(7, 7);
    const r = pushPullControlPoints(grid, {
      picked: [{ i: 3, j: 3 }],
      direction: [0, 0, 1],
      amount: 5,
      falloffRadius: 2,
      falloff: 'linear',
    });
    // Distance 2 away from center → linear falloff value 0.
    const at2 = r.controlPoints[(3 * 7 + 5) * 3 + 2]!;
    expect(Math.abs(at2)).toBeLessThan(1e-9);
  });

  it('cubic falloff smooth near 0 and edge', () => {
    const grid = flatSurfaceGrid(5, 5);
    const r = pushPullControlPoints(grid, {
      picked: [{ i: 2, j: 2 }],
      direction: [0, 0, 1],
      amount: 5,
      falloffRadius: 2,
      falloff: 'cubic',
    });
    expect(r.controlPoints[(2 * 5 + 2) * 3 + 2]).toBe(5);
  });
});

describe('controlPointDisplacements', () => {
  it('zero displacement for unchanged grid', () => {
    const before = flatSurfaceGrid(3, 3);
    const after = flatSurfaceGrid(3, 3);
    const d = controlPointDisplacements(before, after);
    expect(d.every(v => v === 0)).toBe(true);
  });

  it('returns magnitude of per-point delta', () => {
    const before = flatSurfaceGrid(3, 3);
    const after = pushPullControlPoints(before, {
      picked: [{ i: 1, j: 1 }],
      direction: [0, 0, 1], amount: 5,
      falloffRadius: 0, falloff: 'sharp',
    });
    const d = controlPointDisplacements(before, after);
    expect(d[(1 * 3 + 1)]).toBe(5);
  });
});

describe('FFD lattice', () => {
  const points: Vec3[] = [
    [0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0],
    [0, 0, 5], [10, 0, 5], [10, 10, 5], [0, 10, 5],
  ];

  it('buildLattice covers all input points', () => {
    const lattice = buildLattice(points, 3, 3, 3);
    expect(lattice.nU).toBe(3);
    expect(lattice.origin).toEqual([0, 0, 0]);
  });

  it('undeformed lattice deformPoint ≈ identity', () => {
    const lattice = buildLattice(points, 3, 3, 3);
    const r = deformPoint([5, 5, 2.5], lattice);
    expect(r[0]).toBeCloseTo(5, 4);
    expect(r[1]).toBeCloseTo(5, 4);
    expect(r[2]).toBeCloseTo(2.5, 4);
  });

  it('moving a lattice node displaces nearby world points', () => {
    let lattice = buildLattice(points, 3, 3, 3);
    lattice = moveLatticeNode(lattice, 1, 1, 1, [0, 0, 10]);
    const r = deformPoint([5, 5, 2.5], lattice);
    expect(r[2]).toBeGreaterThan(2.5);
  });

  it('deformPoints emits one output per input', () => {
    const lattice = buildLattice(points, 3, 3, 3);
    const r = deformPoints(points, lattice);
    expect(r).toHaveLength(points.length);
  });

  it('moveLatticeNode out-of-bounds → unchanged lattice', () => {
    const lattice = buildLattice(points, 3, 3, 3);
    const r = moveLatticeNode(lattice, 99, 99, 99, [1, 2, 3]);
    expect(r.controlPoints).toEqual(lattice.controlPoints);
  });

  it('empty input → safe zero lattice', () => {
    const lattice = buildLattice([], 2, 2, 2);
    expect(lattice.controlPoints).toHaveLength(2 * 2 * 2 * 3);
  });
});
