import { describe, it, expect } from 'vitest';
import {
  roundCorners,
  timeSaved,
  summarize,
  type CornerRoundingInput,
} from './cornerRoundingPath';

// An L-shaped path with one 90° corner.
const base: CornerRoundingInput = {
  path: [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 50 },
  ],
  maxDeviationMm: 0.5,
  lateralAccelMmPerS2: 3000,
  maxFeedMmMin: 5000,
};

describe('roundCorners', () => {
  it('one 90° corner rounded', () => {
    const r = roundCorners(base);
    expect(r.corners).toHaveLength(1);
    expect(r.corners[0]!.interiorAngleDeg).toBeCloseTo(90, 0);
  });

  it('arc radius positive', () => {
    const r = roundCorners(base);
    expect(r.corners[0]!.arcRadiusMm).toBeGreaterThan(0);
  });

  it('cornering feed limited by lateral accel', () => {
    const r = roundCorners(base);
    const c = r.corners[0]!;
    const expected = Math.min(base.maxFeedMmMin, Math.sqrt(base.lateralAccelMmPerS2 * c.arcRadiusMm) * 60);
    expect(c.corneringFeedMmMin).toBeCloseTo(expected, 3);
  });

  it('larger deviation tolerance → larger radius → higher feed', () => {
    const tight = roundCorners({ ...base, maxDeviationMm: 0.1 });
    const loose = roundCorners({ ...base, maxDeviationMm: 2 });
    expect(loose.corners[0]!.arcRadiusMm).toBeGreaterThan(tight.corners[0]!.arcRadiusMm);
    expect(loose.minCorneringFeedMmMin).toBeGreaterThanOrEqual(tight.minCorneringFeedMmMin);
  });

  it('nearly straight corner skipped', () => {
    const r = roundCorners({
      ...base,
      path: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0.1 }],
    });
    expect(r.corners).toHaveLength(0);
  });

  it('very sharp corner counted as sharp, not rounded', () => {
    const r = roundCorners({
      ...base,
      path: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 0.5 }], // near 180° fold back
    });
    expect(r.sharpCornerCount).toBeGreaterThan(0);
  });

  it('feed capped at commanded max', () => {
    const r = roundCorners({ ...base, maxFeedMmMin: 100, maxDeviationMm: 5 });
    expect(r.corners[0]!.corneringFeedMmMin).toBeLessThanOrEqual(100);
  });

  it('too few points → warning', () => {
    const r = roundCorners({ ...base, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('multiple corners all rounded', () => {
    const r = roundCorners({
      ...base,
      path: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }],
    });
    expect(r.corners.length).toBe(2);
  });
});

describe('timeSaved', () => {
  it('positive for rounded corners', () => {
    const r = roundCorners(base);
    expect(timeSaved(r, 3000)).toBeGreaterThan(0);
  });

  it('zero corners → zero saved', () => {
    const r = roundCorners({ ...base, path: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }] });
    expect(timeSaved(r, 3000)).toBe(0);
  });
});

describe('summarize', () => {
  it('reports counts + feed', () => {
    const r = roundCorners(base);
    const s = summarize(r);
    expect(s.roundedCorners).toBe(r.corners.length);
    expect(s.minCorneringFeedMmMin).toBe(r.minCorneringFeedMmMin);
  });
});
