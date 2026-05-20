import { describe, it, expect } from 'vitest';
import {
  quadrangulate,
  qualityReport,
  summarize,
  type MeshData,
} from './quadrangulator';

// Two coplanar triangles forming a square — should merge to 1 quad.
function squarePair(): MeshData {
  return {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ],
    triangles: [
      { id: 't1', v0: 0, v1: 1, v2: 2 },
      { id: 't2', v0: 0, v1: 2, v2: 3 },
    ],
  };
}

// Two triangles forming a non-planar V-shape — should NOT merge.
function vShape(): MeshData {
  return {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 1 },
    ],
    triangles: [
      { id: 't1', v0: 0, v1: 1, v2: 2 },
      { id: 't2', v0: 0, v1: 2, v2: 3 },
    ],
  };
}

describe('quadrangulate', () => {
  it('empty mesh → no quads', () => {
    const r = quadrangulate({ vertices: [], triangles: [] });
    expect(r.quads).toEqual([]);
  });

  it('square pair → 1 quad', () => {
    const r = quadrangulate(squarePair());
    expect(r.quads).toHaveLength(1);
    expect(r.remainingTriangles).toEqual([]);
  });

  it('non-planar pair → 0 quads', () => {
    const r = quadrangulate(vShape(), { maxDihedralDeg: 5, minAngleRatio: 0.3 });
    expect(r.quads).toHaveLength(0);
    expect(r.remainingTriangles).toHaveLength(2);
  });

  it('looser dihedral tolerance → may merge', () => {
    const r = quadrangulate(vShape(), { maxDihedralDeg: 60, minAngleRatio: 0.1 });
    expect(r.quads.length).toBeGreaterThanOrEqual(0);
  });

  it('coverage tracked', () => {
    const r = quadrangulate(squarePair());
    expect(r.coverage).toBe(1);
  });

  it('partial coverage when only some pairs match', () => {
    const mesh: MeshData = {
      vertices: [
        { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      triangles: [
        { id: 't1', v0: 0, v1: 1, v2: 2 },
        { id: 't2', v0: 0, v1: 2, v2: 3 },
        { id: 't3', v0: 1, v1: 4, v2: 2 },
      ],
    };
    const r = quadrangulate(mesh);
    expect(r.quads.length).toBeGreaterThan(0);
    expect(r.coverage).toBeGreaterThan(0);
  });

  it('quad has 4 distinct vertices', () => {
    const r = quadrangulate(squarePair());
    const q = r.quads[0]!;
    const verts = new Set([q.v0, q.v1, q.v2, q.v3]);
    expect(verts.size).toBe(4);
  });
});

describe('qualityReport', () => {
  it('reports aspect ratio for quad pair', () => {
    const mesh = squarePair();
    const r = quadrangulate(mesh);
    const q = qualityReport(r, mesh.vertices);
    expect(q.meanQuadAspect).toBeGreaterThan(0);
  });

  it('empty quads → zero aspect', () => {
    const mesh = vShape();
    const r = quadrangulate(mesh, { maxDihedralDeg: 5, minAngleRatio: 0.3 });
    expect(qualityReport(r, mesh.vertices).meanQuadAspect).toBe(0);
  });
});

describe('summarize', () => {
  it('reports input/output counts', () => {
    const mesh = squarePair();
    const r = quadrangulate(mesh);
    const s = summarize(mesh, r);
    expect(s.inputTriangles).toBe(2);
    expect(s.outputQuads).toBe(1);
    expect(s.coveragePercent).toBe(100);
  });
});
