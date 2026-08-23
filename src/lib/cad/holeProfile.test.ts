/**
 * holeProfile — IR builder + SCAD serializer + tap-drill standards tests.
 */
import { describe, it, expect } from 'vitest';
import {
  buildHoleFeature,
  holeToScad,
  tapDrillDiameter,
  TAP_DRILL_SPECS,
  type ThreadSpec,
} from './holeProfile';

describe('buildHoleFeature — validation', () => {
  it('builds a drilled hole with valid options', () => {
    const f = buildHoleFeature({
      center: { x: 5, y: 5 },
      holeType: 'drilled',
      diameter: 5,
      depth: 10,
    });
    expect(f.kind).toBe('hole');
    expect(f.holeType).toBe('drilled');
    expect(f.center).toEqual({ x: 5, y: 5 });
    expect(f.diameter).toBe(5);
    expect(f.depth).toBe(10);
  });

  it('rejects non-finite center', () => {
    expect(() =>
      buildHoleFeature({
        center: { x: NaN, y: 0 },
        holeType: 'drilled',
        diameter: 5,
        depth: 10,
      }),
    ).toThrow(/finite/);
  });

  it('rejects non-positive diameter', () => {
    expect(() =>
      buildHoleFeature({
        center: { x: 0, y: 0 },
        holeType: 'drilled',
        diameter: 0,
        depth: 10,
      }),
    ).toThrow(/diameter must be positive/);
    expect(() =>
      buildHoleFeature({
        center: { x: 0, y: 0 },
        holeType: 'drilled',
        diameter: -1,
        depth: 10,
      }),
    ).toThrow(/diameter must be positive/);
  });

  it('rejects non-positive depth', () => {
    expect(() =>
      buildHoleFeature({
        center: { x: 0, y: 0 },
        holeType: 'drilled',
        diameter: 5,
        depth: 0,
      }),
    ).toThrow(/depth must be positive/);
  });

  it('preserves a valid drill-tip angle and rejects non-physical angles', () => {
    const feature = buildHoleFeature({
      center: { x: 0, y: 0 }, holeType: 'drilled', diameter: 6, depth: 10, drillTipAngleDegrees: 135,
    });
    expect(feature.drillTipAngleDegrees).toBe(135);
    expect(() => buildHoleFeature({
      center: { x: 0, y: 0 }, holeType: 'drilled', diameter: 6, depth: 10, drillTipAngleDegrees: 180,
    })).toThrow(/drill tip angle/);
  });

  it('serializes an explicit blind termination with a conical drill point', () => {
    const feature = buildHoleFeature({
      center: { x: 0, y: 0 }, holeType: 'drilled', diameter: 6, depth: 8,
      terminationMode: 'blind', drillTipAngleDegrees: 118,
    });
    expect(feature.terminationMode).toBe('blind');
    const scad = holeToScad(feature);
    expect(scad).toContain('d1=0, d2=6');
    expect(scad.match(/cylinder\(/g)).toHaveLength(2);
  });

  it('counterbore requires counterboreDiameter > bore diameter', () => {
    expect(() =>
      buildHoleFeature({
        center: { x: 0, y: 0 },
        holeType: 'counterbore',
        diameter: 5,
        depth: 10,
        counterboreDiameter: 4, // smaller than bore — invalid
        counterboreDepth: 3,
      }),
    ).toThrow(/greater than bore/);
  });

  it('counterbore requires positive counterboreDepth', () => {
    expect(() =>
      buildHoleFeature({
        center: { x: 0, y: 0 },
        holeType: 'counterbore',
        diameter: 5,
        depth: 10,
        counterboreDiameter: 10,
        counterboreDepth: 0,
      }),
    ).toThrow(/counterboreDepth/);
  });

  it('countersink angle out of [82, 135] is rejected', () => {
    expect(() =>
      buildHoleFeature({
        center: { x: 0, y: 0 },
        holeType: 'countersink',
        diameter: 5,
        depth: 10,
        countersinkAngleDegrees: 60,
        countersinkDepth: 3,
      }),
    ).toThrow(/82.*135/);
    expect(() =>
      buildHoleFeature({
        center: { x: 0, y: 0 },
        holeType: 'countersink',
        diameter: 5,
        depth: 10,
        countersinkAngleDegrees: 200,
        countersinkDepth: 3,
      }),
    ).toThrow(/82.*135/);
  });

  it('countersink accepts ISO 90° and ANSI 100° + boundaries 82/135', () => {
    for (const angle of [82, 90, 100, 118, 135]) {
      const f = buildHoleFeature({
        center: { x: 0, y: 0 },
        holeType: 'countersink',
        diameter: 5,
        depth: 10,
        countersinkAngleDegrees: angle,
        countersinkDepth: 3,
      });
      expect(f.countersinkAngleDegrees).toBe(angle);
    }
  });
});

describe('holeToScad', () => {
  it('drilled hole emits translate + single cylinder', () => {
    const f = buildHoleFeature({
      center: { x: 5, y: 5 },
      holeType: 'drilled',
      diameter: 4,
      depth: 8,
    });
    const scad = holeToScad(f);
    expect(scad).toContain('NEXYFAB:HOLE_CUT');
    expect(scad).toContain('translate([5, 5, 0])');
    // bore cylinder
    expect(scad).toMatch(/cylinder\(h=8\.01,\s*d=4/);
    // single cylinder only (no cbore / csink)
    const cylinderCount = (scad.match(/cylinder\(/g) ?? []).length;
    expect(cylinderCount).toBe(1);
  });

  it('host-aware auto cutter overlaps the full one-sided host thickness', () => {
    const f = buildHoleFeature({
      center: { x: 5, y: 5 }, holeType: 'drilled', diameter: 4, depth: 2,
    });
    const scad = holeToScad(f, 10);
    expect(scad).toMatch(/translate\(\[0, 0, -0\.01\]\) cylinder\(h=10\.02, d=4/);
  });

  it('counterbore emits two stacked cylinders (bore + cbore)', () => {
    const f = buildHoleFeature({
      center: { x: 0, y: 0 },
      holeType: 'counterbore',
      diameter: 5,
      depth: 15,
      counterboreDiameter: 10,
      counterboreDepth: 4,
    });
    const scad = holeToScad(f);
    const cylinderCount = (scad.match(/cylinder\(/g) ?? []).length;
    expect(cylinderCount).toBe(2);
    expect(scad).toMatch(/d=5/); // bore
    expect(scad).toMatch(/d=10/); // cbore
  });

  it('countersink emits bore + cone (d1, d2)', () => {
    const f = buildHoleFeature({
      center: { x: 0, y: 0 },
      holeType: 'countersink',
      diameter: 5,
      depth: 12,
      countersinkAngleDegrees: 90,
      countersinkDepth: 3,
    });
    const scad = holeToScad(f);
    expect(scad).toMatch(/d=5/); // bore
    expect(scad).toMatch(/d1=5/); // cone bottom (= bore)
    expect(scad).toMatch(/d2=/); // cone top
    // d2 must be > d1 for a 90° csink (3mm * tan(45) = 3 → topD = 5 + 6 = 11).
    const m = scad.match(/d2=([\d.]+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(5);
  });

  it('output is deterministic — same input → same string', () => {
    const f1 = buildHoleFeature({
      center: { x: 3, y: 4 },
      holeType: 'counterbore',
      diameter: 6,
      depth: 12,
      counterboreDiameter: 12,
      counterboreDepth: 4,
    });
    const f2 = buildHoleFeature({
      center: { x: 3, y: 4 },
      holeType: 'counterbore',
      diameter: 6,
      depth: 12,
      counterboreDiameter: 12,
      counterboreDepth: 4,
    });
    expect(holeToScad(f1)).toBe(holeToScad(f2));
  });
});

describe('tapDrillDiameter — ISO/ANSI standards', () => {
  it('ISO metric: M3=2.5, M4=3.3, M5=4.2, M6=5.0, M8=6.8, M10=8.5', () => {
    expect(tapDrillDiameter('M3')).toBe(2.5);
    expect(tapDrillDiameter('M4')).toBe(3.3);
    expect(tapDrillDiameter('M5')).toBe(4.2);
    expect(tapDrillDiameter('M6')).toBe(5.0);
    expect(tapDrillDiameter('M8')).toBe(6.8);
    expect(tapDrillDiameter('M10')).toBe(8.5);
  });

  it('M12 = 10.2 (ISO coarse)', () => {
    expect(tapDrillDiameter('M12')).toBe(10.2);
  });

  it('ANSI UNC inch sizes resolve to mm', () => {
    expect(tapDrillDiameter('1/4-20')).toBeCloseTo(5.105, 3);
    expect(tapDrillDiameter('5/16-18')).toBeCloseTo(6.527, 3);
    expect(tapDrillDiameter('3/8-16')).toBeCloseTo(7.938, 3);
    expect(tapDrillDiameter('1/2-13')).toBeCloseTo(10.716, 3);
  });

  it('TAP_DRILL_SPECS exposes all known specs', () => {
    expect(TAP_DRILL_SPECS).toContain('M3');
    expect(TAP_DRILL_SPECS).toContain('M10');
    expect(TAP_DRILL_SPECS).toContain('1/4-20');
    // Each spec must resolve to a positive diameter.
    for (const spec of TAP_DRILL_SPECS) {
      expect(tapDrillDiameter(spec)).toBeGreaterThan(0);
    }
  });

  it('unknown thread spec throws', () => {
    expect(() => tapDrillDiameter('M99' as ThreadSpec)).toThrow(/unknown/);
  });
});
