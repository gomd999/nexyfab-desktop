import { describe, it, expect } from 'vitest';
import {
  repairMesh,
  triangleArea,
  edgeRatio,
  summarize,
  type MeshArrays,
} from './stlRepairDegenerate';

function cleanTriangle(): MeshArrays {
  return { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
}

function withDuplicateVertices(): MeshArrays {
  return {
    positions: [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 0, // duplicate of vertex 0
      2, 0, 0,
    ],
    indices: [0, 1, 2, 3, 4, 2],
  };
}

function withZeroAreaTriangle(): MeshArrays {
  return {
    positions: [0, 0, 0, 1, 0, 0, 0.5, 0, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 1, 3], // first triangle is collinear (zero area)
  };
}

describe('repairMesh', () => {
  it('empty input → empty output', () => {
    const r = repairMesh({ positions: [], indices: [] });
    expect(r.mesh.positions).toEqual([]);
    expect(r.triangleCountAfter).toBe(0);
  });

  it('clean mesh passes through unchanged', () => {
    const r = repairMesh(cleanTriangle());
    expect(r.triangleCountAfter).toBe(1);
    expect(r.zeroAreaTriangleCount).toBe(0);
  });

  it('duplicate vertices are merged', () => {
    const r = repairMesh(withDuplicateVertices());
    expect(r.mergedVertexCount).toBe(1);
    expect(r.vertexCountAfter).toBe(4);
  });

  it('zero-area triangles are dropped', () => {
    const r = repairMesh(withZeroAreaTriangle());
    expect(r.zeroAreaTriangleCount).toBe(1);
    expect(r.triangleCountAfter).toBe(1);
  });

  it('mergeEpsilonMm controls merge tolerance', () => {
    const mesh: MeshArrays = {
      positions: [0, 0, 0, 0.001, 0, 0, 1, 0, 0, 0, 1, 0],
      indices: [0, 2, 3, 1, 2, 3],
    };
    const loose = repairMesh(mesh, { mergeEpsilonMm: 0.01 });
    const tight = repairMesh(mesh, { mergeEpsilonMm: 1e-6 });
    expect(loose.mergedVertexCount).toBeGreaterThan(tight.mergedVertexCount);
  });

  it('triangles with collapsed vertices are reported as duplicate', () => {
    const mesh: MeshArrays = {
      positions: [0, 0, 0, 1, 0, 0, 0, 0, 0],
      indices: [0, 1, 2],
    };
    const r = repairMesh(mesh);
    expect(r.duplicateVertexTriangleCount).toBe(1);
    expect(r.triangleCountAfter).toBe(0);
  });

  it('dropSlivers removes sliver triangles', () => {
    const mesh: MeshArrays = {
      // 1 long edge (100), 1 short edge (0.01), 1 medium (~100). Ratio 100/0.01 = 10000.
      positions: [0, 0, 0, 100, 0, 0, 0.01, 0.001, 0],
      indices: [0, 1, 2],
    };
    const keep = repairMesh(mesh, { dropSlivers: false });
    const drop = repairMesh(mesh, { dropSlivers: true });
    expect(keep.triangleCountAfter).toBe(1);
    expect(drop.triangleCountAfter).toBe(0);
    expect(drop.sliverTriangleCount).toBe(1);
  });

  it('produces valid indices into new vertex array', () => {
    const r = repairMesh(withDuplicateVertices());
    for (const idx of r.mesh.indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(r.vertexCountAfter);
    }
  });
});

describe('triangleArea', () => {
  it('right triangle has area 0.5', () => {
    expect(triangleArea([0, 0, 0], [1, 0, 0], [0, 1, 0])).toBeCloseTo(0.5, 5);
  });

  it('degenerate triangle has area 0', () => {
    expect(triangleArea([0, 0, 0], [0, 0, 0], [0, 0, 0])).toBe(0);
  });

  it('collinear triangle has area 0', () => {
    expect(triangleArea([0, 0, 0], [1, 0, 0], [2, 0, 0])).toBeCloseTo(0, 5);
  });
});

describe('edgeRatio', () => {
  it('equilateral triangle has ratio 1', () => {
    const r = edgeRatio([0, 0, 0], [1, 0, 0], [0.5, Math.sqrt(3) / 2, 0]);
    expect(r).toBeCloseTo(1, 3);
  });

  it('sliver triangle has high ratio', () => {
    const r = edgeRatio([0, 0, 0], [100, 0, 0], [0.01, 0.001, 0]);
    expect(r).toBeGreaterThan(100);
  });

  it('zero-length edge returns Infinity', () => {
    const r = edgeRatio([0, 0, 0], [0, 0, 0], [1, 0, 0]);
    expect(r).toBe(Infinity);
  });
});

describe('summarize', () => {
  it('reports input/output triangle counts', () => {
    const original = withZeroAreaTriangle();
    const r = repairMesh(original);
    const s = summarize(original, r);
    expect(s.inputTriangles).toBe(2);
    expect(s.outputTriangles).toBe(1);
    expect(s.trianglesRemoved).toBe(1);
  });

  it('flags non-empty result as processable', () => {
    const s = summarize(cleanTriangle(), repairMesh(cleanTriangle()));
    expect(s.cleanEnoughToProcess).toBe(true);
  });

  it('empty result flagged not processable', () => {
    const s = summarize({ positions: [], indices: [] }, repairMesh({ positions: [], indices: [] }));
    expect(s.cleanEnoughToProcess).toBe(false);
  });
});
