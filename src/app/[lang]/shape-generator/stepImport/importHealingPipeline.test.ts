import { describe, it, expect } from 'vitest';
import { healImportedMesh } from './importHealingPipeline';

/** Closed cube. */
function cube(): { positions: number[]; indices: number[] } {
  return {
    positions: [
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
      0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
    ],
    indices: [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6,
      1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3,
    ],
  };
}

describe('healImportedMesh', () => {
  it('reports watertight cube as healthy', () => {
    const c = cube();
    const r = healImportedMesh(c.positions, c.indices);
    expect(r.report.isWatertight).toBe(true);
    expect(r.report.finalBoundaryEdges).toBe(0);
  });

  it('preserves vertex count on clean mesh', () => {
    const c = cube();
    const r = healImportedMesh(c.positions, c.indices);
    expect(r.report.finalVertexCount).toBe(8);
  });

  it('welds duplicate vertices', () => {
    // Cube with vertex 0 duplicated as vertex 8.
    const c = cube();
    const positions = [...c.positions, 0, 0, 0]; // vertex 8 = (0,0,0)
    const indices = c.indices.map(i => (i === 0 ? 8 : i));
    const r = healImportedMesh(positions, indices, { weldToleranceMm: 1e-3 });
    expect(r.report.weldedVertices).toBeGreaterThan(0);
    expect(r.report.finalVertexCount).toBeLessThanOrEqual(8);
  });

  it('fills small holes (open cube)', () => {
    // Cube with bottom face removed.
    const c = cube();
    const indices = c.indices.slice(6); // drop bottom triangles
    const r = healImportedMesh(c.positions, indices, { maxHoleCircumferenceMm: 10 });
    expect(r.report.filledHoles).toBeGreaterThan(0);
  });

  it('respects maxHoleCircumferenceMm — leaves big holes alone', () => {
    // Make a 100mm cube with bottom open.
    const positions = [
      0, 0, 0,  100, 0, 0,  100, 100, 0,  0, 100, 0,
      0, 0, 100,  100, 0, 100,  100, 100, 100,  0, 100, 100,
    ];
    const indices = [
      4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4,
      2, 3, 7, 2, 7, 6,
      1, 2, 6, 1, 6, 5,
      0, 4, 7, 0, 7, 3,
    ];
    const r = healImportedMesh(positions, indices, { maxHoleCircumferenceMm: 50 });
    // 400 mm perimeter > 50 → not filled.
    expect(r.report.filledHoles).toBe(0);
    expect(r.report.isWatertight).toBe(false);
  });

  it('emits initial vs final triangle count', () => {
    const c = cube();
    const r = healImportedMesh(c.positions, c.indices);
    expect(r.report.initialTriangleCount).toBe(12);
    expect(r.report.finalTriangleCount).toBeGreaterThanOrEqual(12);
  });

  it('handles empty mesh', () => {
    const r = healImportedMesh([], []);
    expect(r.report.initialVertexCount).toBe(0);
    expect(r.report.isWatertight).toBe(true);
  });

  // ── Integration: the healing actually achieves its goal ──────────────────
  // The existing hole test only checks "a hole was filled". These assert the
  // END state the pipeline exists to produce / report.
  it('filling a small hole makes the mesh watertight again (the actual goal)', () => {
    const c = cube();
    const open = c.indices.slice(6); // bottom face (2 tris) removed → a 4-edge hole
    const before = healImportedMesh(c.positions, open, { maxHoleCircumferenceMm: 0 });
    expect(before.report.isWatertight).toBe(false);       // baseline: open
    expect(before.report.finalBoundaryEdges).toBeGreaterThan(0);
    const after = healImportedMesh(c.positions, open, { maxHoleCircumferenceMm: 10 });
    expect(after.report.filledHoles).toBeGreaterThan(0);
    expect(after.report.finalBoundaryEdges).toBe(0);      // hole closed
    expect(after.report.isWatertight).toBe(true);         // ← the real contract
  });

  it('flags a non-manifold edge (a triangle hung on a shared edge) and is not watertight', () => {
    const c = cube();
    // Add a stray triangle on the already-shared edge 0–1 → that edge now has 3
    // incident faces. healing cannot make this watertight; it must report it.
    const indices = [...c.indices, 0, 1, 4];
    const r = healImportedMesh(c.positions, indices);
    expect(r.report.finalNonManifoldEdges).toBeGreaterThan(0);
    expect(r.report.isWatertight).toBe(false);
  });
});
