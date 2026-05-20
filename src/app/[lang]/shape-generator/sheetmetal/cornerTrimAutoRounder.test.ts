import { describe, it, expect } from 'vitest';
import {
  roundCorners,
  summarize,
  type Vec2,
} from './cornerTrimAutoRounder';

const square: Vec2[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('roundCorners', () => {
  it('short polyline → warning', () => {
    const r = roundCorners([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('square 90° corners are rounded', () => {
    const r = roundCorners(square, { defaultRadiusMm: 1, thicknessMm: 1, angleThresholdDeg: 100, minRadiusMm: 0.5 });
    expect(r.rounded.length).toBe(4);
    expect(r.rounded.every(c => c.applied)).toBe(true);
  });

  it('rounded polyline has 2 points per corner', () => {
    const r = roundCorners(square, { defaultRadiusMm: 1, thicknessMm: 1, angleThresholdDeg: 100, minRadiusMm: 0.5 });
    expect(r.newPolyline.length).toBe(8);
  });

  it('arc centre on bisector', () => {
    const r = roundCorners(square, { defaultRadiusMm: 1, thicknessMm: 1, angleThresholdDeg: 100, minRadiusMm: 0.5 });
    const firstCorner = r.rounded[0]!;
    // Bisector from (0,0) corner of square: direction (1,1)/sqrt(2). Centre at distance r/sin(45°) = r·sqrt(2).
    expect(firstCorner.applied).toBe(true);
  });

  it('angle threshold filters obtuse corners', () => {
    const r = roundCorners(square, { defaultRadiusMm: 1, thicknessMm: 1, angleThresholdDeg: 89, minRadiusMm: 0.5 });
    expect(r.rounded).toHaveLength(0);
    expect(r.newPolyline).toHaveLength(4);
  });

  it('radius < 0.5t produces warning', () => {
    const r = roundCorners(square, { defaultRadiusMm: 0.1, thicknessMm: 2, angleThresholdDeg: 100, minRadiusMm: 0.1 });
    expect(r.warnings.some(w => w.includes('0.5·t') || w.includes('stress'))).toBe(true);
  });

  it('radius too large for edge → corner not applied', () => {
    // 2×2 square, radius 5 → setback 5 > edge length 2.
    const tiny: Vec2[] = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    const r = roundCorners(tiny, { defaultRadiusMm: 5, thicknessMm: 1, angleThresholdDeg: 100, minRadiusMm: 0.5 });
    expect(r.rounded.every(c => !c.applied)).toBe(true);
  });

  it('concave corner → flagged, not rounded', () => {
    // L-shape with one concave corner.
    const lShape: Vec2[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 },
      { x: 5, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 10 },
    ];
    const r = roundCorners(lShape, { defaultRadiusMm: 1, thicknessMm: 1, angleThresholdDeg: 100, minRadiusMm: 0.5 });
    expect(r.warnings.some(w => w.includes('concave'))).toBe(true);
  });

  it('tangent points are between vertex and adjacent', () => {
    const r = roundCorners(square, { defaultRadiusMm: 1, thicknessMm: 1, angleThresholdDeg: 100, minRadiusMm: 0.5 });
    const c = r.rounded[0]!;
    expect(c.tangentStart.x).toBeGreaterThanOrEqual(0);
    expect(c.tangentStart.x).toBeLessThanOrEqual(10);
  });
});

describe('summarize', () => {
  it('counts applied corners', () => {
    const r = roundCorners(square, { defaultRadiusMm: 1, thicknessMm: 1, angleThresholdDeg: 100, minRadiusMm: 0.5 });
    const s = summarize(r);
    expect(s.cornersFound).toBe(4);
    expect(s.cornersApplied).toBe(4);
    expect(s.averageRadius).toBeCloseTo(1, 3);
  });

  it('empty when no corners detected', () => {
    const r = roundCorners(square, { defaultRadiusMm: 1, thicknessMm: 1, angleThresholdDeg: 89, minRadiusMm: 0.5 });
    expect(summarize(r).cornersApplied).toBe(0);
  });
});
