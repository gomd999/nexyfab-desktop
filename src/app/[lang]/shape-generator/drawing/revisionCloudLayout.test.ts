import { describe, it, expect } from 'vitest';
import {
  buildCloud,
  rectangularCloud,
  summarize,
  type Polygon,
} from './revisionCloudLayout';

const square: Polygon = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
];

describe('buildCloud', () => {
  it('square polygon produces scallop polyline', () => {
    const r = buildCloud({ outlinePolygon: square });
    expect(r.cloudPolyline.length).toBeGreaterThan(0);
    expect(r.scallopCount).toBeGreaterThan(0);
  });

  it('degenerate polygon → warning', () => {
    const r = buildCloud({ outlinePolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('chord length controls scallop count', () => {
    const big = buildCloud({ outlinePolygon: square, chordLengthMm: 8 });
    const small = buildCloud({ outlinePolygon: square, chordLengthMm: 2 });
    expect(small.scallopCount).toBeGreaterThan(big.scallopCount);
  });

  it('larger offset moves cloud outward', () => {
    const a = buildCloud({ outlinePolygon: square, offsetMarginMm: 1 });
    const b = buildCloud({ outlinePolygon: square, offsetMarginMm: 5 });
    // Both clouds should sample points; b's perimeter is larger than a's.
    expect(b.totalLengthMm).toBeGreaterThan(a.totalLengthMm);
  });

  it('total length matches order-of-magnitude of perimeter', () => {
    const r = buildCloud({ outlinePolygon: square });
    expect(r.totalLengthMm).toBeGreaterThan(80); // base perimeter is 80
  });

  it('arc samples > 0 produces multiple points per scallop', () => {
    const r = buildCloud({ outlinePolygon: square, arcSamplesPerScallop: 6 });
    // each scallop emits arcSamples+1 points → roughly 7 × scallops
    expect(r.cloudPolyline.length).toBeGreaterThanOrEqual(r.scallopCount * 6);
  });
});

describe('rectangularCloud', () => {
  it('wraps bounding rectangle', () => {
    const r = rectangularCloud({ minX: 0, minY: 0, maxX: 50, maxY: 30 });
    expect(r.scallopCount).toBeGreaterThan(0);
  });

  it('options propagate to buildCloud', () => {
    const big = rectangularCloud({ minX: 0, minY: 0, maxX: 50, maxY: 30 }, { chordLengthMm: 10 });
    const small = rectangularCloud({ minX: 0, minY: 0, maxX: 50, maxY: 30 }, { chordLengthMm: 2 });
    expect(small.scallopCount).toBeGreaterThan(big.scallopCount);
  });
});

describe('summarize', () => {
  it('reports counts + length', () => {
    const r = buildCloud({ outlinePolygon: square });
    const s = summarize(r);
    expect(s.scallopCount).toBe(r.scallopCount);
    expect(s.pointCount).toBe(r.cloudPolyline.length);
  });
});
