import { describe, it, expect } from 'vitest';
import {
  arcPath,
  validateSweepPath,
  sweepPathToScad,
  pathLength,
  type SweepPathFeature,
} from './sweepPath';

const square = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
];

describe('arcPath', () => {
  it('returns segments + 1 points', () => {
    const pts = arcPath({ x: 0, y: 0, z: 0 }, 5, 0, 90, 8);
    expect(pts).toHaveLength(9);
  });

  it('places endpoints on the circle at the requested angles (xz plane)', () => {
    const pts = arcPath({ x: 0, y: 0, z: 0 }, 5, 0, 90, 4, 'xz');
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    // start angle 0 → (r, _, 0); end angle 90 → (0, _, r)
    expect(first.x).toBeCloseTo(5, 9);
    expect(first.z).toBeCloseTo(0, 9);
    expect(last.x).toBeCloseTo(0, 9);
    expect(last.z).toBeCloseTo(5, 9);
    // every point lies on the circle of radius 5 in the xz plane
    for (const p of pts) {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(5, 9);
      expect(p.y).toBeCloseTo(0, 9);
    }
  });

  it('honors the center offset and the chosen plane', () => {
    const pts = arcPath({ x: 10, y: 20, z: 30 }, 2, 0, 360, 4, 'xy');
    for (const p of pts) {
      expect(p.z).toBeCloseTo(30, 9);
      expect(Math.hypot(p.x - 10, p.y - 20)).toBeCloseTo(2, 9);
    }
  });

  it('is deterministic for identical inputs', () => {
    const a = arcPath({ x: 1, y: 2, z: 3 }, 4, 15, 200, 7, 'yz');
    const b = arcPath({ x: 1, y: 2, z: 3 }, 4, 15, 200, 7, 'yz');
    expect(a).toEqual(b);
  });

  it('rejects bad radius and segment counts', () => {
    expect(() => arcPath({ x: 0, y: 0, z: 0 }, 0, 0, 90, 4)).toThrow();
    expect(() => arcPath({ x: 0, y: 0, z: 0 }, 5, 0, 90, 0)).toThrow();
    expect(() => arcPath({ x: 0, y: 0, z: 0 }, 5, 0, 90, 2.5)).toThrow();
  });
});

describe('pathLength', () => {
  it('sums the consecutive segment lengths', () => {
    const f: SweepPathFeature = {
      kind: 'sweep_path',
      profile: square,
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
        { x: 3, y: 4, z: 0 },
      ],
    };
    // 3 + 4 = 7
    expect(pathLength(f)).toBeCloseTo(7, 9);
  });

  it('returns 0 for a degenerate (single point) path', () => {
    const f = {
      kind: 'sweep_path',
      profile: square,
      path: [{ x: 0, y: 0, z: 0 }],
    } as unknown as SweepPathFeature;
    expect(pathLength(f)).toBe(0);
  });
});

describe('validateSweepPath', () => {
  it('accepts a valid feature', () => {
    const f: SweepPathFeature = {
      kind: 'sweep_path',
      profile: square,
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 10 },
      ],
    };
    const r = validateSweepPath(f);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects a profile with fewer than 3 points', () => {
    const f = {
      kind: 'sweep_path',
      profile: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
    } as unknown as SweepPathFeature;
    const r = validateSweepPath(f);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /profile must have/.test(e))).toBe(true);
  });

  it('rejects a path with fewer than 2 points', () => {
    const f = {
      kind: 'sweep_path',
      profile: square,
      path: [{ x: 0, y: 0, z: 0 }],
    } as unknown as SweepPathFeature;
    const r = validateSweepPath(f);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /path must have/.test(e))).toBe(true);
  });

  it('rejects a zero-length consecutive path segment', () => {
    const f: SweepPathFeature = {
      kind: 'sweep_path',
      profile: square,
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 5 },
      ],
    };
    const r = validateSweepPath(f);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /zero-length/.test(e))).toBe(true);
  });
});

describe('sweepPathToScad', () => {
  const arcFeature: SweepPathFeature = {
    kind: 'sweep_path',
    profile: square,
    path: arcPath({ x: 0, y: 0, z: 0 }, 10, 0, 90, 4, 'xz'),
  };

  it('emits union() and hull() blocks', () => {
    const scad = sweepPathToScad(arcFeature);
    expect(scad).toContain('union()');
    expect(scad).toContain('hull()');
  });

  it('produces N-1 hulls for an N-station path', () => {
    const scad = sweepPathToScad(arcFeature);
    const hullCount = (scad.match(/hull\(\)/g) || []).length;
    // arc with 4 segments → 5 stations → 4 hulls
    expect(hullCount).toBe(arcFeature.path.length - 1);
    expect(hullCount).toBe(4);
  });

  it('degenerates a 2-point straight path to a single hull', () => {
    const straight: SweepPathFeature = {
      kind: 'sweep_path',
      profile: square,
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 20 },
      ],
    };
    const scad = sweepPathToScad(straight);
    const hullCount = (scad.match(/hull\(\)/g) || []).length;
    expect(hullCount).toBe(1);
  });

  it('is deterministic', () => {
    expect(sweepPathToScad(arcFeature)).toBe(sweepPathToScad(arcFeature));
  });

  it('throws on an invalid feature', () => {
    const bad = {
      kind: 'sweep_path',
      profile: [{ x: 0, y: 0 }],
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
    } as unknown as SweepPathFeature;
    expect(() => sweepPathToScad(bad)).toThrow();
  });
});
