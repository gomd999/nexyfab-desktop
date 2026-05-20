import { describe, it, expect } from 'vitest';
import {
  scoreMeshQuality,
  summarize,
  type MeshArrays,
} from './feaMeshQualityScore';

function equilateralMesh(): MeshArrays {
  const h = Math.sqrt(3) / 2;
  return {
    positions: [0, 0, 0, 1, 0, 0, 0.5, h, 0],
    indices: [0, 1, 2],
  };
}

function rightTriangleMesh(): MeshArrays {
  return {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2],
  };
}

function sliverMesh(): MeshArrays {
  return {
    positions: [0, 0, 0, 100, 0, 0, 50, 0.05, 0],
    indices: [0, 1, 2],
  };
}

describe('scoreMeshQuality', () => {
  it('empty mesh → excellent default', () => {
    const r = scoreMeshQuality({ positions: [], indices: [] });
    expect(r.overallGrade).toBe('excellent');
    expect(r.perElement).toEqual([]);
  });

  it('equilateral triangle → excellent', () => {
    const r = scoreMeshQuality(equilateralMesh());
    expect(r.perElement[0]!.grade).toBe('excellent');
  });

  it('right triangle is good or acceptable', () => {
    const r = scoreMeshQuality(rightTriangleMesh());
    expect(['good', 'acceptable']).toContain(r.perElement[0]!.grade);
  });

  it('sliver triangle → poor or failing', () => {
    const r = scoreMeshQuality(sliverMesh());
    expect(['poor', 'failing']).toContain(r.perElement[0]!.grade);
  });

  it('equilateral has skewness ~0', () => {
    const r = scoreMeshQuality(equilateralMesh());
    expect(r.perElement[0]!.skewness).toBeLessThan(0.05);
  });

  it('right triangle min angle ≈ 45', () => {
    const r = scoreMeshQuality(rightTriangleMesh());
    expect(r.perElement[0]!.minAngleDeg).toBeCloseTo(45, 1);
  });

  it('average quality between 0 and 1', () => {
    const r = scoreMeshQuality(equilateralMesh());
    expect(r.averageQuality).toBeGreaterThanOrEqual(0);
    expect(r.averageQuality).toBeLessThanOrEqual(1);
  });

  it('worst element id is valid', () => {
    const mesh: MeshArrays = {
      positions: [0, 0, 0, 1, 0, 0, 0.5, Math.sqrt(3) / 2, 0, 100, 0, 0, 50, 0.05, 0, 0, 0, 0],
      indices: [0, 1, 2, 3, 4, 5],
    };
    const r = scoreMeshQuality(mesh);
    expect(r.worstElementId).toBeGreaterThanOrEqual(0);
    expect(r.worstElementId).toBeLessThan(2);
  });

  it('aspect ratio of equilateral is 1', () => {
    const r = scoreMeshQuality(equilateralMesh());
    expect(r.perElement[0]!.aspectRatio).toBeCloseTo(1, 3);
  });

  it('histogram bins sum to element count', () => {
    const r = scoreMeshQuality(equilateralMesh());
    const sum = Object.values(r.histogram).reduce((s, v) => s + v, 0);
    expect(sum).toBe(1);
  });

  it('problemFraction = (poor + failing) / total', () => {
    const r = scoreMeshQuality(sliverMesh());
    expect(r.problemFraction).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('empty mesh', () => {
    const r = scoreMeshQuality({ positions: [], indices: [] });
    const s = summarize(r);
    expect(s.elementCount).toBe(0);
    expect(s.failingCount).toBe(0);
  });

  it('excellent mesh has high excellentFraction', () => {
    const r = scoreMeshQuality(equilateralMesh());
    const s = summarize(r);
    expect(s.excellentFraction).toBe(1);
  });

  it('failing mesh reported in summary', () => {
    const r = scoreMeshQuality(sliverMesh());
    const s = summarize(r);
    expect(s.failingCount + r.histogram.poor).toBeGreaterThan(0);
  });

  it('reports overall grade', () => {
    const r = scoreMeshQuality(equilateralMesh());
    const s = summarize(r);
    expect(s.overallGrade).toBe(r.overallGrade);
  });
});
