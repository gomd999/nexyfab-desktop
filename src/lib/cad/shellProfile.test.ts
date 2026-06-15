/**
 * shellProfile — IR builder + SCAD serializer tests (Phase 2.4).
 */
import { describe, it, expect } from 'vitest';
import {
  buildShellFromExtrude,
  shellToScad,
  isAxisAlignedRect,
} from './shellProfile';
import type { ExtrudeFeature } from './extrudeProfile';

function rectExtrude(depth = 20): ExtrudeFeature {
  // 10×5 rect, CCW.
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ],
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
}

describe('isAxisAlignedRect', () => {
  it('accepts a 4-point axis-aligned rectangle', () => {
    expect(
      isAxisAlignedRect([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
        { x: 0, y: 5 },
      ]),
    ).toBe(true);
  });

  it('rejects a triangle (3 points)', () => {
    expect(
      isAxisAlignedRect([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 5 },
      ]),
    ).toBe(false);
  });

  it('rejects a rotated (non-axis-aligned) quad', () => {
    expect(
      isAxisAlignedRect([
        { x: 0, y: 0 },
        { x: 10, y: 1 },
        { x: 9, y: 6 },
        { x: -1, y: 5 },
      ]),
    ).toBe(false);
  });
});

describe('buildShellFromExtrude', () => {
  it('builds a ShellFeature from a rect extrude', () => {
    const f = buildShellFromExtrude(rectExtrude(), 1, {
      openTopFace: true,
      openBottomFace: false,
    });
    expect(f.kind).toBe('shell');
    expect(f.childExtrude.depth).toBe(20);
    expect(f.thickness).toBe(1);
    expect(f.openTopFace).toBe(true);
    expect(f.openBottomFace).toBe(false);
  });

  it('defaults open-face flags to false when not provided', () => {
    const f = buildShellFromExtrude(rectExtrude(), 1);
    expect(f.openTopFace).toBe(false);
    expect(f.openBottomFace).toBe(false);
  });

  it('rejects non-positive thickness', () => {
    expect(() => buildShellFromExtrude(rectExtrude(), 0)).toThrow(/positive/);
    expect(() => buildShellFromExtrude(rectExtrude(), -1)).toThrow(/positive/);
    expect(() => buildShellFromExtrude(rectExtrude(), NaN)).toThrow(/positive/);
  });

  it('rejects thickness ≥ min(profileBBox)/2 (inversion guard)', () => {
    // 10×5 rect → min/2 = 2.5; thickness 2.5 or above should fail.
    expect(() => buildShellFromExtrude(rectExtrude(), 2.5)).toThrow(/bbox/);
    expect(() => buildShellFromExtrude(rectExtrude(), 3)).toThrow(/bbox/);
    // thickness 2.4 ok.
    expect(buildShellFromExtrude(rectExtrude(), 2.4).thickness).toBe(2.4);
  });

  it('rejects thickness ≥ depth/2 when openTop is true', () => {
    // Use a wider rect so the bbox/2 check (which fires first in
    // buildShellFromExtrude) doesn't gate before depth/2: 100×100 rect →
    // bbox min/2 = 50, depth=4 → depth/2 = 2; thickness 2 must fail at
    // the depth/2 gate.
    const wideExtrude: ExtrudeFeature = {
      kind: 'extrude',
      loop: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      depth: 4,
      direction: 'one_sided',
      mode: 'add',
    };
    expect(() => buildShellFromExtrude(wideExtrude, 2, { openTopFace: true })).toThrow(
      /depth\/2/,
    );
  });

  it('allows thickness ≥ depth/2 when neither face is open', () => {
    // Closed shell — no depth/2 check applies. Only bbox/2 matters.
    // depth=4, thickness=2: bbox min/2 = 2.5 → ok; depth/2 = 2 (would fail
    // open-face check) but no face open here.
    const f = buildShellFromExtrude(rectExtrude(4), 2);
    expect(f.thickness).toBe(2);
  });

  it('rejects non-rect child extrude (Phase 1 limitation)', () => {
    const triangle: ExtrudeFeature = {
      kind: 'extrude',
      loop: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 5 },
      ],
      depth: 20,
      direction: 'one_sided',
      mode: 'add',
    };
    expect(() => buildShellFromExtrude(triangle, 1)).toThrow(/axis-aligned rectangle/);
  });
});

