import { describe, it, expect } from 'vitest';
import {
  linearPattern,
  circularPattern,
  composePatterns,
  sketchDrivenPattern,
} from './advancedComponentPattern';

describe('linearPattern', () => {
  it('creates N instances with uniform spacing', () => {
    const r = linearPattern({ count: 5, spacingMm: 10 });
    expect(r).toHaveLength(5);
    expect(r[2]!.transform[3]).toBe(20); // x offset
  });

  it('honors custom axis', () => {
    const r = linearPattern({ count: 3, spacingMm: 10, axis: [0, 1, 0] });
    expect(r[1]!.transform[7]).toBe(10); // y offset
  });

  it('honors custom offsets per instance', () => {
    const r = linearPattern({ count: 3, spacingMm: 10, customOffsets: [0, 5, 15] });
    expect(r[1]!.transform[3]).toBe(5);
    expect(r[2]!.transform[3]).toBe(15);
  });
});

describe('circularPattern', () => {
  it('full circle distributes evenly', () => {
    const r = circularPattern({ count: 4, fullCircle: true });
    expect(r).toHaveLength(4);
    // 4 instances, full circle = 90° apart.
    expect(r[1]!.transform[0]).toBeCloseTo(Math.cos(Math.PI / 2), 5);
  });

  it('honors totalAngle for non-full circle', () => {
    const r = circularPattern({ count: 3, fullCircle: false, totalAngleDeg: 180 });
    expect(r).toHaveLength(3);
  });

  it('axis x rotates about X', () => {
    const r = circularPattern({ count: 4, axis: 'x' });
    // The X-axis rotation matrix has 1 at index 0.
    expect(r[1]!.transform[0]).toBe(1);
  });
});

describe('composePatterns', () => {
  it('multiplies inner × outer', () => {
    const outer = linearPattern({ count: 2, spacingMm: 100 });
    const inner = linearPattern({ count: 3, spacingMm: 10, axis: [0, 1, 0] });
    const r = composePatterns({ outer, inner });
    expect(r).toHaveLength(6);
  });

  it('preserves index chains', () => {
    const outer = linearPattern({ count: 2, spacingMm: 100 });
    const inner = linearPattern({ count: 3, spacingMm: 10 });
    const r = composePatterns({ outer, inner });
    expect(r[0]!.indexChain).toEqual([0, 0]);
    expect(r[5]!.indexChain).toEqual([1, 2]);
  });
});

describe('sketchDrivenPattern', () => {
  it('places one instance per point', () => {
    const r = sketchDrivenPattern({ points: [[0, 0], [10, 0], [10, 10]] });
    expect(r).toHaveLength(3);
  });

  it('respects plane override', () => {
    const r = sketchDrivenPattern({ points: [[5, 7]], plane: 'xz' });
    expect(r[0]!.transform[3]).toBe(5);  // tx = u
    expect(r[0]!.transform[11]).toBe(7); // tz = v
  });

  it('subsamples when sampleCount is smaller than points', () => {
    const points = Array.from({ length: 100 }, (_, i) => [i, 0] as [number, number]);
    const r = sketchDrivenPattern({ points, sampleCount: 5 });
    expect(r).toHaveLength(5);
  });
});
