import { describe, it, expect } from 'vitest';
import { sewFaces, sewFacesWithMessage, type BrepEdge } from './sewFaces';

const edge = (id: string, p0: [number, number, number], p1: [number, number, number]): BrepEdge => ({ id, p0, p1 });

describe('sewFaces · clean input', () => {
  it('no snaps when all edges are well-separated', () => {
    const edges = [
      edge('e1', [0, 0, 0], [10, 0, 0]),
      edge('e2', [10, 0, 0], [10, 10, 0]),
    ];
    const r = sewFaces(edges);
    expect(r.report.snappedEndpoints).toBe(0);
    expect(r.edges[0].p0).toEqual([0, 0, 0]);
  });

  it('two edges sharing an exact endpoint remain unmodified', () => {
    const edges = [
      edge('e1', [0, 0, 0], [10, 0, 0]),
      edge('e2', [10, 0, 0], [10, 10, 0]), // shares p1 = e1.p1
    ];
    const r = sewFaces(edges);
    expect(r.report.snappedEndpoints).toBe(0);
  });
});

describe('sewFaces · gap healing', () => {
  it('snaps endpoints within the default 1 micron tolerance', () => {
    const edges = [
      edge('e1', [0, 0, 0], [10, 0, 0]),
      edge('e2', [10.0000005, 0, 0], [10, 10, 0]), // p0 differs by 0.5 microns
    ];
    const r = sewFaces(edges);
    // Both endpoints move toward the cluster centroid (e1.p1 and e2.p0).
    expect(r.report.snappedEndpoints).toBeGreaterThan(0);
    // After sewing, e1.p1 and e2.p0 should be identical.
    expect(r.edges[0].p1).toEqual(r.edges[1].p0);
  });

  it('does NOT snap endpoints that are farther than tolerance', () => {
    const edges = [
      edge('e1', [0, 0, 0], [10, 0, 0]),
      edge('e2', [10.1, 0, 0], [10, 10, 0]), // 0.1 mm gap >> default 1e-3
    ];
    const r = sewFaces(edges);
    expect(r.report.snappedEndpoints).toBe(0);
    expect(r.edges[1].p0[0]).toBeCloseTo(10.1, 5);
  });

  it('respects custom tolerance', () => {
    const edges = [
      edge('e1', [0, 0, 0], [10, 0, 0]),
      edge('e2', [10.05, 0, 0], [10, 10, 0]),
    ];
    // Default 1e-3 tolerance — no snap.
    expect(sewFaces(edges).report.snappedEndpoints).toBe(0);
    // 0.1 mm tolerance — snaps.
    expect(sewFaces(edges, { toleranceMm: 0.1 }).report.snappedEndpoints).toBeGreaterThan(0);
  });

  it('clusters multiple near-coincident endpoints to one centroid', () => {
    // Five endpoints all within tolerance of each other.
    const edges = [
      edge('a', [0, 0, 0],         [10, 0, 0]),
      edge('b', [0.0000001, 0, 0], [10, 1, 0]),
      edge('c', [-0.0000001, 0, 0],[10, 2, 0]),
    ];
    const r = sewFaces(edges);
    // After sewing they should all share the same p0.
    expect(r.edges[0].p0).toEqual(r.edges[1].p0);
    expect(r.edges[1].p0).toEqual(r.edges[2].p0);
  });
});

describe('sewFaces · merged duplicate detection', () => {
  it('flags edges whose endpoints become identical after snapping', () => {
    const edges = [
      edge('a', [0, 0, 0],         [10, 0, 0]),
      edge('b', [0.0000001, 0, 0], [10.0000001, 0, 0]), // becomes duplicate of `a`
    ];
    const r = sewFaces(edges);
    expect(r.report.mergedEdges).toBeGreaterThan(0);
  });
});

describe('sewFacesWithMessage', () => {
  it('reports "no gaps" message on clean input', () => {
    const r = sewFacesWithMessage([edge('e', [0, 0, 0], [10, 0, 0])]);
    expect(r.message).toContain('No edge gaps');
  });

  it('reports healing count on dirty input', () => {
    const r = sewFacesWithMessage([
      edge('a', [0, 0, 0], [10, 0, 0]),
      edge('b', [0.00000001, 0, 0], [10, 1, 0]),
    ]);
    expect(r.message).toMatch(/Healed/);
  });
});

describe('sewFaces · report fields', () => {
  it('includes toleranceMm and clusterCount', () => {
    const edges = [
      edge('a', [0, 0, 0], [10, 0, 0]),
      edge('b', [5, 5, 5], [15, 5, 5]),
    ];
    const r = sewFaces(edges, { toleranceMm: 0.01 });
    expect(r.report.toleranceMm).toBe(0.01);
    expect(r.report.clusterCount).toBeGreaterThan(0);
  });
});
