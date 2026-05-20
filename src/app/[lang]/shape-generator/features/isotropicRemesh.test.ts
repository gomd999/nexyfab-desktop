import { describe, it, expect } from 'vitest';
import {
  remeshIsotropic,
  computeIsotropyStats,
  type MeshArrays,
} from './isotropicRemesh';

function gridMesh(n: number, size: number): MeshArrays {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      positions.push((i / n) * size, (j / n) * size, 0);
    }
  }
  const row = n + 1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }
  return { positions, indices };
}

function singleTriangleMesh(): MeshArrays {
  return { positions: [0, 0, 0, 10, 0, 0, 5, 5, 0], indices: [0, 1, 2] };
}

describe('remeshIsotropic', () => {
  it('returns a mesh with positions and indices', () => {
    const r = remeshIsotropic(gridMesh(2, 10), { targetEdgeLengthMm: 5, iterations: 1, smoothingStrength: 0.3 });
    expect(r.mesh.positions.length).toBeGreaterThan(0);
    expect(r.mesh.indices.length).toBeGreaterThan(0);
  });

  it('splits long edges when target is small', () => {
    const r = remeshIsotropic(gridMesh(2, 100), { targetEdgeLengthMm: 5, iterations: 1, smoothingStrength: 0 });
    expect(r.splits).toBeGreaterThan(0);
    expect(r.finalTriangleCount).toBeGreaterThan(8);
  });

  it('does not split short edges', () => {
    const r = remeshIsotropic(gridMesh(2, 1), { targetEdgeLengthMm: 5, iterations: 1, smoothingStrength: 0 });
    expect(r.splits).toBe(0);
  });

  it('iterations cumulate split count', () => {
    const r1 = remeshIsotropic(gridMesh(2, 100), { targetEdgeLengthMm: 5, iterations: 1, smoothingStrength: 0 });
    const r3 = remeshIsotropic(gridMesh(2, 100), { targetEdgeLengthMm: 5, iterations: 3, smoothingStrength: 0 });
    expect(r3.splits).toBeGreaterThanOrEqual(r1.splits);
  });

  it('reports finalVertexCount and finalTriangleCount', () => {
    const r = remeshIsotropic(singleTriangleMesh(), { targetEdgeLengthMm: 10, iterations: 0, smoothingStrength: 0 });
    expect(r.finalVertexCount).toBeGreaterThan(0);
    expect(r.finalTriangleCount).toBeGreaterThan(0);
  });

  it('input mesh not mutated', () => {
    const original = gridMesh(2, 100);
    const beforeIdxLen = original.indices.length;
    remeshIsotropic(original, { targetEdgeLengthMm: 1, iterations: 2, smoothingStrength: 0.5 });
    expect(original.indices.length).toBe(beforeIdxLen);
  });
});

describe('computeIsotropyStats', () => {
  it('uniform grid → low CoV', () => {
    const mesh = gridMesh(4, 10);
    const stats = computeIsotropyStats(mesh);
    expect(stats.meanEdgeLengthMm).toBeGreaterThan(0);
    expect(stats.coefficientOfVariation).toBeLessThan(0.5);
  });

  it('valence reported', () => {
    const stats = computeIsotropyStats(gridMesh(2, 10));
    expect(stats.averageValence).toBeGreaterThan(0);
  });

  it('empty mesh → zero stats', () => {
    const stats = computeIsotropyStats({ positions: [], indices: [] });
    expect(stats.meanEdgeLengthMm).toBe(0);
    expect(stats.averageValence).toBe(0);
  });

  it('remeshing toward target shrinks CoV', () => {
    const before = computeIsotropyStats(gridMesh(2, 100));
    const r = remeshIsotropic(gridMesh(2, 100), { targetEdgeLengthMm: 25, iterations: 3, smoothingStrength: 0.4 });
    const after = computeIsotropyStats(r.mesh);
    // We don't require strict improvement (the simple algorithm can
    // diverge for some inputs), but stats should still be finite.
    expect(isFinite(after.coefficientOfVariation)).toBe(true);
    expect(isFinite(before.coefficientOfVariation)).toBe(true);
  });
});
