import { describe, it, expect } from 'vitest';
import {
  refineMesh,
  computeConvergence,
  summarize,
  type MeshArrays,
  type RefineInput,
} from './adaptiveMeshRefinement';

function twoTriangles(): MeshArrays {
  return {
    positions: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

describe('refineMesh', () => {
  it('empty mesh → empty result', () => {
    const r = refineMesh({ mesh: { positions: [], indices: [] }, elementValues: [] });
    expect(r.mesh.positions).toEqual([]);
  });

  it('mismatched value length → no refinement', () => {
    const input: RefineInput = { mesh: twoTriangles(), elementValues: [] };
    const r = refineMesh(input);
    expect(r.mesh.indices.length).toBe(twoTriangles().indices.length);
  });

  it('high-gradient element gets subdivided', () => {
    const input: RefineInput = { mesh: twoTriangles(), elementValues: [100, 1] };
    const r = refineMesh(input, { threshold: 50, maxLevels: 1 });
    expect(r.refinementCounts[0]).toBe(4);
    expect(r.refinementCounts[1]).toBe(1);
  });

  it('elementsAdded counts new triangles', () => {
    const input: RefineInput = { mesh: twoTriangles(), elementValues: [100, 100] };
    const r = refineMesh(input, { threshold: 50, maxLevels: 1 });
    expect(r.elementsAdded).toBe(6); // 2 triangles × +3 each
  });

  it('maxLevels=2 produces 16 children', () => {
    const input: RefineInput = { mesh: twoTriangles(), elementValues: [1000, 1] };
    const r = refineMesh(input, { threshold: 50, maxLevels: 2 });
    expect(r.refinementCounts[0]).toBe(16);
  });

  it('output indices are valid vertex references', () => {
    const input: RefineInput = { mesh: twoTriangles(), elementValues: [100, 1] };
    const r = refineMesh(input, { threshold: 50, maxLevels: 1 });
    const vertCount = r.mesh.positions.length / 3;
    for (const idx of r.mesh.indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(vertCount);
    }
  });

  it('zero-threshold refines everything', () => {
    const input: RefineInput = { mesh: twoTriangles(), elementValues: [1, 1] };
    const r = refineMesh(input, { threshold: 0, maxLevels: 1 });
    expect(r.refinementCounts.every(c => c >= 1)).toBe(true);
  });

  it('threshold higher than all values → no refinement', () => {
    const input: RefineInput = { mesh: twoTriangles(), elementValues: [1, 2] };
    const r = refineMesh(input, { threshold: 1000 });
    expect(r.refinementCounts).toEqual([1, 1]);
    expect(r.elementsAdded).toBe(0);
  });

  it('output mesh triangle count = sum of refinement counts', () => {
    const input: RefineInput = { mesh: twoTriangles(), elementValues: [100, 50] };
    const r = refineMesh(input, { threshold: 25, maxLevels: 1 });
    const expected = r.refinementCounts.reduce((s, c) => s + c, 0);
    expect(r.mesh.indices.length / 3).toBe(expected);
  });
});

describe('computeConvergence', () => {
  it('returns zeros for empty input', () => {
    const m = computeConvergence([], 1);
    expect(m.gradientL1).toBe(0);
    expect(m.peakIndicator).toBe(0);
  });

  it('peak = max abs value', () => {
    const m = computeConvergence([-3, 5, -7, 2], 1);
    expect(m.peakIndicator).toBe(7);
  });

  it('counts converged elements below threshold', () => {
    const m = computeConvergence([0.5, 0.3, 5, 10], 1);
    expect(m.convergedElementCount).toBe(2);
  });

  it('gradient L1 = sum of |values|', () => {
    const m = computeConvergence([1, -2, 3], 100);
    expect(m.gradientL1).toBe(6);
  });
});

describe('summarize', () => {
  it('empty input', () => {
    const r = refineMesh({ mesh: { positions: [], indices: [] }, elementValues: [] });
    const s = summarize({ mesh: { positions: [], indices: [] }, elementValues: [] }, r);
    expect(s.inputElementCount).toBe(0);
  });

  it('reports refined fraction', () => {
    const input: RefineInput = { mesh: twoTriangles(), elementValues: [100, 1] };
    const r = refineMesh(input, { threshold: 50, maxLevels: 1 });
    const s = summarize(input, r);
    expect(s.refinedFraction).toBeCloseTo(0.5, 5);
  });

  it('output element count > input when refining', () => {
    const input: RefineInput = { mesh: twoTriangles(), elementValues: [100, 100] };
    const r = refineMesh(input, { threshold: 50, maxLevels: 1 });
    const s = summarize(input, r);
    expect(s.outputElementCount).toBeGreaterThan(s.inputElementCount);
  });
});