describe('shellToScad', () => {
  it('emits difference() wrapping the outer extrude and inner extrude', () => {
    const f = buildShellFromExtrude(rectExtrude(), 1);
    const scad = shellToScad(f);
    expect(scad).toContain('difference()');
    // outer polygon (original rect corners)
    expect(scad).toMatch(/polygon\(\[\[0, 0\]/);
    // inner extrude header
    expect(scad).toContain('linear_extrude');
  });

  it('embeds a parametric comment with thickness + open-face flags', () => {
    const f = buildShellFromExtrude(rectExtrude(), 1.5, {
      openTopFace: true,
      openBottomFace: false,
    });
    const scad = shellToScad(f);
    expect(scad).toContain('NEXYFAB:SHELL thickness=1.5');
    expect(scad).toContain('openTop=true');
    expect(scad).toContain('openBottom=false');
  });

  it('inner polygon is inset by `thickness` on all 4 sides', () => {
    // 10×5 rect, thickness 1 → inner rect (1,1)→(9,1)→(9,4)→(1,4).
    const f = buildShellFromExtrude(rectExtrude(), 1);
    const scad = shellToScad(f);
    // The inner polygon must contain inset coordinates.
    expect(scad).toMatch(/\[1, 1\]/);
    expect(scad).toMatch(/\[9, 1\]/);
    expect(scad).toMatch(/\[9, 4\]/);
    expect(scad).toMatch(/\[1, 4\]/);
  });

  it('closed shell: inner extrude starts at +thickness, ends at depth-thickness', () => {
    // depth=20, t=1 → zStart=1, zEnd=19 → height=18.
    const f = buildShellFromExtrude(rectExtrude(20), 1);
    const scad = shellToScad(f);
    expect(scad).toMatch(/translate\(\[0, 0, 1\]\)/);
    expect(scad).toMatch(/linear_extrude\(height=18\)/);
  });

  it('openTop only: inner extrude pokes through the top (zEnd = depth + thickness)', () => {
    // depth=20, t=1, openTop → zStart=1, zEnd=21 → height=20.
    const f = buildShellFromExtrude(rectExtrude(20), 1, { openTopFace: true });
    const scad = shellToScad(f);
    expect(scad).toMatch(/translate\(\[0, 0, 1\]\)/);
    expect(scad).toMatch(/linear_extrude\(height=20\)/);
  });

  it('openBottom only: inner extrude pokes through z=0 (zStart = -thickness)', () => {
    // depth=20, t=1, openBottom → zStart=-1, zEnd=19 → height=20.
    const f = buildShellFromExtrude(rectExtrude(20), 1, { openBottomFace: true });
    const scad = shellToScad(f);
    expect(scad).toMatch(/translate\(\[0, 0, -1\]\)/);
    expect(scad).toMatch(/linear_extrude\(height=20\)/);
  });

  it('open both faces: inner extrude pokes through top AND bottom', () => {
    // depth=20, t=1, openTop+openBottom → zStart=-1, zEnd=21 → height=22.
    const f = buildShellFromExtrude(rectExtrude(20), 1, {
      openTopFace: true,
      openBottomFace: true,
    });
    const scad = shellToScad(f);
    expect(scad).toMatch(/translate\(\[0, 0, -1\]\)/);
    expect(scad).toMatch(/linear_extrude\(height=22\)/);
  });

  it('emits deterministic output for identical input', () => {
    const f1 = buildShellFromExtrude(rectExtrude(), 1, { openTopFace: true });
    const f2 = buildShellFromExtrude(rectExtrude(), 1, { openTopFace: true });
    expect(shellToScad(f1)).toBe(shellToScad(f2));
  });
});
