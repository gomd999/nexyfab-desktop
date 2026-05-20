import { describe, it, expect } from 'vitest';
import {
  generateBoundary,
  recommendNextToolRadius,
  summarize,
  type Profile,
} from './restMachiningBoundary';

// Square with an internal concave notch (small slot on the right side).
const profile: Profile = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 9 },
  { x: 19, y: 9 },
  { x: 19, y: 11 },
  { x: 20, y: 11 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
];

describe('generateBoundary', () => {
  it('large tool leaves rest material in concave notch', () => {
    const r = generateBoundary({ profile, previousToolRadiusMm: 1.5, gridStepMm: 0.5 });
    expect(r.cellsMarkedCount).toBeGreaterThan(0);
  });

  it('small tool reaches everywhere → no rest', () => {
    const r = generateBoundary({ profile, previousToolRadiusMm: 0.25, gridStepMm: 0.5 });
    expect(r.cellsMarkedCount).toBe(0);
    expect(r.restRegions).toEqual([]);
  });

  it('total rest area is positive when restrictions exist', () => {
    const r = generateBoundary({ profile, previousToolRadiusMm: 1.5, gridStepMm: 0.5 });
    expect(r.totalRestAreaMm2).toBeGreaterThan(0);
  });

  it('zero radius → warning', () => {
    const r = generateBoundary({ profile, previousToolRadiusMm: 0, gridStepMm: 0.5 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('degenerate profile → warning', () => {
    const r = generateBoundary({ profile: [{ x: 0, y: 0 }, { x: 1, y: 0 }], previousToolRadiusMm: 1, gridStepMm: 0.5 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('region polygons each have 4 vertices (bbox shape)', () => {
    const r = generateBoundary({ profile, previousToolRadiusMm: 1.5, gridStepMm: 0.5 });
    for (const region of r.restRegions) {
      expect(region).toHaveLength(4);
    }
  });
});

describe('recommendNextToolRadius', () => {
  it('zero rest → keeps previous radius', () => {
    const r = generateBoundary({ profile, previousToolRadiusMm: 0.25, gridStepMm: 0.5 });
    expect(recommendNextToolRadius(r, 0.25)).toBe(0.25);
  });

  it('rest exists → halve radius', () => {
    const r = generateBoundary({ profile, previousToolRadiusMm: 2, gridStepMm: 0.5 });
    expect(recommendNextToolRadius(r, 2)).toBe(1);
  });
});

describe('summarize', () => {
  it('reports region count + area', () => {
    const r = generateBoundary({ profile, previousToolRadiusMm: 1.5, gridStepMm: 0.5 });
    const s = summarize(r);
    expect(s.regionCount).toBe(r.restRegions.length);
    expect(s.totalRestAreaMm2).toBe(r.totalRestAreaMm2);
  });
});
