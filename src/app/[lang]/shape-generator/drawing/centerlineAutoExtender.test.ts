import { describe, it, expect } from 'vitest';
import {
  generateCenterlines,
  totalCenterlineLength,
  summarize,
  type CylindricalFeature,
  type BoltCirclePattern,
  type ViewBounds,
} from './centerlineAutoExtender';

const view: ViewBounds = { min: { x: -1000, y: -1000 }, max: { x: 1000, y: 1000 } };

function hole(id: string, x: number, y: number, dia: number): CylindricalFeature {
  return { id, centre: { x, y }, diameterMm: dia };
}

describe('generateCenterlines', () => {
  it('empty input → empty', () => {
    expect(generateCenterlines([], [], view)).toEqual([]);
  });

  it('one cylinder produces 2 segments (h + v)', () => {
    const segs = generateCenterlines([hole('h1', 0, 0, 10)], [], view);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.kind).toBe('horizontal');
    expect(segs[1]!.kind).toBe('vertical');
  });

  it('horizontal centerline length = diameter + 2·overhang', () => {
    const segs = generateCenterlines([hole('h1', 0, 0, 10)], [], view, { overhangMm: 3, clipToView: false });
    const h = segs[0]!;
    expect(Math.hypot(h.end.x - h.start.x, h.end.y - h.start.y)).toBeCloseTo(16, 3);
  });

  it('clip to view trims long centerline', () => {
    const tinyView: ViewBounds = { min: { x: -5, y: -5 }, max: { x: 5, y: 5 } };
    const segs = generateCenterlines([hole('h1', 0, 0, 10)], [], tinyView, { overhangMm: 50, clipToView: true });
    const h = segs[0]!;
    expect(h.end.x).toBeLessThanOrEqual(5);
    expect(h.start.x).toBeGreaterThanOrEqual(-5);
  });

  it('bolt-circle pattern: 1 PCD line + N angular lines', () => {
    const pattern: BoltCirclePattern = {
      id: 'bc1', centre: { x: 0, y: 0 }, pitchCircleDiameterMm: 100, holeCount: 6, startAngleDeg: 0,
    };
    const segs = generateCenterlines([], [pattern], view);
    expect(segs.length).toBe(1 + 6); // PCD + per-hole
  });

  it('angular lines radiate from centre', () => {
    const pattern: BoltCirclePattern = {
      id: 'bc1', centre: { x: 0, y: 0 }, pitchCircleDiameterMm: 100, holeCount: 4, startAngleDeg: 0,
    };
    const segs = generateCenterlines([], [pattern], view);
    const angular = segs.filter(s => s.kind === 'angular');
    expect(angular.every(s => s.start.x === 0 && s.start.y === 0)).toBe(true);
  });

  it('slot dimensions (width/height) override diameter', () => {
    const slot: CylindricalFeature = { id: 's1', centre: { x: 0, y: 0 }, diameterMm: 10, width: 50, height: 5 };
    const segs = generateCenterlines([slot], [], view, { overhangMm: 1, clipToView: false });
    const h = segs[0]!;
    expect(Math.abs(h.end.x - h.start.x)).toBeCloseTo(52, 1);
  });

  it('pattern hint always set', () => {
    const segs = generateCenterlines([hole('h1', 0, 0, 10)], [], view);
    expect(segs.every(s => s.patternName === 'long-dash-short-dash')).toBe(true);
  });
});

describe('totalCenterlineLength', () => {
  it('sums segment lengths', () => {
    const segs = generateCenterlines([hole('h1', 0, 0, 10)], [], view, { overhangMm: 3, clipToView: false });
    expect(totalCenterlineLength(segs)).toBeCloseTo(32, 3); // 2 * 16
  });

  it('empty → 0', () => {
    expect(totalCenterlineLength([])).toBe(0);
  });
});

describe('summarize', () => {
  it('reports segment + feature counts', () => {
    const pattern: BoltCirclePattern = {
      id: 'bc1', centre: { x: 0, y: 0 }, pitchCircleDiameterMm: 100, holeCount: 4, startAngleDeg: 0,
    };
    const cylinders = [hole('h1', 0, 0, 10)];
    const segs = generateCenterlines(cylinders, [pattern], view);
    const s = summarize(segs, cylinders, [pattern]);
    expect(s.cylinderCount).toBe(1);
    expect(s.patternCount).toBe(1);
    expect(s.segmentCount).toBe(segs.length);
  });

  it('total length > 0 for non-empty', () => {
    const segs = generateCenterlines([hole('h1', 0, 0, 10)], [], view);
    expect(summarize(segs, [hole('h1', 0, 0, 10)], []).totalLengthMm).toBeGreaterThan(0);
  });
});
