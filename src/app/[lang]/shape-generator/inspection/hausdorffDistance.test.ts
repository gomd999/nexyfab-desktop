import { describe, it, expect } from 'vitest';
import {
  sampleMeshSurface,
  pointToTriangleDistance,
  pointToMeshDistance,
  computeDistanceMetrics,
  inspectAgainstSpec,
  type MeshArrays,
} from './hausdorffDistance';

function unitSquareXY(): MeshArrays {
  return {
    positions: [
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

function offsetSquareXY(dz: number): MeshArrays {
  return {
    positions: [
      0, 0, dz,
      1, 0, dz,
      1, 1, dz,
      0, 1, dz,
    ],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

describe('sampleMeshSurface', () => {
  it('returns the requested number of samples', () => {
    const r = sampleMeshSurface(unitSquareXY(), 100, 42);
    expect(r.points).toHaveLength(100);
    expect(r.triangleIds).toHaveLength(100);
  });

  it('empty mesh → empty samples', () => {
    expect(sampleMeshSurface({ positions: [], indices: [] }, 50).points).toEqual([]);
  });

  it('points lie on z=0 for XY square', () => {
    const r = sampleMeshSurface(unitSquareXY(), 50, 42);
    for (const p of r.points) {
      expect(Math.abs(p[2])).toBeLessThan(1e-9);
    }
  });

  it('points within square bounds', () => {
    const r = sampleMeshSurface(unitSquareXY(), 50, 42);
    for (const p of r.points) {
      expect(p[0]).toBeGreaterThanOrEqual(0);
      expect(p[0]).toBeLessThanOrEqual(1);
      expect(p[1]).toBeGreaterThanOrEqual(0);
      expect(p[1]).toBeLessThanOrEqual(1);
    }
  });

  it('deterministic with same seed', () => {
    const a = sampleMeshSurface(unitSquareXY(), 20, 7);
    const b = sampleMeshSurface(unitSquareXY(), 20, 7);
    expect(a.points[0]).toEqual(b.points[0]);
  });
});

describe('pointToTriangleDistance', () => {
  it('point on the triangle → 0 distance', () => {
    expect(pointToTriangleDistance([0.5, 0.5, 0], unitSquareXY(), 0)).toBeCloseTo(0, 5);
  });

  it('above triangle → vertical distance', () => {
    expect(pointToTriangleDistance([0.5, 0.5, 3], unitSquareXY(), 0)).toBeCloseTo(3, 5);
  });

  it('off-triangle → distance to nearest vertex', () => {
    // Triangle 0 = (0,0,0), (1,0,0), (1,1,0). Point (-1, 0.5, 0)
    // → closest is vertex (0,0,0), distance = √(1 + 0.25) ≈ 1.118.
    expect(pointToTriangleDistance([-1, 0.5, 0], unitSquareXY(), 0)).toBeCloseTo(Math.sqrt(1.25), 5);
  });
});

describe('pointToMeshDistance', () => {
  it('uses the nearest triangle', () => {
    const mesh = unitSquareXY();
    expect(pointToMeshDistance([0.5, 0.5, 0], mesh)).toBeCloseTo(0, 5);
    expect(pointToMeshDistance([0.5, 0.5, 5], mesh)).toBeCloseTo(5, 5);
  });
});

describe('computeDistanceMetrics', () => {
  it('identical meshes → metrics near 0', () => {
    const r = computeDistanceMetrics(unitSquareXY(), unitSquareXY(), 200, 42);
    expect(r.symmetricHausdorff).toBeLessThan(0.1);
    expect(r.meanAtoB).toBeLessThan(0.1);
  });

  it('offset meshes → Hausdorff ≈ offset', () => {
    const r = computeDistanceMetrics(unitSquareXY(), offsetSquareXY(3), 200, 42);
    expect(r.symmetricHausdorff).toBeGreaterThan(2);
    expect(r.symmetricHausdorff).toBeLessThan(4);
  });

  it('RMS ≤ Hausdorff', () => {
    const r = computeDistanceMetrics(unitSquareXY(), offsetSquareXY(2), 200, 42);
    expect(r.rmsAtoB).toBeLessThanOrEqual(r.hausdorffAtoB + 1e-6);
  });

  it('p95 ≤ max distance', () => {
    const r = computeDistanceMetrics(unitSquareXY(), offsetSquareXY(2), 200, 42);
    expect(r.p95AtoB).toBeLessThanOrEqual(r.hausdorffAtoB + 1e-6);
  });

  it('reports sample count', () => {
    const r = computeDistanceMetrics(unitSquareXY(), unitSquareXY(), 200, 42);
    expect(r.sampleCount).toBe(200);
  });
});

describe('inspectAgainstSpec', () => {
  it('matching mesh + loose tolerance → passes', () => {
    const r = inspectAgainstSpec(unitSquareXY(), unitSquareXY(), 1, 100, 42);
    expect(r.passed).toBe(true);
    expect(r.violationTriangles).toEqual([]);
  });

  it('big offset + tight tolerance → fails', () => {
    const r = inspectAgainstSpec(unitSquareXY(), offsetSquareXY(5), 0.1, 100, 42);
    expect(r.passed).toBe(false);
    expect(r.violationTriangles.length).toBeGreaterThan(0);
  });

  it('violation triangles sorted descending', () => {
    const r = inspectAgainstSpec(unitSquareXY(), offsetSquareXY(5), 0.1, 100, 42);
    for (let i = 1; i < r.violationTriangles.length; i++) {
      expect(r.violationTriangles[i]!.deviationMm).toBeLessThanOrEqual(r.violationTriangles[i - 1]!.deviationMm);
    }
  });
});
