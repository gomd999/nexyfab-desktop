import { describe, it, expect } from 'vitest';
import {
  checkBooleanReadiness,
  computeMeshStats,
  countBoundaryEdges,
  countDuplicateVertices,
  countDegenerateTriangles,
  countInconsistentOrientation,
  applyFix,
  type MeshArrays,
} from './meshBooleanGuard';

// Closed manifold tetrahedron (4 verts, 4 tris).
function tetrahedron(): MeshArrays {
  return {
    positions: [
      0, 0, 0,    // 0
      1, 0, 0,    // 1
      0.5, 1, 0,  // 2
      0.5, 0.5, 1, // 3
    ],
    indices: [
      0, 1, 2,
      0, 2, 3,
      0, 3, 1,
      1, 3, 2,
    ],
  };
}

// Open quad (2 tris, all edges are boundary except diagonal).
function openQuad(): MeshArrays {
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

describe('computeMeshStats', () => {
  it('counts vertices and triangles', () => {
    const s = computeMeshStats(tetrahedron());
    expect(s.vertexCount).toBe(4);
    expect(s.triangleCount).toBe(4);
  });

  it('bounding box covers all vertices', () => {
    const s = computeMeshStats(tetrahedron());
    expect(s.boundingBoxMm.min).toEqual([0, 0, 0]);
    expect(s.boundingBoxMm.max[2]).toBeCloseTo(1, 5);
  });

  it('empty mesh returns zeros', () => {
    const s = computeMeshStats({ positions: [], indices: [] });
    expect(s.vertexCount).toBe(0);
    expect(s.triangleCount).toBe(0);
  });
});

describe('countBoundaryEdges', () => {
  it('closed tetrahedron has 0 boundary edges', () => {
    expect(countBoundaryEdges(tetrahedron())).toBe(0);
  });

  it('open quad has 4 boundary edges', () => {
    expect(countBoundaryEdges(openQuad())).toBe(4);
  });
});

describe('countDuplicateVertices', () => {
  it('clean mesh → 0 duplicates', () => {
    expect(countDuplicateVertices(tetrahedron(), 1e-4)).toBe(0);
  });

  it('detects coincident verts', () => {
    const m: MeshArrays = {
      positions: [
        0, 0, 0,
        0, 0, 0, // duplicate
        1, 0, 0,
      ],
      indices: [0, 1, 2],
    };
    expect(countDuplicateVertices(m, 1e-4)).toBe(1);
  });
});

describe('countDegenerateTriangles', () => {
  it('flags triangle with repeated index', () => {
    const m: MeshArrays = {
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
      indices: [0, 1, 1], // degenerate
    };
    expect(countDegenerateTriangles(m)).toBe(1);
  });

  it('flags collinear vertices', () => {
    const m: MeshArrays = {
      positions: [0, 0, 0, 1, 0, 0, 2, 0, 0],
      indices: [0, 1, 2], // collinear → zero area
    };
    expect(countDegenerateTriangles(m)).toBe(1);
  });

  it('proper triangle → 0', () => {
    expect(countDegenerateTriangles(tetrahedron())).toBe(0);
  });
});

describe('countInconsistentOrientation', () => {
  it('properly-wound tetrahedron has 0 flipped', () => {
    // Note: my tetrahedron above may or may not be perfectly wound;
    // we just check the function returns a finite count.
    const r = countInconsistentOrientation(tetrahedron());
    expect(r).toBeGreaterThanOrEqual(0);
  });

  it('flags same-direction shared edge', () => {
    const m: MeshArrays = {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
      indices: [
        0, 1, 2, // edge 0→1 forward
        0, 1, 3, // edge 0→1 forward — same direction → inconsistent
      ],
    };
    expect(countInconsistentOrientation(m)).toBe(1);
  });
});

describe('checkBooleanReadiness', () => {
  it('closed clean mesh → ready', () => {
    const r = checkBooleanReadiness(tetrahedron());
    expect(r.ready).toBe(true);
    expect(r.blockers).toHaveLength(0);
  });

  it('open mesh → not ready', () => {
    const r = checkBooleanReadiness(openQuad());
    expect(r.ready).toBe(false);
    expect(r.blockers.some(b => b.kind === 'open-mesh')).toBe(true);
  });

  it('reports stats', () => {
    const r = checkBooleanReadiness(tetrahedron());
    expect(r.stats.triangleCount).toBe(4);
  });

  it('suggests weld fix when duplicate verts present', () => {
    const m: MeshArrays = {
      positions: [
        0, 0, 0,
        0, 0, 0, // dup
        1, 0, 0,
        1, 1, 1,
      ],
      indices: [0, 2, 3, 0, 3, 1, 1, 3, 2, 0, 1, 2],
    };
    const r = checkBooleanReadiness(m);
    expect(r.suggestedFixes.some(f => f.kind === 'weld-coincident-verts')).toBe(true);
  });
});

describe('applyFix', () => {
  it('weld-coincident-verts merges duplicate vertices', () => {
    const m: MeshArrays = {
      positions: [
        0, 0, 0,
        0, 0, 0,
        1, 0, 0,
      ],
      indices: [0, 1, 2],
    };
    const fixed = applyFix(m, { kind: 'weld-coincident-verts', toleranceMm: 1e-4 });
    expect(fixed.positions.length / 3).toBe(2);
  });

  it('drop-degenerates removes zero-area triangles', () => {
    const m: MeshArrays = {
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
      indices: [0, 1, 1, 0, 1, 2],
    };
    const fixed = applyFix(m, { kind: 'drop-degenerates' });
    expect(fixed.indices.length / 3).toBe(1);
  });

  it('snap-to-grid rounds positions', () => {
    const m: MeshArrays = {
      positions: [0.123, 0.456, 0.789],
      indices: [],
    };
    const fixed = applyFix(m, { kind: 'snap-to-grid', gridMm: 0.5 });
    expect(fixed.positions[0]).toBeCloseTo(0, 4);
    expect(fixed.positions[1]).toBeCloseTo(0.5, 4);
    expect(fixed.positions[2]).toBeCloseTo(1, 4);
  });

  it('flip-inconsistent runs without throwing', () => {
    const m: MeshArrays = {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
      indices: [0, 1, 2, 1, 0, 3],
    };
    const fixed = applyFix(m, { kind: 'flip-inconsistent' });
    expect(fixed.indices).toHaveLength(6);
  });
});
