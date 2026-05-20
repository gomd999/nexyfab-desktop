import { describe, it, expect } from 'vitest';
import {
  stitch,
  polylineDistance,
  snapMatchedBoundaries,
  summarize,
  type Patch,
  type BoundaryPolyline,
} from './nurbsSurfaceStitcher';

function squarePatch(id: string, dx: number, dy: number): Patch {
  const x0 = dx, x1 = dx + 1;
  const y0 = dy, y1 = dy + 1;
  return {
    id,
    boundaries: [
      { patchId: id, side: 'u0', points: [[x0, y0, 0], [x0, y1, 0]] },
      { patchId: id, side: 'u1', points: [[x1, y0, 0], [x1, y1, 0]] },
      { patchId: id, side: 'v0', points: [[x0, y0, 0], [x1, y0, 0]] },
      { patchId: id, side: 'v1', points: [[x0, y1, 0], [x1, y1, 0]] },
    ],
  };
}

describe('stitch', () => {
  it('empty input → empty seams', () => {
    const r = stitch([]);
    expect(r.seams).toEqual([]);
    expect(r.shells).toEqual([]);
  });

  it('single patch → no seams, one shell', () => {
    const r = stitch([squarePatch('A', 0, 0)]);
    expect(r.seams).toEqual([]);
    expect(r.shells).toHaveLength(1);
    expect(r.shells[0]).toEqual(['A']);
  });

  it('two adjacent patches share a seam', () => {
    const r = stitch([squarePatch('A', 0, 0), squarePatch('B', 1, 0)]);
    expect(r.seams.length).toBeGreaterThan(0);
    expect(r.seams[0]!.gapMm).toBeLessThan(0.01);
  });

  it('two adjacent patches form one shell', () => {
    const r = stitch([squarePatch('A', 0, 0), squarePatch('B', 1, 0)]);
    expect(r.shells).toHaveLength(1);
    expect(r.shells[0]!.sort()).toEqual(['A', 'B']);
  });

  it('disjoint patches form separate shells', () => {
    const r = stitch([squarePatch('A', 0, 0), squarePatch('B', 100, 0)]);
    expect(r.shells).toHaveLength(2);
    expect(r.freePatches.sort()).toEqual(['A', 'B']);
  });

  it('tolerance gates seam matching', () => {
    const a = squarePatch('A', 0, 0);
    const b = squarePatch('B', 1.05, 0);
    const tight = stitch([a, b], { toleranceMm: 0.001 });
    const loose = stitch([a, b], { toleranceMm: 0.1 });
    expect(tight.seams.length).toBe(0);
    expect(loose.seams.length).toBeGreaterThan(0);
  });

  it('reports free boundaries', () => {
    const r = stitch([squarePatch('A', 0, 0), squarePatch('B', 1, 0)]);
    expect(r.freeBoundaries.length).toBeGreaterThan(0);
  });

  it('three patches in a row form one shell', () => {
    const r = stitch([
      squarePatch('A', 0, 0),
      squarePatch('B', 1, 0),
      squarePatch('C', 2, 0),
    ]);
    expect(r.shells).toHaveLength(1);
    expect(r.shells[0]!.length).toBe(3);
  });
});

describe('polylineDistance', () => {
  it('identical polylines → distance 0', () => {
    const poly: Array<[number, number, number]> = [[0, 0, 0], [1, 0, 0]];
    expect(polylineDistance(poly, poly)).toBeCloseTo(0, 5);
  });

  it('offset polylines → distance equals offset', () => {
    const a: Array<[number, number, number]> = [[0, 0, 0], [1, 0, 0]];
    const b: Array<[number, number, number]> = [[0, 0, 5], [1, 0, 5]];
    expect(polylineDistance(a, b)).toBeCloseTo(5, 5);
  });

  it('empty polylines → infinity', () => {
    expect(polylineDistance([], [])).toBe(Infinity);
  });
});

describe('snapMatchedBoundaries', () => {
  it('averages two boundaries to midline', () => {
    const a: BoundaryPolyline = { patchId: 'A', side: 'u1', points: [[0, 0, 0], [0, 1, 0]] };
    const b: BoundaryPolyline = { patchId: 'B', side: 'u0', points: [[0.1, 0, 0], [0.1, 1, 0]] };
    const { aSnap, bSnap } = snapMatchedBoundaries(a, b, false);
    expect(aSnap.points[0]![0]).toBeCloseTo(0.05, 5);
    expect(bSnap.points[0]![0]).toBeCloseTo(0.05, 5);
  });

  it('reversed mode flips B back', () => {
    const a: BoundaryPolyline = { patchId: 'A', side: 'u1', points: [[0, 0, 0], [0, 1, 0]] };
    const b: BoundaryPolyline = { patchId: 'B', side: 'u0', points: [[0, 1, 0], [0, 0, 0]] };
    const { aSnap, bSnap } = snapMatchedBoundaries(a, b, true);
    expect(aSnap.points[0]).toEqual(bSnap.points[1]);
  });
});

describe('summarize', () => {
  it('reports counts and gap statistics', () => {
    const patches = [squarePatch('A', 0, 0), squarePatch('B', 1, 0)];
    const r = stitch(patches);
    const s = summarize(patches, r);
    expect(s.patchCount).toBe(2);
    expect(s.seamCount).toBeGreaterThan(0);
    expect(s.shellCount).toBe(1);
    expect(s.fullyStitched).toBe(true);
  });

  it('disjoint patches → fullyStitched false', () => {
    const patches = [squarePatch('A', 0, 0), squarePatch('B', 100, 0)];
    const r = stitch(patches);
    const s = summarize(patches, r);
    expect(s.fullyStitched).toBe(false);
    expect(s.shellCount).toBe(2);
  });

  it('empty input', () => {
    const s = summarize([], { seams: [], shells: [], freePatches: [], freeBoundaries: [] });
    expect(s.patchCount).toBe(0);
    expect(s.averageGapMm).toBe(0);
    expect(s.fullyStitched).toBe(false);
  });
});
