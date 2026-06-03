import { describe, it, expect } from 'vitest';
import {
  buildRib,
  ribToScad,
  ribLength,
  ribAngleDegrees,
  type RibFeature,
} from './ribFeature';

describe('buildRib (validation)', () => {
  it('builds a valid rib with defaults', () => {
    const f = buildRib({
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      thickness: 2,
      height: 5,
    });
    expect(f.kind).toBe('rib');
    expect(f.centered).toBe(false);
    expect(f.start).toEqual({ x: 0, y: 0 });
    expect(f.end).toEqual({ x: 10, y: 0 });
  });

  it('honours the centered flag', () => {
    const f = buildRib({
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      thickness: 2,
      height: 5,
      centered: true,
    });
    expect(f.centered).toBe(true);
  });

  it('rejects zero / negative thickness', () => {
    expect(() =>
      buildRib({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0, height: 5 }),
    ).toThrow(/thickness/);
    expect(() =>
      buildRib({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: -1, height: 5 }),
    ).toThrow(/thickness/);
  });

  it('rejects zero / negative height', () => {
    expect(() =>
      buildRib({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 2, height: 0 }),
    ).toThrow(/height/);
  });

  it('rejects a degenerate (start == end) centerline', () => {
    expect(() =>
      buildRib({ start: { x: 3, y: 3 }, end: { x: 3, y: 3 }, thickness: 2, height: 5 }),
    ).toThrow(/degenerate/);
  });

  it('rejects non-finite coordinates', () => {
    expect(() =>
      buildRib({ start: { x: NaN, y: 0 }, end: { x: 10, y: 0 }, thickness: 2, height: 5 }),
    ).toThrow(/finite/);
  });
});

describe('ribLength & ribAngleDegrees', () => {
  it('computes length for a 3-4-5 triangle', () => {
    const f = buildRib({
      start: { x: 1, y: 1 },
      end: { x: 4, y: 5 },
      thickness: 2,
      height: 5,
    });
    expect(ribLength(f)).toBeCloseTo(5, 10);
  });

  it('computes angle for axis-aligned and 45deg ribs', () => {
    const horiz = buildRib({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 2, height: 5 });
    expect(ribAngleDegrees(horiz)).toBeCloseTo(0, 10);

    const diag = buildRib({ start: { x: 0, y: 0 }, end: { x: 5, y: 5 }, thickness: 2, height: 5 });
    expect(ribAngleDegrees(diag)).toBeCloseTo(45, 10);
  });
});

describe('ribToScad', () => {
  const horiz: RibFeature = buildRib({
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
    thickness: 2,
    height: 5,
  });

  it('emits a cube with length/thickness/height for an axis-aligned rib', () => {
    const scad = ribToScad(horiz);
    expect(scad).toContain('cube(size=[10, 2, 5]');
    expect(scad).toContain('rotate([0, 0, 0])');
    expect(scad).toContain('translate([0, 0, 0])');
  });

  it('emits the 45deg rotation angle for a diagonal rib', () => {
    const diag = buildRib({ start: { x: 0, y: 0 }, end: { x: 5, y: 5 }, thickness: 2, height: 5 });
    const scad = ribToScad(diag);
    expect(scad).toContain('rotate([0, 0, 45])');
    // length = sqrt(50) ~= 7.0711
    expect(scad).toContain('cube(size=[7.0711, 2, 5]');
  });

  it('centered flag changes the translate to the midpoint and center=[true,...]', () => {
    const offCenter = ribToScad(horiz);
    const centered = ribToScad(
      buildRib({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 2, height: 5, centered: true }),
    );
    // non-centered anchors at start (0,0); centered anchors at midpoint (5,0).
    expect(offCenter).toContain('translate([0, 0, 0])');
    expect(centered).toContain('translate([5, 0, 0])');
    expect(offCenter).toContain('center=[false, true, false]');
    expect(centered).toContain('center=[true, true, false]');
  });

  it('is deterministic for identical input', () => {
    expect(ribToScad(horiz)).toBe(ribToScad(horiz));
  });
});
