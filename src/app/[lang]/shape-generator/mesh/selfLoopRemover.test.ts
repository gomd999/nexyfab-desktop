import { describe, it, expect } from 'vitest';
import {
  removeSelfLoops,
  pruneUnusedVertices,
  reportText,
  summarize,
  type MeshData,
} from './selfLoopRemover';

function mesh(): MeshData {
  return {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 0, z: 0.0000001 }, // very close to vertex 0
    ],
    triangles: [
      { id: 't1', v0: 0, v1: 1, v2: 2 }, // valid
      { id: 't2', v0: 0, v1: 1, v2: 1 }, // index dup
      { id: 't3', v0: 0, v1: 1, v2: 4 }, // spatial coincidence (4 ≈ 0)
      { id: 't4', v0: 0, v1: 1, v2: 3 }, // valid
    ],
  };
}

describe('removeSelfLoops', () => {
  it('empty mesh → empty result', () => {
    const r = removeSelfLoops({ vertices: [], triangles: [] });
    expect(r.cleanedTriangles).toEqual([]);
    expect(r.removed).toEqual([]);
  });

  it('removes index-duplicate triangle', () => {
    const r = removeSelfLoops(mesh());
    expect(r.removed.some(x => x.triangleId === 't2' && x.kind === 'index-duplicate')).toBe(true);
  });

  it('removes spatial-coincidence triangle', () => {
    const r = removeSelfLoops(mesh(), { coincidenceToleranceMm: 0.001, minAreaMm2: 1e-9 });
    expect(r.removed.some(x => x.triangleId === 't3' && x.kind === 'spatial-coincidence')).toBe(true);
  });

  it('keeps valid triangles', () => {
    const r = removeSelfLoops(mesh());
    expect(r.cleanedTriangles.some(t => t.id === 't1')).toBe(true);
    expect(r.cleanedTriangles.some(t => t.id === 't4')).toBe(true);
  });

  it('removedByKind counts', () => {
    const r = removeSelfLoops(mesh(), { coincidenceToleranceMm: 0.001, minAreaMm2: 1e-9 });
    expect(r.removedByKind['index-duplicate']).toBe(1);
    expect(r.removedByKind['spatial-coincidence']).toBe(1);
  });

  it('zero-area triangle detected', () => {
    const collinear: MeshData = {
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      triangles: [{ id: 't1', v0: 0, v1: 1, v2: 2 }],
    };
    const r = removeSelfLoops(collinear, { coincidenceToleranceMm: 0.0001, minAreaMm2: 0.001 });
    expect(r.removed[0]!.kind).toBe('zero-area');
  });

  it('out-of-range vertex index → index-duplicate (defensive)', () => {
    const bad: MeshData = {
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      triangles: [{ id: 't1', v0: 0, v1: 1, v2: 999 }],
    };
    const r = removeSelfLoops(bad);
    expect(r.removed.length).toBe(1);
  });
});

describe('pruneUnusedVertices', () => {
  it('prunes vertices not referenced by cleaned triangles', () => {
    const m: MeshData = {
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 99, y: 99, z: 99 }, // unused
      ],
      triangles: [{ id: 't1', v0: 0, v1: 1, v2: 2 }],
    };
    const cleaned = removeSelfLoops(m).cleanedTriangles;
    const pruned = pruneUnusedVertices(m, cleaned);
    expect(pruned.vertices).toHaveLength(3);
    expect(pruned.triangles[0]!.v2).toBe(2);
  });

  it('preserves used vertices unchanged', () => {
    const m: MeshData = {
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
      triangles: [{ id: 't1', v0: 0, v1: 1, v2: 2 }],
    };
    const pruned = pruneUnusedVertices(m, m.triangles);
    expect(pruned.vertices).toHaveLength(3);
  });
});

describe('reportText', () => {
  it('zero removed → "No degenerate"', () => {
    const r = removeSelfLoops({ vertices: [], triangles: [] });
    expect(reportText(r)).toContain('No degenerate');
  });

  it('removed reports kinds', () => {
    const r = removeSelfLoops(mesh());
    expect(reportText(r)).toContain('Removed');
  });
});

describe('summarize', () => {
  it('reports counts + fraction', () => {
    const m = mesh();
    const r = removeSelfLoops(m, { coincidenceToleranceMm: 0.001, minAreaMm2: 1e-9 });
    const s = summarize(m, r);
    expect(s.originalCount).toBe(4);
    expect(s.removedFraction).toBeGreaterThan(0);
  });

  it('empty mesh → fraction 0', () => {
    const r = removeSelfLoops({ vertices: [], triangles: [] });
    expect(summarize({ vertices: [], triangles: [] }, r).removedFraction).toBe(0);
  });
});
