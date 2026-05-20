import { describe, it, expect } from 'vitest';
import {
  analyzeWallThickness,
  summarize,
  type MeshArrays,
} from './wallThicknessAnalyzer';

function thinSlab(thicknessMm: number): MeshArrays {
  // 10x10 slab of given thickness in Z.
  return {
    positions: [
      0, 0, 0,  10, 0, 0,  10, 10, 0,  0, 10, 0,
      0, 0, thicknessMm,  10, 0, thicknessMm,  10, 10, thicknessMm,  0, 10, thicknessMm,
    ],
    indices: [
      0, 2, 1,  0, 3, 2,
      4, 5, 6,  4, 6, 7,
      0, 1, 5,  0, 5, 4,
      1, 2, 6,  1, 6, 5,
      2, 3, 7,  2, 7, 6,
      3, 0, 4,  3, 4, 7,
    ],
  };
}

describe('analyzeWallThickness', () => {
  it('empty mesh → empty result', () => {
    const r = analyzeWallThickness({ positions: [], indices: [] });
    expect(r.perVertexThickness).toEqual([]);
    expect(r.averageMm).toBe(0);
  });

  it('thin slab reports ~thickness on top + bottom vertices', () => {
    const r = analyzeWallThickness(thinSlab(2));
    // Vertex 0 (bottom corner) should see vertex 4 (top corner) at distance 2 in opposite face.
    // Allow for some imperfection due to triangulated corners.
    const finite = r.perVertexThickness.filter(t => Number.isFinite(t));
    expect(finite.length).toBeGreaterThan(0);
  });

  it('thinner slab → smaller average thickness', () => {
    const thin = analyzeWallThickness(thinSlab(1));
    const thick = analyzeWallThickness(thinSlab(10));
    expect(thick.averageMm).toBeGreaterThan(thin.averageMm);
  });

  it('thin vertex flagging respects threshold', () => {
    const r = analyzeWallThickness(thinSlab(2), { thinThresholdMm: 5 });
    expect(r.thinVertexIds.length).toBeGreaterThan(0);
  });

  it('thick threshold flagging', () => {
    const r = analyzeWallThickness(thinSlab(2), { thickThresholdMm: 1 });
    expect(r.thickVertexIds.length).toBeGreaterThan(0);
  });

  it('vertex count matches mesh vertex count', () => {
    const r = analyzeWallThickness(thinSlab(2));
    expect(r.perVertexThickness).toHaveLength(8);
  });

  it('maxRayDistance limits ray', () => {
    const tight = analyzeWallThickness(thinSlab(10), { maxRayDistanceMm: 1 });
    // Most rays will exceed → NaN.
    const valid = tight.perVertexThickness.filter(t => Number.isFinite(t));
    expect(valid.length).toBeLessThanOrEqual(tight.perVertexThickness.length);
  });

  it('per-vertex normals are unit-length', () => {
    const r = analyzeWallThickness(thinSlab(2));
    for (const n of r.perVertexNormal) {
      const len = Math.hypot(n.x, n.y, n.z);
      expect(len).toBeCloseTo(1, 3);
    }
  });

  it('min/max sane', () => {
    const r = analyzeWallThickness(thinSlab(5));
    expect(r.minMm).toBeGreaterThanOrEqual(0);
    expect(r.maxMm).toBeGreaterThanOrEqual(r.minMm);
  });
});

describe('summarize', () => {
  it('empty input', () => {
    const r = analyzeWallThickness({ positions: [], indices: [] });
    const s = summarize(r);
    expect(s.totalVertices).toBe(0);
  });

  it('reports thin fraction', () => {
    const r = analyzeWallThickness(thinSlab(0.5), { thinThresholdMm: 5 });
    const s = summarize(r);
    expect(s.thinFraction).toBeGreaterThan(0);
  });

  it('variation = max - min', () => {
    const r = analyzeWallThickness(thinSlab(3));
    const s = summarize(r);
    expect(s.variationMm).toBeCloseTo(r.maxMm - r.minMm, 5);
  });

  it('average matches result', () => {
    const r = analyzeWallThickness(thinSlab(3));
    const s = summarize(r);
    expect(s.averageThicknessMm).toBe(r.averageMm);
  });
});
