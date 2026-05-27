import { describe, it, expect } from 'vitest';
import {
  wrapSketchToSurface,
  indent,
  replaceFace,
  deleteFaceAndHeal,
  imprintCurveOnFaces,
  cavity,
  type WrapInput,
} from './modelingExtras';

describe('wrapSketchToSurface', () => {
  const flatSurface: WrapInput['targetMesh'] = {
    positions: [
      -100, -100, 0,
      100, -100, 0,
      100, 100, 0,
      -100, 100, 0,
    ],
    indices: [0, 1, 2, 0, 2, 3],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  };

  it('engrave projects curves below surface', () => {
    const r = wrapSketchToSurface({
      sketchCurves: [[[0, 0], [10, 0]]],
      sketchPlaneOrigin: [0, 0, 10],
      sketchXAxis: [1, 0, 0],
      sketchYAxis: [0, 1, 0],
      targetMesh: flatSurface,
      mode: 'engrave',
      depthMm: 2,
    });
    expect(r.projectedCurves[0]![0]![2]).toBeCloseTo(-2, 5);
  });

  it('emboss projects above surface', () => {
    const r = wrapSketchToSurface({
      sketchCurves: [[[0, 0]]],
      sketchPlaneOrigin: [0, 0, 10],
      sketchXAxis: [1, 0, 0],
      sketchYAxis: [0, 1, 0],
      targetMesh: flatSurface,
      mode: 'emboss',
      depthMm: 2,
    });
    expect(r.projectedCurves[0]![0]![2]).toBeCloseTo(2, 5);
  });

  it('scribe leaves curve on surface (z=0)', () => {
    const r = wrapSketchToSurface({
      sketchCurves: [[[5, 5]]],
      sketchPlaneOrigin: [0, 0, 10],
      sketchXAxis: [1, 0, 0],
      sketchYAxis: [0, 1, 0],
      targetMesh: flatSurface,
      mode: 'scribe',
      depthMm: 2,
    });
    expect(r.projectedCurves[0]![0]![2]).toBeCloseTo(0, 5);
  });

  it('reports volume for emboss', () => {
    const r = wrapSketchToSurface({
      sketchCurves: [[[0, 0], [10, 0]]],
      sketchPlaneOrigin: [0, 0, 10],
      sketchXAxis: [1, 0, 0],
      sketchYAxis: [0, 1, 0],
      targetMesh: flatSurface,
      mode: 'emboss',
      depthMm: 2,
    });
    expect(r.affectedVolumeMm3).toBeGreaterThan(0);
  });

  it('empty mesh → no projection (warning)', () => {
    const r = wrapSketchToSurface({
      sketchCurves: [[[0, 0]]],
      sketchPlaneOrigin: [0, 0, 10],
      sketchXAxis: [1, 0, 0],
      sketchYAxis: [0, 1, 0],
      targetMesh: { positions: [], indices: [], normals: [] },
      mode: 'engrave',
      depthMm: 2,
    });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('indent', () => {
  it('clearance expands tool bbox', () => {
    const r = indent({
      targetBbox: { min: [0, 0, 0], max: [100, 100, 100] },
      toolBbox: { min: [10, 10, 10], max: [20, 20, 20] },
      clearanceMm: 1,
    });
    expect(r.effectiveToolBbox.min[0]).toBe(9);
    expect(r.effectiveToolBbox.max[0]).toBe(21);
  });

  it('non-overlapping tool → zero cavity + warning', () => {
    const r = indent({
      targetBbox: { min: [0, 0, 0], max: [10, 10, 10] },
      toolBbox: { min: [100, 100, 100], max: [110, 110, 110] },
      clearanceMm: 1,
    });
    expect(r.cavityVolumeMm3).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('tight clearance triggers warning', () => {
    const r = indent({
      targetBbox: { min: [0, 0, 0], max: [100, 100, 100] },
      toolBbox: { min: [10, 10, 10], max: [20, 20, 20] },
      clearanceMm: 0.01,
    });
    expect(r.warnings.some(w => w.includes('Clearance'))).toBe(true);
  });
});

describe('replaceFace', () => {
  // Simple 2-triangle mesh.
  const mesh = {
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 3],
  };
  const newFace = {
    positions: [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1],
    indices: [0, 1, 2, 0, 2, 3],
  };

  it('removes target triangles + adds replacements', () => {
    const r = replaceFace({
      mesh,
      faceTriangleIndices: [0],
      newFace,
    });
    expect(r.removedTriangles).toBe(1);
    expect(r.addedTriangles).toBe(2);
  });

  it('preserves untouched triangles', () => {
    const r = replaceFace({ mesh, faceTriangleIndices: [0], newFace });
    // Tri 1 (original indices 0,2,3) should remain.
    expect(r.resultMesh.indices.slice(0, 3)).toEqual([0, 2, 3]);
  });
});

describe('deleteFaceAndHeal', () => {
  const cube = {
    positions: [
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
      0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
    ],
    indices: [
      0, 2, 1, 0, 3, 2,
      4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4,
      2, 3, 7, 2, 7, 6,
      1, 2, 6, 1, 6, 5,
      0, 4, 7, 0, 7, 3,
    ],
  };

  it('removes target face triangles', () => {
    const r = deleteFaceAndHeal({ mesh: cube, faceTriangleIndices: [0, 1] });
    // Original 12 tris, 2 removed, then up to 4 fill triangles added.
    expect(r.resultMesh.indices.length / 3).toBeGreaterThan(10);
  });

  it('emits boundary loop', () => {
    const r = deleteFaceAndHeal({ mesh: cube, faceTriangleIndices: [0, 1] });
    expect(r.boundaryLoop.length).toBeGreaterThan(0);
  });
});

describe('imprintCurveOnFaces', () => {
  const plane = {
    positions: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0],
    indices: [0, 1, 2, 0, 2, 3],
  };

  it('detects triangles touched by curve', () => {
    const r = imprintCurveOnFaces({
      mesh: plane,
      curve: [[5, 5, 0], [6, 6, 0]],
    });
    expect(r.intersectedTriangles).toBeGreaterThan(0);
  });

  it('newVertexCount = curve length', () => {
    const r = imprintCurveOnFaces({
      mesh: plane,
      curve: [[1, 1, 0], [5, 5, 0], [9, 9, 0]],
    });
    expect(r.newVertexCount).toBe(3);
  });
});

describe('cavity', () => {
  it('cavity bbox centered on tool', () => {
    const r = cavity({
      targetBbox: { min: [0, 0, 0], max: [100, 100, 100] },
      toolBbox: { min: [30, 30, 30], max: [50, 50, 50] },
      scaleFactor: 1,
      clearanceMm: 0.5,
    });
    const center: [number, number, number] = [
      (r.cavityBbox.min[0] + r.cavityBbox.max[0]) / 2,
      (r.cavityBbox.min[1] + r.cavityBbox.max[1]) / 2,
      (r.cavityBbox.min[2] + r.cavityBbox.max[2]) / 2,
    ];
    expect(center).toEqual([40, 40, 40]);
  });

  it('scale factor enlarges cavity', () => {
    const r1 = cavity({
      targetBbox: { min: [0, 0, 0], max: [100, 100, 100] },
      toolBbox: { min: [30, 30, 30], max: [50, 50, 50] },
      scaleFactor: 1, clearanceMm: 0,
    });
    const r2 = cavity({
      targetBbox: { min: [0, 0, 0], max: [100, 100, 100] },
      toolBbox: { min: [30, 30, 30], max: [50, 50, 50] },
      scaleFactor: 1.5, clearanceMm: 0,
    });
    expect(r2.cavityVolumeMm3).toBeGreaterThan(r1.cavityVolumeMm3);
  });

  it('cavity outside target → warning', () => {
    const r = cavity({
      targetBbox: { min: [0, 0, 0], max: [10, 10, 10] },
      toolBbox: { min: [5, 5, 5], max: [15, 15, 15] },
      scaleFactor: 1, clearanceMm: 0,
    });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
