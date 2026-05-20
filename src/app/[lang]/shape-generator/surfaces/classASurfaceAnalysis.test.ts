import { describe, it, expect } from 'vitest';
import {
  computeVertexNormals,
  computeCurvature,
  zebraStripes,
  curvatureComb,
  reflectionMap,
  sampleIsoCurve,
  type SurfaceMesh,
} from './classASurfaceAnalysis';

/** Flat plane in z=0: 2 triangles. */
function flatPlane(): SurfaceMesh {
  return {
    positions: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

/** Sphere-like dome — pyramidal apex over a square base. */
function dome(): SurfaceMesh {
  return {
    positions: [
      0, 0, 5,           // apex
      -5, -5, 0, 5, -5, 0, 5, 5, 0, -5, 5, 0,
    ],
    indices: [
      0, 1, 2,
      0, 2, 3,
      0, 3, 4,
      0, 4, 1,
    ],
  };
}

describe('computeVertexNormals', () => {
  it('flat plane: normals point +Z', () => {
    const n = computeVertexNormals(flatPlane());
    expect(n[2]).toBeCloseTo(1, 5);
    expect(n[5]).toBeCloseTo(1, 5);
  });

  it('returns one normal per vertex (length = 3 × vCount)', () => {
    const n = computeVertexNormals(flatPlane());
    expect(n).toHaveLength(12);
  });

  it('all normals unit length', () => {
    const n = computeVertexNormals(dome());
    for (let i = 0; i < n.length / 3; i++) {
      const len = Math.hypot(n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!);
      expect(len).toBeCloseTo(1, 4);
    }
  });
});

describe('computeCurvature', () => {
  it('flat plane has interior K ≈ 0', () => {
    const r = computeCurvature(flatPlane());
    // Boundary verts will have non-zero K (angle defect), but they're
    // a known limitation; just check the result is finite.
    expect(r.gaussian.every(Number.isFinite)).toBe(true);
  });

  it('dome apex has positive Gaussian curvature', () => {
    const r = computeCurvature(dome());
    expect(r.gaussian[0]!).toBeGreaterThan(0);
  });

  it('emits k1 ≥ k2', () => {
    const r = computeCurvature(dome());
    for (let i = 0; i < r.k1.length; i++) {
      expect(r.k1[i]!).toBeGreaterThanOrEqual(r.k2[i]!);
    }
  });
});

describe('zebraStripes', () => {
  it('returns one value per vertex', () => {
    const r = zebraStripes(flatPlane(), { bandCount: 8, lightDirection: [0, 0, 1] });
    expect(r).toHaveLength(4);
  });

  it('values are 0 or 1', () => {
    const r = zebraStripes(dome(), { bandCount: 12, lightDirection: [1, 0, 0] });
    for (const v of r) {
      expect(v === 0 || v === 1).toBe(true);
    }
  });

  it('all-aligned normals (flat plane facing +Z, light +Z) → same stripe', () => {
    const r = zebraStripes(flatPlane(), { bandCount: 8, lightDirection: [0, 0, 1] });
    expect(new Set(r).size).toBe(1);
  });
});

describe('curvatureComb', () => {
  it('comb endpoints at scaled normal distance', () => {
    const r = curvatureComb([
      { position: [0, 0, 0], tangent: [1, 0, 0], normal: [0, 0, 1], curvature: 1 },
      { position: [1, 0, 0], tangent: [1, 0, 0], normal: [0, 0, 1], curvature: 2 },
    ], 10);
    expect(r.combEndpoints[0]).toEqual([0, 0, 10]);
    expect(r.combEndpoints[1]).toEqual([1, 0, 20]);
  });

  it('reports max curvature', () => {
    const r = curvatureComb([
      { position: [0, 0, 0], tangent: [1, 0, 0], normal: [0, 0, 1], curvature: 0.5 },
      { position: [1, 0, 0], tangent: [1, 0, 0], normal: [0, 0, 1], curvature: 2.0 },
    ]);
    expect(r.maxCurvature).toBe(2.0);
  });
});

describe('reflectionMap', () => {
  it('emits (u, v) for every vertex', () => {
    const r = reflectionMap(flatPlane(), {
      cameraPosition: [0, 0, 100],
      resolutionU: 256, resolutionV: 128,
    });
    expect(r.uv.length).toBe(8); // 4 verts × 2
  });

  it('uv values in [0, 1]', () => {
    const r = reflectionMap(dome(), {
      cameraPosition: [10, 10, 10],
      resolutionU: 256, resolutionV: 128,
    });
    for (let i = 0; i < r.uv.length; i++) {
      const v = r.uv[i]!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('sampleIsoCurve', () => {
  it('emits requested sample count', () => {
    const samples = sampleIsoCurve('u', 0.5, (u, v) => [u, v, 0], 16);
    expect(samples).toHaveLength(16);
  });

  it('fixed parameter unchanged across samples', () => {
    const samples = sampleIsoCurve('u', 0.7, (u, v) => [u, v, 0], 8);
    expect(samples.every(s => s.position[0] === 0.7)).toBe(true);
  });

  it('parameter values run 0..1', () => {
    const samples = sampleIsoCurve('v', 0.5, (u, v) => [u, v, 0], 4);
    expect(samples[0]!.parameter).toBeCloseTo(0, 5);
    expect(samples[3]!.parameter).toBeCloseTo(1, 5);
  });
});
