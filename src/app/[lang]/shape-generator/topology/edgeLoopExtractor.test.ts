import { describe, it, expect } from 'vitest';
import {
  extractEdgeLoops,
  triangleNormal,
  summarize,
  type MeshArrays,
} from './edgeLoopExtractor';

function unitCube(): MeshArrays {
  return {
    positions: [
      0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
      0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
    ],
    indices: [
      0, 2, 1,  0, 3, 2,
      4, 5, 6,  4, 6, 7,
      0, 1, 5,  0, 5, 4,
      1, 2, 6,  1, 6, 5,
      2, 3, 7,  2, 7, 6,
      3, 0, 4,  3, 4, 7,
    ],
  };
}

function flatPlane(): MeshArrays {
  return {
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

describe('extractEdgeLoops', () => {
  it('empty mesh → empty result', () => {
    const r = extractEdgeLoops({ positions: [], indices: [] });
    expect(r.featureEdges).toEqual([]);
    expect(r.loops).toEqual([]);
  });

  it('flat plane has no feature edges (interior coplanar)', () => {
    const r = extractEdgeLoops(flatPlane(), { thresholdDeg: 30 });
    expect(r.featureEdges).toEqual([]);
  });

  it('flat plane has 4 boundary edges', () => {
    const r = extractEdgeLoops(flatPlane());
    expect(r.boundaryEdges).toHaveLength(4);
  });

  it('unit cube has 12 feature edges (one per cube edge)', () => {
    const r = extractEdgeLoops(unitCube(), { thresholdDeg: 30 });
    expect(r.featureEdges).toHaveLength(12);
  });

  it('cube feature edges have ~90° dihedral', () => {
    const r = extractEdgeLoops(unitCube(), { thresholdDeg: 30 });
    for (const e of r.featureEdges) {
      expect(e.dihedralDeg).toBeGreaterThan(80);
      expect(e.dihedralDeg).toBeLessThan(100);
    }
  });

  it('cube produces edge loops', () => {
    const r = extractEdgeLoops(unitCube());
    expect(r.loops.length).toBeGreaterThan(0);
  });

  it('higher threshold suppresses cube edges', () => {
    const r = extractEdgeLoops(unitCube(), { thresholdDeg: 120 });
    expect(r.featureEdges).toEqual([]);
  });

  it('lower threshold includes cube edges', () => {
    const lo = extractEdgeLoops(unitCube(), { thresholdDeg: 5 });
    const hi = extractEdgeLoops(unitCube(), { thresholdDeg: 30 });
    expect(lo.featureEdges.length).toBeGreaterThanOrEqual(hi.featureEdges.length);
  });

  it('cube has no boundary edges (closed mesh)', () => {
    const r = extractEdgeLoops(unitCube());
    expect(r.boundaryEdges).toEqual([]);
  });
});

describe('triangleNormal', () => {
  it('XY triangle has +Z normal', () => {
    const n = triangleNormal([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(n[2]).toBeCloseTo(1, 5);
  });

  it('degenerate triangle returns default', () => {
    const n = triangleNormal([0, 0, 0], [0, 0, 0], [0, 0, 0]);
    expect(n).toEqual([0, 0, 1]);
  });

  it('returns unit length', () => {
    const n = triangleNormal([0, 0, 0], [2, 0, 0], [0, 2, 0]);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 5);
  });
});

describe('summarize', () => {
  it('zero values for empty mesh', () => {
    const s = summarize(extractEdgeLoops({ positions: [], indices: [] }));
    expect(s.featureEdgeCount).toBe(0);
    expect(s.loopCount).toBe(0);
    expect(s.averageDihedralDeg).toBe(0);
  });

  it('reports avg dihedral ~90 for cube', () => {
    const s = summarize(extractEdgeLoops(unitCube()));
    expect(s.averageDihedralDeg).toBeGreaterThan(80);
    expect(s.averageDihedralDeg).toBeLessThan(100);
  });

  it('boundary edge count from flat plane', () => {
    const s = summarize(extractEdgeLoops(flatPlane()));
    expect(s.boundaryEdgeCount).toBe(4);
    expect(s.featureEdgeCount).toBe(0);
  });

  it('total feature length > 0 for cube', () => {
    const s = summarize(extractEdgeLoops(unitCube()));
    expect(s.totalFeatureLengthMm).toBeGreaterThan(0);
  });

  it('longest loop length matches longest loop', () => {
    const r = extractEdgeLoops(unitCube());
    const s = summarize(r);
    const max = Math.max(0, ...r.loops.map(l => l.totalLengthMm));
    expect(s.longestLoopMm).toBe(max);
  });
});
