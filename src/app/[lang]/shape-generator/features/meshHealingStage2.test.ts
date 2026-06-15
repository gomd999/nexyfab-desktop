import { describe, it, expect } from 'vitest';
import {
  analyzeManifold,
  detectBoundaryLoops,
  fillHole,
  consistentNormals,
  healMeshStage2,
} from './meshHealingStage2';

/** Closed unit cube: 12 triangles, all edges shared by 2 tris. */
function closedCubeIndices(): number[] {
  return [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    2, 3, 7, 2, 7, 6,
    1, 2, 6, 1, 6, 5,
    0, 4, 7, 0, 7, 3,
  ];
}

function cubePositions(): number[] {
  return [
    0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
    0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
  ];
}

describe('analyzeManifold', () => {
  it('closed cube is manifold', () => {
    const r = analyzeManifold(closedCubeIndices());
    expect(r.isManifold).toBe(true);
    expect(r.boundaryEdges).toHaveLength(0);
    expect(r.nonManifoldEdges).toHaveLength(0);
  });

  it('detects boundary edges when bottom is removed', () => {
    // Drop the bottom two triangles (indices 0, 2, 1 / 0, 3, 2).
    const idx = closedCubeIndices().slice(6); // start at top
    const r = analyzeManifold(idx);
    expect(r.boundaryEdges.length).toBeGreaterThan(0);
    expect(r.isManifold).toBe(false);
  });

  it('flags non-manifold edges when an edge is used 3 times', () => {
    // 3 triangles sharing edge 0-1.
    const idx = [
      0, 1, 2,
      0, 1, 3,
      0, 1, 4,
    ];
    const r = analyzeManifold(idx);
    expect(r.nonManifoldEdges.length).toBeGreaterThan(0);
  });
});

describe('detectBoundaryLoops', () => {
  it('returns a single loop for an open cube bottom', () => {
    // Remove the bottom face → 4-vertex boundary loop.
    const idx = closedCubeIndices().slice(6);
    const r = analyzeManifold(idx);
    const loops = detectBoundaryLoops(r.boundaryEdges);
    expect(loops.length).toBeGreaterThan(0);
    expect(loops[0]!.length).toBeGreaterThanOrEqual(3);
  });

  it('empty boundary → no loops', () => {
    expect(detectBoundaryLoops([])).toEqual([]);
  });
});

describe('fillHole', () => {
  it('adds N triangles for a loop of N vertices', () => {
    const positions = cubePositions();
    const r = fillHole(positions, [], [0, 1, 2, 3]);
    expect(r.addedTriangles).toBe(4);
    expect(r.indices.length).toBe(12);
  });

  it('inserts one new centroid vertex', () => {
    const positions = cubePositions();
    const before = positions.length / 3;
    const r = fillHole(positions, [], [0, 1, 2, 3]);
    expect(r.positions.length / 3).toBe(before + 1);
  });

  it('skips degenerate loops (< 3 vertices)', () => {
    const r = fillHole(cubePositions(), [], [0, 1]);
    expect(r.addedTriangles).toBe(0);
  });
});

describe('consistentNormals', () => {
  it('handles single-triangle mesh', () => {
    const r = consistentNormals([0, 1, 2]);
    expect(r.flippedCount).toBe(0);
  });

  it('flips disagreeing neighbour', () => {
    // Two triangles sharing edge 1-2. T0 = (0,1,2) traverses edge 1→2.
    // T1 = (1,2,3) also traverses edge 1→2 (same direction = inconsistent).
    const r = consistentNormals([0, 1, 2,  1, 2, 3]);
    expect(r.flippedCount).toBe(1);
    // After flip, T1 should be (1, 3, 2) — traverses edge 2→1 (opposite).
    expect(r.indices.slice(3)).toEqual([1, 3, 2]);
  });

  it('leaves consistent mesh alone', () => {
    // T0 = (0,1,2) traverses 1→2. T1 = (1,3,2) traverses 2→1 (consistent).
    const r = consistentNormals([0, 1, 2,  1, 3, 2]);
    expect(r.flippedCount).toBe(0);
  });

  it('harmonises EVERY disconnected component, not just the one with triangle 0', () => {
    // Two shells that share no vertices (a multi-body / multi-solid import).
    // Component A (verts 0–3) is already consistent. Component B (verts 4–7)
    // has its second triangle wound the wrong way on the shared edge 4–6.
    // A single-seed BFS would only ever reach component A and leave B's bad
    // winding untouched (flippedCount 0); re-seeding per component fixes B.
    const compA = [0, 1, 2,  0, 2, 3];      // consistent
    const compB = [4, 5, 6,  4, 7, 6];      // T3 traverses 6→4 same as T2 → bad
    const r = consistentNormals([...compA, ...compB]);
    expect(r.flippedCount).toBe(1);
    // Component A untouched; component B's stray triangle flipped to (4,6,7).
    expect(r.indices.slice(0, 6)).toEqual(compA);
    expect(r.indices.slice(9, 12)).toEqual([4, 6, 7]);
  });

  it('fixes a bad winding in a LATER component while the first is already clean', () => {
    // Three shells; only the third (verts 8–11) is inconsistent.
    const r = consistentNormals([
      0, 1, 2,  0, 2, 3,        // comp 1 — clean
      4, 5, 6,  4, 6, 7,        // comp 2 — clean
      8, 9, 10,  8, 11, 10,     // comp 3 — T5 bad
    ]);
    expect(r.flippedCount).toBe(1);
    expect(r.indices.slice(15, 18)).toEqual([8, 10, 11]); // comp 3 fixed
  });
});

describe('healMeshStage2 pipeline', () => {
  it('reports zero repairs on already-manifold cube', () => {
    const r = healMeshStage2(cubePositions(), closedCubeIndices());
    expect(r.report.filledHoles).toBe(0);
    expect(r.report.finalBoundaryEdges).toBe(0);
  });

  it('fills the missing-bottom cube', () => {
    const idx = closedCubeIndices().slice(6);
    const r = healMeshStage2(cubePositions(), idx);
    expect(r.report.filledHoles).toBeGreaterThan(0);
    expect(r.report.addedTriangles).toBeGreaterThan(0);
    expect(r.report.finalBoundaryEdges).toBeLessThan(r.report.initialBoundaryEdges);
  });
});
