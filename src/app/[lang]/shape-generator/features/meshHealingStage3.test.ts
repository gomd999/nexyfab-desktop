import { describe, it, expect } from 'vitest';
import {
  detectTVertices,
  repairTVertices,
  detectSelfIntersections,
  detectSliverTriangles,
} from './meshHealingStage3';

describe('detectTVertices', () => {
  it('finds vertex lying on another edge', () => {
    // Triangle 1: (0,0,0)-(10,0,0)-(5,5,0). Vertices 0, 1, 2.
    // Triangle 2: a stand-alone triangle that places vertex 3 = (5,0,0)
    // on triangle 1's edge (0)-(1) but well away on the other axes.
    const positions = [
      0, 0, 0,   10, 0, 0,   5, 5, 0,    // 0, 1, 2
      5, 0, 0,   3, 0, 10,   7, 0, 10,   // 3, 4, 5 — far up in Z
    ];
    const indices = [0, 1, 2,  3, 4, 5];
    const t = detectTVertices(positions, indices, 1e-3);
    expect(t.length).toBeGreaterThan(0);
    // Vertex 3 must be among the candidates.
    expect(t.some(c => c.vertexIndex === 3)).toBe(true);
  });

  it('returns empty for clean mesh (cube)', () => {
    const positions = [
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
      0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
    ];
    const indices = [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6,
      1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3,
    ];
    expect(detectTVertices(positions, indices)).toHaveLength(0);
  });

  it('ignores vertex at edge endpoint (single triangle)', () => {
    // Standalone triangle — every vertex IS an endpoint of every edge
    // it participates in. None should be flagged as a T-vertex.
    const positions = [0, 0, 0,  10, 0, 0,  5, 8, 0];
    const indices = [0, 1, 2];
    expect(detectTVertices(positions, indices)).toHaveLength(0);
  });
});

describe('repairTVertices', () => {
  it('splits triangle that owns the offending edge', () => {
    // Initial: 1 triangle (0,1,2). Vertex 3 sits on edge (0,1).
    const positions = [
      0, 0, 0,   10, 0, 0,   5, 5, 0,
      5, 0, 0,
    ];
    const indices = [0, 1, 2];
    const cands = [{ vertexIndex: 3, edge: [0, 1] as [number, number], t: 0.5, distanceMm: 0 }];
    const r = repairTVertices(positions, indices, cands);
    // Original 1 triangle → 2 triangles (0,3,2) + (3,1,2).
    expect(r.indices.length).toBe(6);
    expect(r.splitCount).toBe(1);
  });

  it('idempotent on empty candidate list', () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const r = repairTVertices(positions, [0, 1, 2], []);
    expect(r.indices).toEqual([0, 1, 2]);
    expect(r.splitCount).toBe(0);
  });
});

describe('detectSelfIntersections', () => {
  it('detects two crossing triangles', () => {
    // Two triangles crossing each other through interior.
    // T1 lies in plane z=0; T2 in plane y=0; they cross at line.
    const positions = [
      -5, -5, 0,   5, -5, 0,   0, 5, 0,    // T1 in z=0
      -5, 0, -5,   5, 0, -5,   0, 0, 5,    // T2 in y=0
    ];
    const indices = [0, 1, 2,  3, 4, 5];
    const r = detectSelfIntersections(positions, indices);
    expect(r.length).toBeGreaterThan(0);
  });

  it('no intersections for two separate triangles', () => {
    const positions = [
      0, 0, 0,  1, 0, 0,  0, 1, 0,
      10, 10, 10,  11, 10, 10,  10, 11, 10,
    ];
    const indices = [0, 1, 2,  3, 4, 5];
    expect(detectSelfIntersections(positions, indices)).toHaveLength(0);
  });

  it('respects maxPairs cap', () => {
    // 10 disjoint pairs that overlap.
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < 12; i++) {
      positions.push(-5, -5, i, 5, -5, i, 0, 5, i);
      indices.push(i * 3, i * 3 + 1, i * 3 + 2);
    }
    const r = detectSelfIntersections(positions, indices, 5);
    expect(r.length).toBeLessThanOrEqual(5);
  });
});

describe('detectSliverTriangles', () => {
  it('flags ultra-thin triangle', () => {
    // Triangle with very small angle at vertex 2.
    const positions = [
      0, 0, 0,  100, 0, 0,  50, 0.01, 0,
    ];
    const r = detectSliverTriangles(positions, [0, 1, 2], 5);
    expect(r.length).toBe(1);
    expect(r[0]!.minAngleDeg).toBeLessThan(5);
  });

  it('passes well-shaped triangle', () => {
    // Equilateral triangle: all 60° angles.
    const h = Math.sqrt(3) / 2;
    const positions = [0, 0, 0,  1, 0, 0,  0.5, h, 0];
    const r = detectSliverTriangles(positions, [0, 1, 2], 5);
    expect(r).toHaveLength(0);
  });

  it('threshold is configurable', () => {
    const h = Math.sqrt(3) / 2;
    const positions = [0, 0, 0,  1, 0, 0,  0.5, h, 0];
    const r = detectSliverTriangles(positions, [0, 1, 2], 70);
    expect(r.length).toBe(1); // 60° < 70°
  });
});
