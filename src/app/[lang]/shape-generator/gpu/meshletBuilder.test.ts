import { describe, it, expect } from 'vitest';
import {
  buildMeshlets,
  buildMeshletCones,
  validateMeshlets,
  type MeshArrays,
} from './meshletBuilder';

function unitQuad(): MeshArrays {
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

/** N×N grid of quads, each split into 2 triangles. */
function grid(n: number): MeshArrays {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      positions.push(i, j, 0);
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

describe('buildMeshlets', () => {
  it('small quad → 1 meshlet', () => {
    const r = buildMeshlets(unitQuad());
    expect(r.meshlets).toHaveLength(1);
    expect(r.meshlets[0]!.vertexCount).toBe(4);
    expect(r.meshlets[0]!.triangleCount).toBe(2);
  });

  it('empty mesh → 0 meshlets', () => {
    const r = buildMeshlets({ positions: [], indices: [] });
    expect(r.meshlets).toHaveLength(0);
  });

  it('respects maxVertices cap', () => {
    const r = buildMeshlets(grid(10), { maxVertices: 32, maxTriangles: 124 });
    for (const m of r.meshlets) {
      expect(m.vertexCount).toBeLessThanOrEqual(32);
    }
  });

  it('respects maxTriangles cap', () => {
    const r = buildMeshlets(grid(10), { maxVertices: 64, maxTriangles: 16 });
    for (const m of r.meshlets) {
      expect(m.triangleCount).toBeLessThanOrEqual(16);
    }
  });

  it('total triangle count equals input', () => {
    const m = grid(8);
    const r = buildMeshlets(m, { maxVertices: 32, maxTriangles: 16 });
    const total = r.meshlets.reduce((s, x) => s + x.triangleCount, 0);
    expect(total).toBe(m.indices.length / 3);
  });

  it('local triangle indices < vertexCount', () => {
    const r = buildMeshlets(grid(5), { maxVertices: 16, maxTriangles: 8 });
    for (const m of r.meshlets) {
      for (let i = 0; i < m.triangleCount * 3; i++) {
        const idx = r.triangleIndices[m.triangleOffset + i]!;
        expect(idx).toBeLessThan(m.vertexCount);
      }
    }
  });

  it('bounding sphere radius > 0 for non-degenerate', () => {
    const r = buildMeshlets(unitQuad());
    expect(r.meshlets[0]!.radiusMm).toBeGreaterThan(0);
  });
});

describe('buildMeshletCones', () => {
  it('returns one cone per meshlet', () => {
    const r = buildMeshlets(unitQuad());
    const cones = buildMeshletCones(unitQuad(), r);
    expect(cones).toHaveLength(r.meshlets.length);
  });

  it('cone axis is unit length', () => {
    const r = buildMeshlets(unitQuad());
    const cones = buildMeshletCones(unitQuad(), r);
    for (const c of cones) {
      const len = Math.hypot(c.axis[0], c.axis[1], c.axis[2]);
      expect(len).toBeCloseTo(1, 5);
    }
  });
});

describe('validateMeshlets', () => {
  it('default build → valid', () => {
    const r = buildMeshlets(unitQuad());
    expect(validateMeshlets(r).valid).toBe(true);
  });

  it('flags meshlet exceeding cap', () => {
    // Construct an invalid result by hand.
    const fake = {
      meshlets: [{
        vertexOffset: 0, vertexCount: 100, triangleOffset: 0, triangleCount: 50,
        centerMm: [0, 0, 0] as [number, number, number], radiusMm: 1,
      }],
      vertexIndices: new Uint32Array(100),
      triangleIndices: new Uint8Array(150),
      stats: { meshletCount: 1, averageVerticesPerMeshlet: 100, averageTrianglesPerMeshlet: 50, totalVertexReferences: 100 },
    };
    const r = validateMeshlets(fake);
    expect(r.valid).toBe(false);
  });
});

describe('build stats', () => {
  it('stats counts match', () => {
    const r = buildMeshlets(grid(5), { maxVertices: 32, maxTriangles: 16 });
    expect(r.stats.meshletCount).toBe(r.meshlets.length);
    expect(r.stats.averageTrianglesPerMeshlet).toBeGreaterThan(0);
  });
});
