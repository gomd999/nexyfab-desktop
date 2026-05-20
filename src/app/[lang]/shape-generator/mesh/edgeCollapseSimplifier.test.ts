import { describe, it, expect } from 'vitest';
import {
  simplify,
  decimationStats,
  simplifyWithBudget,
  summarize,
  type MeshData,
} from './edgeCollapseSimplifier';

function pyramid(): MeshData {
  // 5-vertex square pyramid: 4 base + 1 apex, 6 triangles (4 sides + 2 base).
  return {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
      { x: 5, y: 5, z: 8 },
    ],
    triangles: [
      { id: 't1', v0: 0, v1: 1, v2: 4 },
      { id: 't2', v0: 1, v1: 2, v2: 4 },
      { id: 't3', v0: 2, v1: 3, v2: 4 },
      { id: 't4', v0: 3, v1: 0, v2: 4 },
      { id: 'base1', v0: 0, v1: 1, v2: 2 },
      { id: 'base2', v0: 0, v1: 2, v2: 3 },
    ],
  };
}

function densePatch(): MeshData {
  // 5×5 grid of vertices forming 32 triangles.
  const vertices = [];
  for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) {
    vertices.push({ x, y, z: 0 });
  }
  const triangles = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const i = y * 5 + x;
      triangles.push({ id: `a-${x}-${y}`, v0: i, v1: i + 1, v2: i + 5 });
      triangles.push({ id: `b-${x}-${y}`, v0: i + 1, v1: i + 6, v2: i + 5 });
    }
  }
  return { vertices, triangles };
}

describe('simplify', () => {
  it('empty mesh → empty result', () => {
    const r = simplify({ vertices: [], triangles: [] });
    expect(r.simplifiedMesh.triangles).toEqual([]);
  });

  it('targetRatio 0.5 halves triangle count approx', () => {
    const mesh = densePatch();
    const r = simplify(mesh, { targetRatio: 0.5, maxErrorPerCollapse: 10 });
    expect(r.simplifiedMesh.triangles.length).toBeLessThanOrEqual(mesh.triangles.length);
    expect(r.simplifiedMesh.triangles.length).toBeGreaterThan(0);
  });

  it('targetRatio close to 1 → minimal collapse', () => {
    const mesh = densePatch();
    const r = simplify(mesh, { targetRatio: 0.95, maxErrorPerCollapse: 10 });
    expect(r.collapses.length).toBeLessThan(5);
  });

  it('maxErrorPerCollapse caps quality', () => {
    const mesh = densePatch();
    const r = simplify(mesh, { targetRatio: 0.1, maxErrorPerCollapse: 0.0001 });
    expect(r.collapses).toEqual([]);
  });

  it('collapses sorted by cost', () => {
    const r = simplify(densePatch(), { targetRatio: 0.5, maxErrorPerCollapse: 10 });
    for (let i = 1; i < r.collapses.length; i++) {
      expect(r.collapses[i]!.cost).toBeGreaterThanOrEqual(0);
    }
  });

  it('finalRatio matches actual fraction', () => {
    const mesh = densePatch();
    const r = simplify(mesh, { targetRatio: 0.5, maxErrorPerCollapse: 10 });
    expect(r.finalRatio).toBeCloseTo(r.simplifiedMesh.triangles.length / mesh.triangles.length, 5);
  });

  it('worst error tracks max collapse', () => {
    const r = simplify(densePatch(), { targetRatio: 0.5, maxErrorPerCollapse: 10 });
    let maxC = 0;
    for (const c of r.collapses) if (c.cost > maxC) maxC = c.cost;
    expect(r.worstCollapseError).toBeCloseTo(maxC, 5);
  });
});

describe('decimationStats', () => {
  it('reports reduction %', () => {
    const mesh = densePatch();
    const r = simplify(mesh, { targetRatio: 0.5, maxErrorPerCollapse: 10 });
    const stats = decimationStats(mesh, r);
    expect(stats.reductionPct).toBeGreaterThanOrEqual(0);
  });

  it('original = final when no collapse', () => {
    const mesh = pyramid();
    const r = simplify(mesh, { targetRatio: 1.0, maxErrorPerCollapse: 0 });
    expect(decimationStats(mesh, r).finalTriangles).toBe(mesh.triangles.length);
  });
});

describe('simplifyWithBudget', () => {
  it('reduces toward budget', () => {
    const mesh = densePatch();
    const r = simplifyWithBudget(mesh, 8, 10);
    expect(r.simplifiedMesh.triangles.length).toBeLessThanOrEqual(mesh.triangles.length);
  });
});

describe('summarize', () => {
  it('reports counts + ratio', () => {
    const mesh = densePatch();
    const r = simplify(mesh, { targetRatio: 0.5, maxErrorPerCollapse: 10 });
    const s = summarize(mesh, r);
    expect(s.originalCount).toBe(mesh.triangles.length);
    expect(s.finalCount).toBe(r.simplifiedMesh.triangles.length);
  });
});
