import { describe, it, expect } from 'vitest';
import { parseXyz, fitPlane, fitSphere, type PointCloud } from './pointCloud';
import {
  spurGearProfile,
  camProfile,
  grashofCheck,
  sliderCrankPosition,
} from '../mechanism/mechanismLibrary';
import {
  runCoupled,
  thermalStructuralWorkflow,
  fluidStructuralWorkflow,
  type PhysicsBus,
} from '../multiPhysics/coupledSolver';

describe('parseXyz', () => {
  it('parses 3-column xyz lines', () => {
    const cloud = parseXyz('1 2 3\n4 5 6\n7 8 9');
    expect(cloud.points).toHaveLength(3);
    expect(cloud.points[0]).toMatchObject({ x: 1, y: 2, z: 3 });
  });

  it('skips header / non-numeric lines', () => {
    const cloud = parseXyz('# header\n1 2 3\n# comment\n4 5 6');
    expect(cloud.points).toHaveLength(2);
  });

  it('parses normals when 6 columns', () => {
    const cloud = parseXyz('1 2 3 0 0 1');
    expect(cloud.points[0]!.nz).toBe(1);
  });

  it('computes bbox', () => {
    const cloud = parseXyz('0 0 0\n10 -5 3');
    expect(cloud.bbox.min).toEqual([0, -5, 0]);
    expect(cloud.bbox.max).toEqual([10, 0, 3]);
  });
});

describe('fitPlane', () => {
  it('returns null for fewer than 3 points', () => {
    const cloud: PointCloud = {
      points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      bbox: { min: [0, 0, 0], max: [1, 0, 0] },
    };
    expect(fitPlane(cloud)).toBeNull();
  });

  it('fits z=0 plane with normal close to ±Z', () => {
    const cloud: PointCloud = {
      points: [
        { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 },
        { x: 0, y: 10, z: 0 }, { x: 5, y: 5, z: 0 },
        { x: -5, y: 5, z: 0 }, { x: 5, y: -3, z: 0 },
      ],
      bbox: { min: [-5, -3, 0], max: [10, 10, 0] },
    };
    const p = fitPlane(cloud);
    expect(p).not.toBeNull();
    expect(Math.abs(p!.normal[2])).toBeCloseTo(1, 2);
    expect(p!.rmsError).toBeLessThan(1e-3);
  });
});

describe('fitSphere', () => {
  it('returns null for fewer than 4 points', () => {
    const cloud: PointCloud = {
      points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      bbox: { min: [0, 0, 0], max: [1, 0, 0] },
    };
    expect(fitSphere(cloud)).toBeNull();
  });

  it('fits unit sphere centred at origin', () => {
    // Sample a few well-spread points on the unit sphere.
    const phi = (1 + Math.sqrt(5)) / 2;
    const points = [];
    for (let i = 0; i < 30; i++) {
      const y = 1 - (i / 29) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = (2 * Math.PI / phi) * i;
      points.push({ x: r * Math.cos(theta), y, z: r * Math.sin(theta) });
    }
    const cloud: PointCloud = { points, bbox: { min: [-1, -1, -1], max: [1, 1, 1] } };
    const s = fitSphere(cloud);
    expect(s).not.toBeNull();
    expect(s!.radius).toBeCloseTo(1, 2);
    expect(Math.hypot(...s!.center)).toBeLessThan(0.05);
  });
});

describe('spurGearProfile', () => {
  it('module × teeth / 2 = pitch radius', () => {
    const r = spurGearProfile({ module: 2, teethCount: 20, pressureAngleDeg: 20, faceWidthMm: 10 });
    expect(r.pitchRadius).toBe(20);
  });

  it('base radius < pitch radius for 20° pressure angle', () => {
    const r = spurGearProfile({ module: 2, teethCount: 20, pressureAngleDeg: 20, faceWidthMm: 10 });
    expect(r.baseRadius).toBeLessThan(r.pitchRadius);
  });

  it('outer > pitch > root', () => {
    const r = spurGearProfile({ module: 2, teethCount: 20, pressureAngleDeg: 20, faceWidthMm: 10 });
    expect(r.outerRadius).toBeGreaterThan(r.pitchRadius);
    expect(r.rootRadius).toBeLessThan(r.pitchRadius);
  });

  it('profile has 4 points per tooth', () => {
    const r = spurGearProfile({ module: 1, teethCount: 12, pressureAngleDeg: 20, faceWidthMm: 5 });
    expect(r.profile).toHaveLength(48);
  });
});

describe('camProfile', () => {
  it('eccentric cam radii bounded by base + lift', () => {
    const pts = camProfile({ type: 'eccentric', baseRadiusMm: 10, liftMm: 5, samples: 36 });
    for (const [x, y] of pts) {
      const r = Math.hypot(x, y);
      expect(r).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(r).toBeLessThanOrEqual(15 + 1e-6);
    }
  });

  it('respects sample count (≥36)', () => {
    const pts = camProfile({ type: 'harmonic', baseRadiusMm: 5, liftMm: 2, samples: 10 });
    expect(pts.length).toBeGreaterThanOrEqual(36);
  });
});

describe('grashofCheck', () => {
  it('crank-rocker for classic 2-4-5-6 linkage', () => {
    const r = grashofCheck({ crankMm: 2, couplerMm: 4, rockerMm: 5, groundMm: 6 });
    expect(r.isGrashof).toBe(true);
    expect(r.type).toBe('crank-rocker');
  });

  it('invalid when shortest + longest > sum of two middle', () => {
    // 1 + 100 > 4 + 5 → not Grashof.
    const r = grashofCheck({ crankMm: 1, couplerMm: 4, rockerMm: 5, groundMm: 100 });
    expect(r.isGrashof).toBe(false);
    expect(r.type).toBe('invalid');
  });
});

describe('sliderCrankPosition', () => {
  it('returns r + L at θ = 0 (TDC)', () => {
    expect(sliderCrankPosition({ crankMm: 30, conRodMm: 100 }, 0)).toBeCloseTo(130, 6);
  });

  it('returns L - r at θ = π (BDC) when valid', () => {
    // At θ=π: r·cos(π) + √(L²) = -30 + 100 = 70.
    expect(sliderCrankPosition({ crankMm: 30, conRodMm: 100 }, Math.PI)).toBeCloseTo(70, 6);
  });

  it('falls back to r + L for invalid configuration (L < r)', () => {
    expect(sliderCrankPosition({ crankMm: 100, conRodMm: 50 }, Math.PI / 2)).toBeCloseTo(150, 6);
  });
});

describe('runCoupled', () => {
  it('converges when solvers leave bus unchanged after first iter', async () => {
    const bus: PhysicsBus = { scalars: new Map([['t', [25, 25, 25]]]), vectors: new Map() };
    let calls = 0;
    const noop = async (b: PhysicsBus): Promise<void> => { void b; calls++; };
    const wf = thermalStructuralWorkflow(noop, noop);
    const r = await runCoupled(wf, bus);
    expect(r.converged).toBe(true);
    expect(calls).toBeGreaterThan(0);
  });

  it('reports non-convergence when residual stays > tolerance', async () => {
    const bus: PhysicsBus = { scalars: new Map([['t', [0]]]), vectors: new Map() };
    let n = 0;
    const wf = fluidStructuralWorkflow(
      async (b) => { n += 1; b.scalars.set('t', [n * 100]); },
      async (b) => { void b; },
    );
    wf.maxIterations = 3;
    wf.tolerance = 1e-10;
    const r = await runCoupled(wf, bus);
    expect(r.converged).toBe(false);
    expect(r.history).toHaveLength(3);
  });
});
