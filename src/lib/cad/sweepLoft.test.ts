/**
 * sweepLoft — IR builders + SCAD serializer tests.
 */
import { describe, it, expect } from 'vitest';
import { buildSweep, sweepToScad, buildLoft, loftToScad } from './sweepLoft';
import { extractClosedLoops, type ProfileInput, type ProfilePoint } from '@/lib/sketch/sketchProfile';

function indexById(pts: ReadonlyArray<ProfilePoint>): ReadonlyMap<string, ProfilePoint> {
  return new Map(pts.map((p) => [p.id, p]));
}

function rect(suffix: string, w = 10, h = 5): ProfileInput {
  return {
    points: [
      { id: `${suffix}1`, x: 0, y: 0 },
      { id: `${suffix}2`, x: w, y: 0 },
      { id: `${suffix}3`, x: w, y: h },
      { id: `${suffix}4`, x: 0, y: h },
    ],
    lines: [
      { id: `${suffix}_l1`, p1: `${suffix}1`, p2: `${suffix}2` },
      { id: `${suffix}_l2`, p1: `${suffix}2`, p2: `${suffix}3` },
      { id: `${suffix}_l3`, p1: `${suffix}3`, p2: `${suffix}4` },
      { id: `${suffix}_l4`, p1: `${suffix}4`, p2: `${suffix}1` },
    ],
  };
}

// ─── sweep ────────────────────────────────────────────────────────────────

describe('buildSweep', () => {
  it('rect profile + 3-segment path → sweep feature', () => {
    const inp = rect('p');
    const { loops } = extractClosedLoops(inp);
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 20 },
      { x: 10, y: 0, z: 20 },
    ];
    const f = buildSweep({
      profileLoop: loops[0]!,
      profilePoints: indexById(inp.points),
      path,
    });
    expect(f.kind).toBe('sweep');
    expect(f.profile.points.length).toBe(4);
    expect(f.path.length).toBe(3);
    expect(f.mode).toBe('add');
  });

  it('rejects path with <2 points', () => {
    const inp = rect('p');
    const { loops } = extractClosedLoops(inp);
    expect(() =>
      buildSweep({
        profileLoop: loops[0]!,
        profilePoints: indexById(inp.points),
        path: [{ x: 0, y: 0, z: 0 }],
      }),
    ).toThrow(/at least 2 points/);
  });

  it('rejects zero-length path segments', () => {
    const inp = rect('p');
    const { loops } = extractClosedLoops(inp);
    expect(() =>
      buildSweep({
        profileLoop: loops[0]!,
        profilePoints: indexById(inp.points),
        path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }],
      }),
    ).toThrow(/zero-length/);
  });
});

describe('sweepToScad', () => {
  it('emits BOSL2 path_sweep with profile and 3D path', () => {
    const inp = rect('p');
    const { loops } = extractClosedLoops(inp);
    const f = buildSweep({
      profileLoop: loops[0]!,
      profilePoints: indexById(inp.points),
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 15 },
      ],
    });
    const scad = sweepToScad(f);
    expect(scad).toContain('include <BOSL2/std.scad>');
    expect(scad).toContain('path_sweep');
    expect(scad).toMatch(/\[0,\s*0,\s*0\]/);
    expect(scad).toMatch(/\[0,\s*0,\s*15\]/);
  });

  it('cut mode prepends NEXYFAB:SWEEP_CUT marker', () => {
    const inp = rect('p');
    const { loops } = extractClosedLoops(inp);
    const f = buildSweep({
      profileLoop: loops[0]!,
      profilePoints: indexById(inp.points),
      path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }],
      mode: 'cut',
    });
    const scad = sweepToScad(f);
    expect(scad.startsWith('// NEXYFAB:SWEEP_CUT')).toBe(true);
  });
});

// ─── loft ─────────────────────────────────────────────────────────────────

describe('buildLoft', () => {
  it('2 same-count rect sections at z=0 and z=10 → loft feature', () => {
    const a = rect('a', 10, 10);
    const b = rect('b', 5, 5);
    const aL = extractClosedLoops(a).loops[0]!;
    const bL = extractClosedLoops(b).loops[0]!;
    const f = buildLoft({
      sections: [
        { loop: aL, pointsById: indexById(a.points), z: 0 },
        { loop: bL, pointsById: indexById(b.points), z: 10 },
      ],
    });
    expect(f.kind).toBe('loft');
    expect(f.sections.length).toBe(2);
    expect(f.sections[0]!.z).toBe(0);
    expect(f.sections[1]!.z).toBe(10);
  });

  it('rejects <2 sections', () => {
    const a = rect('a');
    const aL = extractClosedLoops(a).loops[0]!;
    expect(() =>
      buildLoft({ sections: [{ loop: aL, pointsById: indexById(a.points), z: 0 }] }),
    ).toThrow(/≥2 sections/);
  });

  it('rejects non-monotonic z order', () => {
    const a = rect('a');
    const b = rect('b', 5, 5);
    const aL = extractClosedLoops(a).loops[0]!;
    const bL = extractClosedLoops(b).loops[0]!;
    expect(() =>
      buildLoft({
        sections: [
          { loop: aL, pointsById: indexById(a.points), z: 10 },
          { loop: bL, pointsById: indexById(b.points), z: 5 },
        ],
      }),
    ).toThrow(/monotonically/);
  });

  it('rejects mismatched section point counts (Phase 2.2 limit)', () => {
    const a = rect('a'); // 4 points
    const triangle: ProfileInput = {
      points: [
        { id: 't1', x: 0, y: 0 },
        { id: 't2', x: 5, y: 0 },
        { id: 't3', x: 2.5, y: 4 },
      ],
      lines: [
        { id: 'tl1', p1: 't1', p2: 't2' },
        { id: 'tl2', p1: 't2', p2: 't3' },
        { id: 'tl3', p1: 't3', p2: 't1' },
      ],
    };
    const aL = extractClosedLoops(a).loops[0]!;
    const tL = extractClosedLoops(triangle).loops[0]!;
    expect(() =>
      buildLoft({
        sections: [
          { loop: aL, pointsById: indexById(a.points), z: 0 },
          { loop: tL, pointsById: indexById(triangle.points), z: 5 },
        ],
      }),
    ).toThrow(/point count/);
  });
});

describe('loftToScad', () => {
  it('emits BOSL2 skin with lifted 3D profiles', () => {
    const a = rect('a', 10, 10);
    const b = rect('b', 5, 5);
    const aL = extractClosedLoops(a).loops[0]!;
    const bL = extractClosedLoops(b).loops[0]!;
    const f = buildLoft({
      sections: [
        { loop: aL, pointsById: indexById(a.points), z: 0 },
        { loop: bL, pointsById: indexById(b.points), z: 15 },
      ],
    });
    const scad = loftToScad(f);
    expect(scad).toContain('include <BOSL2/std.scad>');
    expect(scad).toContain('skin');
    expect(scad).toMatch(/0,\s*15/); // both z levels present somewhere
  });

  it('cut mode prepends NEXYFAB:LOFT_CUT marker', () => {
    const a = rect('a');
    const b = rect('b');
    const aL = extractClosedLoops(a).loops[0]!;
    const bL = extractClosedLoops(b).loops[0]!;
    const f = buildLoft({
      sections: [
        { loop: aL, pointsById: indexById(a.points), z: 0 },
        { loop: bL, pointsById: indexById(b.points), z: 10 },
      ],
      mode: 'cut',
    });
    const scad = loftToScad(f);
    expect(scad.startsWith('// NEXYFAB:LOFT_CUT')).toBe(true);
  });
});
