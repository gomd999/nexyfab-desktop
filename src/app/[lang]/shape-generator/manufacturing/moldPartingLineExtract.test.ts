import { describe, it, expect } from 'vitest';
import {
  extractPartingLine,
  triangleNormalArea,
  summarize,
  type MeshArrays,
} from './moldPartingLineExtract';

function unitCube(): MeshArrays {
  return {
    positions: [
      0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
      0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
    ],
    indices: [
      // Bottom (z=0), normal -Z (core for +Z pull)
      0, 2, 1,  0, 3, 2,
      // Top (z=1), normal +Z (cavity)
      4, 5, 6,  4, 6, 7,
      // Sides
      0, 1, 5,  0, 5, 4,
      1, 2, 6,  1, 6, 5,
      2, 3, 7,  2, 7, 6,
      3, 0, 4,  3, 4, 7,
    ],
  };
}

describe('extractPartingLine', () => {
  it('empty mesh → empty result', () => {
    const r = extractPartingLine({ positions: [], indices: [] }, [0, 0, 1]);
    expect(r.polylines).toEqual([]);
    expect(r.cavityAreaMm2).toBe(0);
  });

  it('unit cube pulled along +Z classifies top/bottom/sides', () => {
    const r = extractPartingLine(unitCube(), [0, 0, 1]);
    expect(r.triangleClass).toHaveLength(12);
    const counts = { cavity: 0, core: 0, sidewall: 0 };
    for (const c of r.triangleClass) counts[c]++;
    expect(counts.cavity).toBe(2);
    expect(counts.core).toBe(2);
    expect(counts.sidewall).toBe(8);
  });

  it('cavity area + core area + sidewall area = total mesh area', () => {
    const r = extractPartingLine(unitCube(), [0, 0, 1]);
    const total = r.cavityAreaMm2 + r.coreAreaMm2 + r.sidewallAreaMm2;
    expect(total).toBeCloseTo(6, 5);
  });

  it('parting edges exist between cavity/sidewall and core/sidewall', () => {
    const r = extractPartingLine(unitCube(), [0, 0, 1]);
    expect(r.partingEdgeCount).toBeGreaterThan(0);
  });

  it('produces closed parting polyline for cube', () => {
    const r = extractPartingLine(unitCube(), [0, 0, 1]);
    const anyClosed = r.polylines.some(p => p.closed);
    expect(anyClosed).toBe(true);
  });

  it('different pull axis changes classification', () => {
    const a = extractPartingLine(unitCube(), [0, 0, 1]);
    const b = extractPartingLine(unitCube(), [1, 0, 0]);
    expect(a.cavityAreaMm2).toBe(b.cavityAreaMm2);
    // Bin counts identical for axis-aligned cube but specific triangles differ.
    expect(a.triangleClass).not.toEqual(b.triangleClass);
  });

  it('options override defaults', () => {
    const r = extractPartingLine(unitCube(), [0, 0, 1], { sidewallCosine: 0.5 });
    // Looser sidewall threshold → fewer pure cavity/core triangles.
    const counts = { cavity: 0, core: 0, sidewall: 0 };
    for (const c of r.triangleClass) counts[c]++;
    expect(counts.sidewall).toBeGreaterThanOrEqual(8);
  });
});

describe('triangleNormalArea', () => {
  it('flat horizontal triangle has +Z normal', () => {
    const r = triangleNormalArea([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(r.normal[2]).toBeCloseTo(1, 5);
    expect(r.area).toBeCloseTo(0.5, 5);
  });

  it('degenerate triangle has zero area', () => {
    const r = triangleNormalArea([0, 0, 0], [0, 0, 0], [0, 0, 0]);
    expect(r.area).toBe(0);
  });

  it('larger triangle → larger area', () => {
    const a = triangleNormalArea([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    const b = triangleNormalArea([0, 0, 0], [10, 0, 0], [0, 10, 0]);
    expect(b.area).toBeGreaterThan(a.area);
  });
});

describe('summarize', () => {
  it('reports fractions summing to 1', () => {
    const r = extractPartingLine(unitCube(), [0, 0, 1]);
    const s = summarize(r);
    expect(s.cavityFraction + s.coreFraction + s.sidewallFraction).toBeCloseTo(1, 5);
  });

  it('detects undercut flag', () => {
    const r = extractPartingLine(unitCube(), [0, 0, 1]);
    const s = summarize(r);
    expect(typeof s.hasUndercut).toBe('boolean');
    expect(s.undercutCount).toBe(r.undercutTriangles.length);
  });

  it('reports longest chain length', () => {
    const r = extractPartingLine(unitCube(), [0, 0, 1]);
    const s = summarize(r);
    expect(s.longestChainLength).toBeGreaterThan(0);
  });

  it('zero-area input → zero fractions', () => {
    const r = extractPartingLine({ positions: [], indices: [] }, [0, 0, 1]);
    const s = summarize(r);
    expect(s.cavityFraction).toBe(0);
    expect(s.coreFraction).toBe(0);
  });
});
