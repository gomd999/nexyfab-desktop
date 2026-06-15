/**
 * pattern — IR builders + SCAD serializer tests.
 */
import { describe, it, expect } from 'vitest';
import {
  buildLinearPattern,
  linearPatternToScad,
  buildCircularPattern,
  circularPatternToScad,
} from './pattern';

const DEMO_CHILD = 'cube([5, 5, 5]);';

// ─── linear ───────────────────────────────────────────────────────────────

describe('buildLinearPattern', () => {
  it('builds a pattern with normalized direction', () => {
    const f = buildLinearPattern({
      childScad: DEMO_CHILD,
      count: 5,
      direction: { x: 10, y: 0, z: 0 }, // non-unit input
      spacing: 8,
    });
    expect(f.count).toBe(5);
    expect(f.direction.x).toBeCloseTo(1, 9);
    expect(f.direction.y).toBeCloseTo(0, 9);
    expect(f.direction.z).toBeCloseTo(0, 9);
    expect(f.spacing).toBe(8);
  });

  it('rejects count < 1, non-integer, or > 1000', () => {
    const base = {
      childScad: DEMO_CHILD,
      direction: { x: 1, y: 0, z: 0 },
      spacing: 5,
    };
    expect(() => buildLinearPattern({ ...base, count: 0 })).toThrow(/positive integer/);
    expect(() => buildLinearPattern({ ...base, count: 2.5 })).toThrow(/positive integer/);
    expect(() => buildLinearPattern({ ...base, count: 1001 })).toThrow(/1000/);
  });

  it('rejects non-positive spacing', () => {
    expect(() =>
      buildLinearPattern({
        childScad: DEMO_CHILD,
        count: 3,
        direction: { x: 1, y: 0, z: 0 },
        spacing: 0,
      }),
    ).toThrow(/spacing/);
  });

  it('rejects zero-length direction', () => {
    expect(() =>
      buildLinearPattern({
        childScad: DEMO_CHILD,
        count: 3,
        direction: { x: 0, y: 0, z: 0 },
        spacing: 5,
      }),
    ).toThrow(/zero-length/);
  });
});

describe('linearPatternToScad', () => {
  it('emits for() loop + translate using normalized direction × spacing', () => {
    const f = buildLinearPattern({
      childScad: DEMO_CHILD,
      count: 4,
      direction: { x: 1, y: 0, z: 0 },
      spacing: 10,
    });
    const scad = linearPatternToScad(f);
    expect(scad).toContain('module nexyfab_pattern_child');
    expect(scad).toContain('cube([5, 5, 5]);');
    expect(scad).toMatch(/for \(i = \[0 : 3\]\)/);
    expect(scad).toMatch(/translate\(\[10 \* i, 0 \* i, 0 \* i\]\)/);
  });
});

// ─── circular ─────────────────────────────────────────────────────────────

describe('buildCircularPattern', () => {
  it('builds a 6-copy full-circle pattern around the Z axis', () => {
    const f = buildCircularPattern({
      childScad: DEMO_CHILD,
      count: 6,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
    });
    expect(f.count).toBe(6);
    expect(f.totalAngleDegrees).toBe(360);
    expect(f.axisDirection.z).toBeCloseTo(1, 9);
  });

  it('normalizes non-unit axis direction', () => {
    const f = buildCircularPattern({
      childScad: DEMO_CHILD,
      count: 4,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 5 },
    });
    expect(f.axisDirection.z).toBeCloseTo(1, 9);
  });

  it('rejects count < 2 and count > 1000', () => {
    const base = {
      childScad: DEMO_CHILD,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
    };
    expect(() => buildCircularPattern({ ...base, count: 1 })).toThrow(/≥ 2/);
    expect(() => buildCircularPattern({ ...base, count: 1001 })).toThrow(/1000/);
  });

  it('rejects angle outside (0, 360]', () => {
    const base = {
      childScad: DEMO_CHILD,
      count: 3,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
    };
    expect(() => buildCircularPattern({ ...base, totalAngleDegrees: 0 })).toThrow(/angle/);
    expect(() => buildCircularPattern({ ...base, totalAngleDegrees: 361 })).toThrow(/angle/);
  });

  it('rejects zero-length axis direction', () => {
    expect(() =>
      buildCircularPattern({
        childScad: DEMO_CHILD,
        count: 3,
        axisOrigin: { x: 0, y: 0, z: 0 },
        axisDirection: { x: 0, y: 0, z: 0 },
      }),
    ).toThrow(/zero-length/);
  });
});

describe('circularPatternToScad', () => {
  it('full 360 sweep uses 360 / count step', () => {
    const f = buildCircularPattern({
      childScad: DEMO_CHILD,
      count: 6,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
    });
    const scad = circularPatternToScad(f);
    expect(scad).toMatch(/i \* 60/); // 360/6 = 60
  });

  it('partial sweep uses totalAngle / (count - 1) step (endpoint inclusive)', () => {
    const f = buildCircularPattern({
      childScad: DEMO_CHILD,
      count: 4,
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
      totalAngleDegrees: 90,
    });
    const scad = circularPatternToScad(f);
    expect(scad).toMatch(/i \* 30/); // 90 / (4-1) = 30
  });

  it('uses translate(origin) → rotate → translate(-origin) for off-origin axis', () => {
    const f = buildCircularPattern({
      childScad: DEMO_CHILD,
      count: 3,
      axisOrigin: { x: 10, y: 5, z: 0 },
      axisDirection: { x: 0, y: 0, z: 1 },
    });
    const scad = circularPatternToScad(f);
    expect(scad).toMatch(/translate\(\[10, 5, 0\]\)/);
    expect(scad).toMatch(/translate\(\[-10, -5, 0\]\)/);
    expect(scad).toMatch(/rotate\(a = i \* 120/);
  });
});
