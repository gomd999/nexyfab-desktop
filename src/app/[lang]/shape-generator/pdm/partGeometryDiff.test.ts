import { describe, it, expect } from 'vitest';
import {
  diffParts,
  computeMassProperties,
  summarize,
  type MeshArrays,
} from './partGeometryDiff';

function unitCube(): MeshArrays {
  return {
    positions: [
      0, 0, 0,  10, 0, 0,  10, 10, 0,  0, 10, 0,
      0, 0, 10,  10, 0, 10,  10, 10, 10,  0, 10, 10,
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

function scaledCube(s: number): MeshArrays {
  const m = unitCube();
  return { positions: m.positions.map(v => v * s), indices: m.indices };
}

describe('diffParts', () => {
  it('identical meshes → verdict identical', () => {
    const d = diffParts(
      { revision: 'A', mesh: unitCube() },
      { revision: 'B', mesh: unitCube() },
    );
    expect(d.verdict).toBe('identical');
  });

  it('scaled mesh → significant or major', () => {
    const d = diffParts(
      { revision: 'A', mesh: unitCube() },
      { revision: 'B', mesh: scaledCube(2) },
    );
    expect(['significant', 'major']).toContain(d.verdict);
  });

  it('bbox delta reflects size change', () => {
    const d = diffParts(
      { revision: 'A', mesh: unitCube() },
      { revision: 'B', mesh: scaledCube(2) },
    );
    expect(d.bboxDelta.largestDelta).toBeCloseTo(10, 1);
  });

  it('volume delta has correct sign', () => {
    const d = diffParts(
      { revision: 'A', mesh: unitCube() },
      { revision: 'B', mesh: scaledCube(2) },
    );
    expect(d.volumeDeltaCm3).toBeGreaterThan(0);
  });

  it('mass delta reported when density provided', () => {
    const d = diffParts(
      { revision: 'A', mesh: unitCube(), densityGcm3: 7.85 },
      { revision: 'B', mesh: scaledCube(1.5), densityGcm3: 7.85 },
    );
    expect(d.massDeltaGrams).toBeDefined();
    expect(d.massDeltaGrams!).toBeGreaterThan(0);
  });

  it('mass delta absent without density', () => {
    const d = diffParts(
      { revision: 'A', mesh: unitCube() },
      { revision: 'B', mesh: unitCube() },
    );
    expect(d.massDeltaGrams).toBeUndefined();
  });

  it('centroid shift = 0 for identical meshes', () => {
    const d = diffParts(
      { revision: 'A', mesh: unitCube() },
      { revision: 'B', mesh: unitCube() },
    );
    expect(d.centroidShiftMm).toBeLessThan(0.001);
  });

  it('records rev labels', () => {
    const d = diffParts(
      { revision: 'A', mesh: unitCube() },
      { revision: 'B', mesh: unitCube() },
    );
    expect(d.revA).toBe('A');
    expect(d.revB).toBe('B');
  });

  it('computeSurface enables surface deviation reporting', () => {
    const d = diffParts(
      { revision: 'A', mesh: unitCube() },
      { revision: 'B', mesh: scaledCube(1.5) },
      { computeSurface: true, surfaceSamples: 20 },
    );
    expect(d.surfaceDeviationMm).toBeDefined();
    expect(d.surfaceDeviationMm!).toBeGreaterThan(0);
  });
});

describe('computeMassProperties', () => {
  it('empty mesh → zero volume', () => {
    const m = computeMassProperties({ positions: [], indices: [] });
    expect(m.volumeCm3).toBe(0);
  });

  it('unit cube volume = 1 cm³ (10mm × 10mm × 10mm = 1000mm³)', () => {
    const m = computeMassProperties(unitCube());
    expect(m.volumeCm3).toBeCloseTo(1, 2);
  });

  it('mass = volume × density when provided', () => {
    const m = computeMassProperties(unitCube(), 8);
    expect(m.massGrams).toBeCloseTo(8, 2);
  });

  it('bbox spans 0..10 for unit cube test mesh', () => {
    const m = computeMassProperties(unitCube());
    expect(m.bbox.min).toEqual([0, 0, 0]);
    expect(m.bbox.max).toEqual([10, 10, 10]);
  });

  it('centroid roughly at center for unit cube', () => {
    const m = computeMassProperties(unitCube());
    expect(m.centroid[0]).toBeCloseTo(5, 1);
    expect(m.centroid[1]).toBeCloseTo(5, 1);
    expect(m.centroid[2]).toBeCloseTo(5, 1);
  });
});

describe('summarize', () => {
  it('identical → no topology change', () => {
    const d = diffParts(
      { revision: 'A', mesh: unitCube() },
      { revision: 'B', mesh: unitCube() },
    );
    const s = summarize(d);
    expect(s.topologyChanged).toBe(false);
  });

  it('reports volume change percent', () => {
    const d = diffParts(
      { revision: 'A', mesh: unitCube() },
      { revision: 'B', mesh: scaledCube(2) },
    );
    const s = summarize(d);
    expect(s.volumeChangePct).toBeGreaterThan(0);
  });

  it('largestBboxDeltaMm matches diff', () => {
    const d = diffParts(
      { revision: 'A', mesh: unitCube() },
      { revision: 'B', mesh: scaledCube(2) },
    );
    const s = summarize(d);
    expect(s.largestBboxDeltaMm).toBe(d.bboxDelta.largestDelta);
  });
});
