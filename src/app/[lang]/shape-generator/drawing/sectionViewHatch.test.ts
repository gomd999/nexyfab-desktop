import { describe, it, expect } from 'vitest';
import {
  generateHatch,
  totalHatchLength,
  summarize,
  type Polygon,
} from './sectionViewHatch';

const square: Polygon = [
  { x: 0, y: 0 },
  { x: 50, y: 0 },
  { x: 50, y: 50 },
  { x: 0, y: 50 },
];

describe('generateHatch', () => {
  it('square produces hatch segments', () => {
    const r = generateHatch({ sectionPolygon: square });
    expect(r.segments.length).toBeGreaterThan(0);
    expect(r.lineCount).toBe(r.segments.length);
  });

  it('default angle 45, spacing 3', () => {
    const r = generateHatch({ sectionPolygon: square });
    expect(r.angleDeg).toBe(45);
    expect(r.spacingMm).toBe(3);
  });

  it('tighter spacing → more segments', () => {
    const coarse = generateHatch({ sectionPolygon: square, spacingMm: 10 });
    const fine = generateHatch({ sectionPolygon: square, spacingMm: 2 });
    expect(fine.segments.length).toBeGreaterThan(coarse.segments.length);
  });

  it('segments lie within polygon bounds', () => {
    const r = generateHatch({ sectionPolygon: square, spacingMm: 5 });
    for (const s of r.segments) {
      expect(s.start.x).toBeGreaterThanOrEqual(-1e-6);
      expect(s.start.x).toBeLessThanOrEqual(50 + 1e-6);
      expect(s.end.y).toBeGreaterThanOrEqual(-1e-6);
      expect(s.end.y).toBeLessThanOrEqual(50 + 1e-6);
    }
  });

  it('degenerate polygon → warning + empty', () => {
    const r = generateHatch({ sectionPolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
    expect(r.segments).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zero spacing → warning', () => {
    const r = generateHatch({ sectionPolygon: square, spacingMm: 0 });
    expect(r.warnings.some(w => w.toLowerCase().includes('spacing'))).toBe(true);
  });

  it('custom angle preserved', () => {
    const r = generateHatch({ sectionPolygon: square, angleDeg: 30 });
    expect(r.angleDeg).toBe(30);
  });

  it('L-shaped (concave) polygon produces clipped segments', () => {
    const lShape: Polygon = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 40 },
      { x: 0, y: 40 },
    ];
    const r = generateHatch({ sectionPolygon: lShape, spacingMm: 5 });
    expect(r.segments.length).toBeGreaterThan(0);
  });
});

describe('totalHatchLength', () => {
  it('positive for filled square', () => {
    const r = generateHatch({ sectionPolygon: square, spacingMm: 5 });
    expect(totalHatchLength(r)).toBeGreaterThan(0);
  });

  it('tighter spacing → more total length', () => {
    const coarse = generateHatch({ sectionPolygon: square, spacingMm: 10 });
    const fine = generateHatch({ sectionPolygon: square, spacingMm: 2 });
    expect(totalHatchLength(fine)).toBeGreaterThan(totalHatchLength(coarse));
  });
});

describe('summarize', () => {
  it('reports line count + angle + spacing', () => {
    const r = generateHatch({ sectionPolygon: square });
    const s = summarize(r);
    expect(s.lineCount).toBe(r.lineCount);
    expect(s.angleDeg).toBe(45);
  });
});
