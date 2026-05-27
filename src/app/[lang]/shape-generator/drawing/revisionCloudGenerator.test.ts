import { describe, it, expect } from 'vitest';
import {
  generateClouds,
  mergeOverlappingRegions,
  summarize,
  type RevisionRegion,
  type BBox,
} from './revisionCloudGenerator';

function bbox(x0: number, y0: number, x1: number, y1: number): BBox {
  return { min: { x: x0, y: y0 }, max: { x: x1, y: y1 } };
}

describe('generateClouds', () => {
  it('empty input → empty output', () => {
    expect(generateClouds([])).toEqual([]);
  });

  it('single region produces a cloud path', () => {
    const regions: RevisionRegion[] = [{ id: 'R1', bbox: bbox(0, 0, 20, 20) }];
    const r = generateClouds(regions);
    expect(r).toHaveLength(1);
    expect(r[0]!.points.length).toBeGreaterThan(0);
  });

  it('multiple regions → multiple clouds', () => {
    const regions: RevisionRegion[] = [
      { id: 'R1', bbox: bbox(0, 0, 20, 20) },
      { id: 'R2', bbox: bbox(100, 100, 120, 120) },
    ];
    expect(generateClouds(regions)).toHaveLength(2);
  });

  it('larger bbox → more cloud points', () => {
    const small = generateClouds([{ id: 'a', bbox: bbox(0, 0, 5, 5) }]);
    const big = generateClouds([{ id: 'b', bbox: bbox(0, 0, 100, 100) }]);
    expect(big[0]!.points.length).toBeGreaterThan(small[0]!.points.length);
  });

  it('preserves region id and label', () => {
    const r = generateClouds([{ id: 'R1', bbox: bbox(0, 0, 10, 10), label: 'Δ size' }]);
    expect(r[0]!.revisionId).toBe('R1');
    expect(r[0]!.label).toBe('Δ size');
  });

  it('centroid at bbox center', () => {
    const r = generateClouds([{ id: 'a', bbox: bbox(0, 0, 20, 30) }]);
    expect(r[0]!.centroid.x).toBeCloseTo(10, 5);
    expect(r[0]!.centroid.y).toBeCloseTo(15, 5);
  });

  it('arcSamples option affects point density', () => {
    const few = generateClouds([{ id: 'a', bbox: bbox(0, 0, 50, 50) }], { arcSamples: 4 });
    const many = generateClouds([{ id: 'b', bbox: bbox(0, 0, 50, 50) }], { arcSamples: 16 });
    expect(many[0]!.points.length).toBeGreaterThan(few[0]!.points.length);
  });

  it('bumpRadiusMm respected', () => {
    const small = generateClouds([{ id: 'a', bbox: bbox(0, 0, 100, 100) }], { bumpRadiusMm: 2 });
    const big = generateClouds([{ id: 'b', bbox: bbox(0, 0, 100, 100) }], { bumpRadiusMm: 10 });
    expect(small[0]!.points.length).toBeGreaterThan(big[0]!.points.length);
  });
});

describe('mergeOverlappingRegions', () => {
  it('empty input → empty output', () => {
    expect(mergeOverlappingRegions([])).toEqual([]);
  });

  it('non-overlapping regions are unchanged', () => {
    const regions: RevisionRegion[] = [
      { id: 'a', bbox: bbox(0, 0, 10, 10) },
      { id: 'b', bbox: bbox(100, 100, 110, 110) },
    ];
    expect(mergeOverlappingRegions(regions)).toHaveLength(2);
  });

  it('overlapping regions merge', () => {
    const regions: RevisionRegion[] = [
      { id: 'a', bbox: bbox(0, 0, 10, 10) },
      { id: 'b', bbox: bbox(5, 5, 15, 15) },
    ];
    const merged = mergeOverlappingRegions(regions);
    expect(merged).toHaveLength(1);
  });

  it('margin extends overlap detection', () => {
    const regions: RevisionRegion[] = [
      { id: 'a', bbox: bbox(0, 0, 5, 5) },
      { id: 'b', bbox: bbox(10, 10, 15, 15) },
    ];
    const tight = mergeOverlappingRegions(regions, 0);
    const loose = mergeOverlappingRegions(regions, 10);
    expect(tight).toHaveLength(2);
    expect(loose).toHaveLength(1);
  });

  it('merged region has combined id', () => {
    const regions: RevisionRegion[] = [
      { id: 'a', bbox: bbox(0, 0, 10, 10) },
      { id: 'b', bbox: bbox(5, 5, 15, 15) },
    ];
    const merged = mergeOverlappingRegions(regions);
    expect(merged[0]!.id).toContain('a');
    expect(merged[0]!.id).toContain('b');
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const s = summarize([]);
    expect(s.cloudCount).toBe(0);
    expect(s.totalPointCount).toBe(0);
  });

  it('totals match clouds output', () => {
    const clouds = generateClouds([{ id: 'a', bbox: bbox(0, 0, 50, 50) }]);
    const s = summarize(clouds);
    expect(s.cloudCount).toBe(1);
    expect(s.totalPointCount).toBe(clouds[0]!.points.length);
  });
});
