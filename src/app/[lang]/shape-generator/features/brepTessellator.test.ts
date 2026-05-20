import { describe, it, expect } from 'vitest';
import {
  tessellateBrep,
  triangulatePolygon,
  estimateChordSubdivisions,
  pickLodChordTolerance,
  evaluateMeshQuality,
} from './brepTessellator';
import {
  BrepModel,
  createVertex,
  createEdgePair,
  createFace,
  type Vec3,
} from './halfEdgeBrep';

function buildTriangleModel() {
  const m = new BrepModel();
  const shell = m.newShell();
  const v0 = createVertex(m, shell, [0, 0, 0]);
  const v1 = createVertex(m, shell, [1, 0, 0]);
  const v2 = createVertex(m, shell, [0, 1, 0]);
  const e01 = createEdgePair(m, shell, v0, v1);
  const e12 = createEdgePair(m, shell, v1, v2);
  const e20 = createEdgePair(m, shell, v2, v0);
  e01.next = e12; e12.prev = e01;
  e12.next = e20; e20.prev = e12;
  e20.next = e01; e01.prev = e20;
  const face = createFace(m, shell, e01);
  face.normal = [0, 0, 1];
  return m;
}

describe('triangulatePolygon', () => {
  it('triangle is identity', () => {
    const verts: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    expect(triangulatePolygon(verts, [0, 0, 1])).toEqual([[0, 1, 2]]);
  });

  it('quad → 2 triangles', () => {
    const verts: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
    const tris = triangulatePolygon(verts, [0, 0, 1]);
    expect(tris).toHaveLength(2);
  });

  it('pentagon → 3 triangles', () => {
    const verts: Vec3[] = [
      [0, 0, 0], [2, 0, 0], [3, 2, 0], [1, 3, 0], [-1, 2, 0],
    ];
    expect(triangulatePolygon(verts, [0, 0, 1])).toHaveLength(3);
  });

  it('all triangle indices reference valid vertices', () => {
    const verts: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
    const tris = triangulatePolygon(verts, [0, 0, 1]);
    for (const t of tris) {
      for (const idx of t) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(verts.length);
      }
    }
  });

  it('empty for < 3 vertices', () => {
    expect(triangulatePolygon([[0, 0, 0], [1, 0, 0]], [0, 0, 1])).toEqual([]);
  });
});

describe('tessellateBrep', () => {
  it('triangle face yields 1 triangle + 3 vertices', () => {
    const m = buildTriangleModel();
    const { mesh, stats } = tessellateBrep(m);
    expect(stats.triangleCount).toBe(1);
    expect(stats.vertexCount).toBe(3);
    expect(stats.successFaces).toBe(1);
  });

  it('triangleFaceIds map references the face', () => {
    const m = buildTriangleModel();
    const { mesh } = tessellateBrep(m);
    expect(mesh.triangleFaceIds).toHaveLength(1);
    expect(mesh.triangleFaceIds[0]).toMatch(/^f-/);
  });

  it('empty model → empty mesh', () => {
    const m = new BrepModel();
    const { mesh, stats } = tessellateBrep(m);
    expect(stats.triangleCount).toBe(0);
    expect(mesh.indices.length).toBe(0);
  });

  it('normals length = positions length', () => {
    const m = buildTriangleModel();
    const { mesh } = tessellateBrep(m);
    expect(mesh.normals.length).toBe(mesh.positions.length);
  });
});

describe('estimateChordSubdivisions', () => {
  it('R=10 half-circle, tol=0.1 → many subdivisions', () => {
    const n = estimateChordSubdivisions(10, Math.PI, 0.1);
    expect(n).toBeGreaterThan(10);
  });

  it('tighter tolerance → more subdivisions', () => {
    const loose = estimateChordSubdivisions(10, Math.PI, 0.5);
    const tight = estimateChordSubdivisions(10, Math.PI, 0.01);
    expect(tight).toBeGreaterThan(loose);
  });

  it('zero radius → 1', () => {
    expect(estimateChordSubdivisions(0, Math.PI, 0.1)).toBe(1);
  });

  it('tolerance >= radius → saturates at max subdivisions', () => {
    expect(estimateChordSubdivisions(1, Math.PI, 10)).toBe(32);
  });
});

describe('pickLodChordTolerance', () => {
  it('larger model → larger tolerance', () => {
    const small = pickLodChordTolerance(10, 50);
    const large = pickLodChordTolerance(1000, 50);
    expect(large).toBeGreaterThan(small);
  });

  it('clamps to [0.01, 2]', () => {
    expect(pickLodChordTolerance(1, 1e9)).toBeGreaterThanOrEqual(0.01);
    expect(pickLodChordTolerance(1e9, 1)).toBeLessThanOrEqual(2);
  });
});

describe('evaluateMeshQuality', () => {
  it('equilateral triangle has aspect ratio = 1', () => {
    const mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0.5, Math.sqrt(3) / 2, 0]),
      indices: new Uint32Array([0, 1, 2]),
      normals: new Float32Array(9),
      triangleFaceIds: ['f'],
    };
    const q = evaluateMeshQuality(mesh);
    expect(q.meanAspectRatio).toBeCloseTo(1, 4);
    expect(q.slivers).toBe(0);
  });

  it('sliver triangle is flagged', () => {
    // Very long-and-thin triangle: short edge 0.001, long edge ≈5.
    const mesh = {
      positions: new Float32Array([0, 0, 0, 0.001, 0, 0, 5, 0, 0]),
      indices: new Uint32Array([0, 1, 2]),
      normals: new Float32Array(9),
      triangleFaceIds: ['f'],
    };
    const q = evaluateMeshQuality(mesh, 5);
    expect(q.slivers).toBeGreaterThan(0);
    expect(q.worstAspectRatio).toBeGreaterThan(10);
  });

  it('empty mesh returns 1', () => {
    const mesh = {
      positions: new Float32Array(0),
      indices: new Uint32Array(0),
      normals: new Float32Array(0),
      triangleFaceIds: [],
    };
    expect(evaluateMeshQuality(mesh).meanAspectRatio).toBe(1);
  });
});
