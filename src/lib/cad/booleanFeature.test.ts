/**
 * Tests for booleanFeature — Phase 2.1.3 NexyFab Pro own-CAD (ADR-013).
 */

import { describe, it, expect } from 'vitest';
import {
  booleanToScad,
  validateBooleanFeature,
  type BooleanFeature,
} from './booleanFeature';

function feat(op: BooleanFeature['op'], bodies: string[]): BooleanFeature {
  return { kind: 'boolean', op, bodies };
}

describe('booleanToScad', () => {
  it('wraps two children in union()', () => {
    const scad = booleanToScad(feat('union', ['a', 'b']), [
      'cube([1,1,1]);',
      'sphere(1);',
    ]);
    expect(scad).toBe('union() {\n  cube([1,1,1]);\n  sphere(1);\n}');
  });

  it('wraps three children in intersection()', () => {
    const scad = booleanToScad(feat('intersection', ['a', 'b', 'c']), [
      'cube(2);',
      'sphere(2);',
      'cylinder(h=3);',
    ]);
    expect(scad).toBe(
      'intersection() {\n  cube(2);\n  sphere(2);\n  cylinder(h=3);\n}',
    );
  });

  it('preserves order for difference (base first, then subtracted)', () => {
    const scad = booleanToScad(feat('difference', ['base', 'hole1', 'hole2']), [
      'cube(10);',
      'translate([1,1,0]) cylinder(h=10);',
      'translate([8,8,0]) cylinder(h=10);',
    ]);
    expect(scad).toBe(
      'difference() {\n' +
        '  cube(10);\n' +
        '  translate([1,1,0]) cylinder(h=10);\n' +
        '  translate([8,8,0]) cylinder(h=10);\n' +
        '}',
    );
    // base body must appear before the subtracted ones.
    expect(scad.indexOf('cube(10)')).toBeLessThan(scad.indexOf('cylinder(h=10)'));
  });

  it('indents every line of a multi-line child by 2 spaces', () => {
    const scad = booleanToScad(feat('union', ['a', 'b']), [
      'cube(1);',
      'linear_extrude(5)\npolygon([[0,0],[1,0],[1,1]]);',
    ]);
    expect(scad).toBe(
      'union() {\n' +
        '  cube(1);\n' +
        '  linear_extrude(5)\n' +
        '  polygon([[0,0],[1,0],[1,1]]);\n' +
        '}',
    );
  });

  it('is deterministic for identical input', () => {
    const f = feat('difference', ['x', 'y']);
    const a = booleanToScad(f, ['cube(1);', 'sphere(1);']);
    const b = booleanToScad(f, ['cube(1);', 'sphere(1);']);
    expect(a).toBe(b);
  });

  it('throws on child/body count mismatch', () => {
    expect(() =>
      booleanToScad(feat('union', ['a', 'b']), ['cube(1);']),
    ).toThrow(/count/);
    expect(() =>
      booleanToScad(feat('union', ['a', 'b']), ['cube(1);', 'sphere(1);', 'x();']),
    ).toThrow(/count/);
  });

  it('throws when the feature itself is invalid', () => {
    expect(() =>
      booleanToScad(feat('union', ['a']), ['cube(1);']),
    ).toThrow(/invalid feature/);
  });
});

describe('validateBooleanFeature', () => {
  it('accepts a well-formed difference with >= 2 unique bodies', () => {
    const r = validateBooleanFeature(feat('difference', ['base', 'tool']));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects fewer than 2 bodies', () => {
    const r = validateBooleanFeature(feat('union', ['only']));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => />= 2 bodies/.test(e))).toBe(true);
  });

  it('rejects an unknown op', () => {
    const bad = { kind: 'boolean', op: 'xor', bodies: ['a', 'b'] } as unknown as BooleanFeature;
    const r = validateBooleanFeature(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /unknown op/.test(e))).toBe(true);
  });

  it('rejects duplicate body ids', () => {
    const r = validateBooleanFeature(feat('union', ['a', 'a']));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /duplicate body id/.test(e))).toBe(true);
  });

  it('rejects empty / non-string ids', () => {
    const r = validateBooleanFeature(feat('intersection', ['a', '']));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /non-empty id/.test(e))).toBe(true);
  });
});
