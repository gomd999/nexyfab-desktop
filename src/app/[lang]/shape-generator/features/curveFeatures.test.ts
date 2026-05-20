import { describe, it, expect } from 'vitest';
import {
  projectPointToFace,
  projectEdgeToFace,
  buildCompositeCurve,
  evalCompositeCurve,
  fitSplineThroughPoints,
  helixOnSurface,
  approximateGeodesic,
  type FacePlane,
  type Vec3,
} from './curveFeatures';

describe('projectPointToFace', () => {
  it('projects to XY plane drops z', () => {
    const face: FacePlane = { origin: [0, 0, 0], normal: [0, 0, 1] };
    expect(projectPointToFace([3, 4, 7], face)).toEqual([3, 4, 0]);
  });

  it('point already on plane → unchanged', () => {
    const face: FacePlane = { origin: [0, 0, 0], normal: [0, 0, 1] };
    expect(projectPointToFace([3, 4, 0], face)).toEqual([3, 4, 0]);
  });
});

describe('projectEdgeToFace', () => {
  it('projects every edge point to face', () => {
    const face: FacePlane = { origin: [0, 0, 0], normal: [0, 0, 1] };
    const r = projectEdgeToFace([[1, 2, 3], [4, 5, 6]], face);
    expect(r[0]![2]).toBe(0);
    expect(r[1]![2]).toBe(0);
  });
});

describe('buildCompositeCurve', () => {
  it('chains continuous segments', () => {
    const r = buildCompositeCurve([
      { id: 's1', points: [[0, 0, 0], [10, 0, 0]] },
      { id: 's2', points: [[10, 0, 0], [10, 10, 0]] },
    ]);
    expect(r).not.toBeNull();
    expect(r!.points).toHaveLength(3); // 0,0 → 10,0 → 10,10 (joint deduped)
    expect(r!.totalLengthMm).toBeCloseTo(20, 5);
  });

  it('rejects discontinuous segments', () => {
    const r = buildCompositeCurve([
      { id: 's1', points: [[0, 0, 0], [10, 0, 0]] },
      { id: 's2', points: [[20, 0, 0], [20, 10, 0]] },
    ]);
    expect(r).toBeNull();
  });

  it('empty input → zero-length composite', () => {
    const r = buildCompositeCurve([]);
    expect(r!.totalLengthMm).toBe(0);
  });

  it('per-segment param ranges sum to [0,1]', () => {
    const r = buildCompositeCurve([
      { id: 's1', points: [[0, 0, 0], [10, 0, 0]] },
      { id: 's2', points: [[10, 0, 0], [10, 10, 0]] },
    ])!;
    expect(r.segmentParams[0]!.tStart).toBe(0);
    expect(r.segmentParams[1]!.tEnd).toBeCloseTo(1, 6);
  });
});

describe('evalCompositeCurve', () => {
  const curve = buildCompositeCurve([
    { id: 's1', points: [[0, 0, 0], [10, 0, 0]] },
    { id: 's2', points: [[10, 0, 0], [10, 10, 0]] },
  ])!;

  it('t=0 = first point', () => {
    expect(evalCompositeCurve(curve, 0)).toEqual([0, 0, 0]);
  });

  it('t=1 = last point', () => {
    expect(evalCompositeCurve(curve, 1)).toEqual([10, 10, 0]);
  });

  it('t=0.5 ≈ midpoint of total length', () => {
    const r = evalCompositeCurve(curve, 0.5);
    // Total length = 20. 10mm along chain ends at junction.
    expect(r).toEqual([10, 0, 0]);
  });
});

describe('fitSplineThroughPoints', () => {
  it('catmull-rom passes through endpoints', () => {
    const r = fitSplineThroughPoints(
      [[0, 0, 0], [5, 10, 0], [10, 0, 0]],
      { mode: 'catmull-rom', samplesPerSegment: 8 },
    );
    expect(r[0]).toEqual([0, 0, 0]);
    expect(r[r.length - 1]).toEqual([10, 0, 0]);
  });

  it('returns 2 points for 2 input controls', () => {
    const r = fitSplineThroughPoints(
      [[0, 0, 0], [10, 0, 0]],
      { mode: 'catmull-rom', samplesPerSegment: 8 },
    );
    expect(r.length).toBeGreaterThanOrEqual(2);
  });

  it('tension 1 stays within control polygon (no overshoot)', () => {
    const tight = fitSplineThroughPoints(
      [[0, 0, 0], [5, 10, 0], [10, 0, 0]],
      { mode: 'cardinal', tension: 1, samplesPerSegment: 16 },
    );
    // tension=1 → linear-ish; every sample y stays in [0, 10].
    for (const p of tight) {
      expect(p[1]).toBeGreaterThanOrEqual(-1e-9);
      expect(p[1]).toBeLessThanOrEqual(10 + 1e-9);
    }
  });
});

describe('helixOnSurface', () => {
  it('emits samplesPerTurn × turns + 1 points', () => {
    const r = helixOnSurface({
      turns: 3, pitchMm: 5, samplesPerTurn: 16,
      axisDirection: [0, 0, 1], axisOrigin: [0, 0, 0],
      startRadiusMm: 10, endRadiusMm: 10,
    });
    expect(r).toHaveLength(48 + 1);
  });

  it('axial Z increases with samples (Z-aligned axis)', () => {
    const r = helixOnSurface({
      turns: 2, pitchMm: 5, samplesPerTurn: 8,
      axisDirection: [0, 0, 1], axisOrigin: [0, 0, 0],
      startRadiusMm: 5, endRadiusMm: 5,
    });
    expect(r[r.length - 1]![2]).toBeGreaterThan(r[0]![2]!);
  });

  it('radial distance approximates startRadius', () => {
    const r = helixOnSurface({
      turns: 1, pitchMm: 5, samplesPerTurn: 16,
      axisDirection: [0, 0, 1], axisOrigin: [0, 0, 0],
      startRadiusMm: 8, endRadiusMm: 8,
    });
    const firstRadial = Math.hypot(r[0]![0]!, r[0]![1]!);
    expect(firstRadial).toBeCloseTo(8, 5);
  });

  it('tapered helix shrinks radius along axis', () => {
    const r = helixOnSurface({
      turns: 1, pitchMm: 5, samplesPerTurn: 16,
      axisDirection: [0, 0, 1], axisOrigin: [0, 0, 0],
      startRadiusMm: 10, endRadiusMm: 5,
    });
    const startRadial = Math.hypot(r[0]![0]!, r[0]![1]!);
    const endRadial = Math.hypot(r[r.length - 1]![0]!, r[r.length - 1]![1]!);
    expect(endRadial).toBeLessThan(startRadial);
  });
});

describe('approximateGeodesic', () => {
  const planeMesh = {
    positions: [-10, -10, 0, 10, -10, 0, 10, 10, 0, -10, 10, 0],
    indices: [0, 1, 2, 0, 2, 3],
  };

  it('flat plane: samples lie near z=0', () => {
    const r = approximateGeodesic(
      [-5, -5, 5], [5, 5, 5],
      planeMesh.positions, planeMesh.indices, 16,
    );
    for (const p of r) {
      expect(Math.abs(p[2]!)).toBeLessThan(0.5);
    }
  });

  it('emits samples + 1 points', () => {
    const r = approximateGeodesic(
      [0, 0, 5] as Vec3, [10, 0, 5] as Vec3,
      planeMesh.positions, planeMesh.indices, 20,
    );
    expect(r).toHaveLength(21);
  });
});
