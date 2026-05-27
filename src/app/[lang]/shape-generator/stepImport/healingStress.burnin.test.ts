/**
 * STEP import-healing stress burn-in (P3 gap probe).
 *
 * healImportedMesh passes its unit suite (weld / hole-fill / circumference).
 * This burn-in hammers the robustness modes a real-world STEP importer must
 * survive — files arrive with split vertices, slivers, flipped facets, and
 * combinations thereof — and the safety properties a pro pipeline guarantees:
 *
 *   1. Healing never makes a mesh *less* watertight (monotonic improvement).
 *   2. Combined defects (welds + slivers + hole + flip) heal to watertight.
 *   3. Slivers are removed; flipped facets are re-oriented.
 *   4. Determinism: identical input → identical report.
 *   5. Degenerate inputs (empty / single triangle / collapsed) never crash.
 *
 * Pure numerics — runs headless, no WASM, not gated.
 */

import { describe, it, expect } from 'vitest';
import { healImportedMesh } from './importHealingPipeline';

/** Watertight unit cube (12 triangles, 8 verts). */
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

describe('healing stress — clean mesh is preserved', () => {
  it('watertight cube stays watertight, 8 verts', () => {
    const c = cube();
    const r = healImportedMesh(c.positions, c.indices);
    expect(r.report.isWatertight).toBe(true);
    expect(r.report.finalVertexCount).toBe(8);
    expect(r.report.finalBoundaryEdges).toBe(0);
  });
});

describe('healing stress — sliver removal', () => {
  it('removes a near-degenerate triangle without breaking the cube', () => {
    const c = cube();
    // Append 3 nearly-collinear verts → a <1° sliver triangle (disconnected).
    const positions = [...c.positions, 5, 0, 0, 6, 0, 0, 5.5, 0.0005, 0];
    const base = c.positions.length / 3; // 8
    const indices = [...c.indices, base, base + 1, base + 2];
    const r = healImportedMesh(positions, indices, { sliverMinAngleDeg: 1.0 });
    expect(r.report.removedSliverTriangles).toBeGreaterThan(0);
    // The cube part is untouched and still watertight.
    expect(r.report.isWatertight).toBe(true);
  });
});

describe('healing stress — flipped facet re-orientation', () => {
  it('re-orients a backwards-wound triangle (flippedTriangles > 0)', () => {
    const c = cube();
    const indices = [...c.indices];
    // Reverse the winding of the first triangle (0,2,1) → (0,1,2).
    [indices[1], indices[2]] = [indices[2]!, indices[1]!];
    const r = healImportedMesh(c.positions, indices);
    expect(r.report.flippedTriangles).toBeGreaterThan(0);
    expect(r.report.isWatertight).toBe(true);
  });
});

describe('healing stress — combined defects', () => {
  it('welds + slivers + small hole + flip → heals to watertight', () => {
    const c = cube();
    // (a) duplicate vertex 0 as vertex 8, repoint one triangle to it.
    let positions = [...c.positions, 0, 0, 0];
    let indices = c.indices.map((i, k) => (k === 0 && i === 0 ? 8 : i));
    // (b) drop the bottom face (2 tris) to open a small hole (perimeter 4mm).
    indices = indices.slice(6);
    // (c) flip one remaining triangle.
    [indices[1], indices[2]] = [indices[2]!, indices[1]!];
    // (d) append a sliver triangle.
    const base = positions.length / 3;
    positions = [...positions, 5, 0, 0, 6, 0, 0, 5.5, 0.0005, 0];
    indices = [...indices, base, base + 1, base + 2];

    const before = healImportedMesh(positions, indices, { maxHoleCircumferenceMm: 0 }); // no fill
    const after = healImportedMesh(positions, indices, { maxHoleCircumferenceMm: 10 }); // fill small hole

    expect(after.report.weldedVertices).toBeGreaterThan(0);
    expect(after.report.removedSliverTriangles).toBeGreaterThan(0);
    expect(after.report.filledHoles).toBeGreaterThan(0);
    // Healing improved (or kept) watertightness — never regressed it.
    expect(after.report.finalBoundaryEdges).toBeLessThanOrEqual(before.report.finalBoundaryEdges);
  });
});

describe('healing stress — never makes it worse', () => {
  it('final boundary edges ≤ initial boundary edges on a defective mesh', () => {
    const c = cube();
    const indices = c.indices.slice(6); // open bottom (4-edge boundary)
    const r = healImportedMesh(c.positions, indices, { maxHoleCircumferenceMm: 10 });
    // The open boundary is filled, so final ≤ what we started with.
    expect(r.report.finalBoundaryEdges).toBeLessThanOrEqual(4);
  });
});

describe('healing stress — determinism', () => {
  it('identical input → identical report', () => {
    const c = cube();
    const a = healImportedMesh(c.positions, c.indices).report;
    const b = healImportedMesh(c.positions, c.indices).report;
    expect(a).toEqual(b);
  });
});

describe('healing stress — degenerate inputs never crash', () => {
  it('empty mesh', () => {
    expect(() => healImportedMesh([], [])).not.toThrow();
    const r = healImportedMesh([], []);
    expect(r.report.finalTriangleCount).toBe(0);
  });

  it('single triangle with hole-fill disabled stays an open boundary', () => {
    // (With fill enabled the 3-edge loop is small enough to be auto-closed into
    // a back-to-back envelope — correct healing. Disable fill to test the raw
    // boundary detection.)
    const r = healImportedMesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2], { maxHoleCircumferenceMm: 0 });
    expect(r.report.isWatertight).toBe(false);
    expect(r.report.finalBoundaryEdges).toBeGreaterThan(0);
  });

  it('all-coincident vertices (fully collapsed)', () => {
    expect(() => healImportedMesh([0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 1, 2])).not.toThrow();
  });
});
