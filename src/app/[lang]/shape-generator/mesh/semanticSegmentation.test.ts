import { describe, it, expect } from 'vitest';
import {
  segmentMesh,
  triangleNormalArea,
  summarize,
  type MeshArrays,
} from './semanticSegmentation';

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

function flatPlate(): MeshArrays {
  return {
    positions: [0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0],
    indices: [0, 1, 2,  0, 2, 3],
  };
}

describe('segmentMesh', () => {
  it('empty mesh → empty result', () => {
    const r = segmentMesh({ positions: [], indices: [] });
    expect(r.regions).toEqual([]);
  });

  it('flat plate yields a single planar region', () => {
    const r = segmentMesh(flatPlate());
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.kind).toBe('planar');
  });

  it('unit cube yields 6 regions (one per face)', () => {
    const r = segmentMesh(unitCube());
    expect(r.regions).toHaveLength(6);
  });

  it('each cube region is planar', () => {
    const r = segmentMesh(unitCube());
    for (const region of r.regions) {
      expect(region.kind).toBe('planar');
    }
  });

  it('each cube region has 2 triangles', () => {
    const r = segmentMesh(unitCube());
    for (const region of r.regions) {
      expect(region.triangleIds).toHaveLength(2);
    }
  });

  it('triangleToRegion mapping covers all triangles', () => {
    const mesh = unitCube();
    const r = segmentMesh(mesh);
    expect(r.triangleToRegion).toHaveLength(12);
    for (const id of r.triangleToRegion) {
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('total area of regions ≈ total mesh area', () => {
    const mesh = unitCube();
    const r = segmentMesh(mesh);
    const total = r.regions.reduce((s, region) => s + region.areaMm2, 0);
    expect(total).toBeCloseTo(6, 3);
  });

  it('minRegionAreaMm2 filters small regions', () => {
    const r = segmentMesh(flatPlate(), { minRegionAreaMm2: 1000 });
    expect(r.regions).toEqual([]);
    expect(r.orphanTriangles.length).toBeGreaterThan(0);
  });

  it('growthAngleDeg larger → fewer regions', () => {
    const tight = segmentMesh(unitCube(), { growthAngleDeg: 5 });
    const loose = segmentMesh(unitCube(), { growthAngleDeg: 90 });
    expect(loose.regions.length).toBeLessThanOrEqual(tight.regions.length);
  });

  it('mean normal is unit length', () => {
    const r = segmentMesh(unitCube());
    for (const region of r.regions) {
      const len = Math.hypot(region.meanNormal[0], region.meanNormal[1], region.meanNormal[2]);
      expect(len).toBeCloseTo(1, 5);
    }
  });
});

describe('triangleNormalArea', () => {
  it('returns +Z normal for XY-aligned triangle', () => {
    const r = triangleNormalArea([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(r.normal[2]).toBeCloseTo(1, 5);
  });

  it('degenerate triangle has zero area', () => {
    const r = triangleNormalArea([0, 0, 0], [0, 0, 0], [0, 0, 0]);
    expect(r.area).toBe(0);
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const s = summarize({ regions: [], triangleToRegion: [], orphanTriangles: [] });
    expect(s.regionCount).toBe(0);
    expect(s.planarCount).toBe(0);
  });

  it('cube → 6 planar regions', () => {
    const s = summarize(segmentMesh(unitCube()));
    expect(s.planarCount).toBe(6);
    expect(s.cylindricalCount).toBe(0);
  });

  it('largestRegionAreaMm2 = max region area', () => {
    const r = segmentMesh(unitCube());
    const s = summarize(r);
    const max = Math.max(...r.regions.map(reg => reg.areaMm2));
    expect(s.largestRegionAreaMm2).toBe(max);
  });

  it('orphan triangle count reported', () => {
    const r = segmentMesh(flatPlate(), { minRegionAreaMm2: 1000 });
    const s = summarize(r);
    expect(s.orphanTriangleCount).toBeGreaterThan(0);
  });
});
