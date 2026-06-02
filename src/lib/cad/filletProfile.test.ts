/**
 * filletProfile — IR builder + SCAD serializer tests (Phase 2.2).
 */
import { describe, it, expect } from 'vitest';
import { buildFilletFeature, filletToScad } from './filletProfile';
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

describe('buildFilletFeature', () => {
  it('builds a FilletFeature from a rect extrude', () => {
    const f = buildFilletFeature(rectExtrude(), 1, 'all');
    expect(f.kind).toBe('fillet');
    expect(f.childExtrude.depth).toBe(20);
    expect(f.radius).toBe(1);
    expect(f.edgeSelection).toBe('all');
  });

  it('accepts each allowed edgeSelection value', () => {
    const sels: Array<'all' | 'top' | 'bottom' | 'vertical'> = [
      'all',
      'top',
      'bottom',
      'vertical',
    ];
    for (const s of sels) {
      const f = buildFilletFeature(rectExtrude(), 1, s);
      expect(f.edgeSelection).toBe(s);
    }
  });

  it('rejects non-positive radius', () => {
    expect(() => buildFilletFeature(rectExtrude(), 0, 'all')).toThrow(/positive/);
    expect(() => buildFilletFeature(rectExtrude(), -1, 'all')).toThrow(/positive/);
    expect(() => buildFilletFeature(rectExtrude(), NaN, 'all')).toThrow(/positive/);
  });

  it('rejects unknown edgeSelection', () => {
    // @ts-expect-error testing runtime guard against invalid value
    expect(() => buildFilletFeature(rectExtrude(), 1, 'middle')).toThrow(/edgeSelection/);
  });

  it('rejects radius ≥ min(profileBBox)/2 (inversion guard)', () => {
    // 10×5 rect → min/2 = 2.5; radius 2.5 or above must fail.
    expect(() => buildFilletFeature(rectExtrude(), 2.5, 'vertical')).toThrow(/bbox/);
    expect(() => buildFilletFeature(rectExtrude(), 3, 'vertical')).toThrow(/bbox/);
    // 2.4 ok.
    expect(buildFilletFeature(rectExtrude(), 2.4, 'vertical').radius).toBe(2.4);
  });

  it('rejects radius ≥ depth/2 when filleting top edges', () => {
    // 100×100 rect, depth=4 → depth/2 = 2; radius 2 must fail.
    const wide: ExtrudeFeature = {
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
    expect(() => buildFilletFeature(wide, 2, 'top')).toThrow(/depth\/2/);
    expect(() => buildFilletFeature(wide, 2, 'bottom')).toThrow(/depth\/2/);
    expect(() => buildFilletFeature(wide, 2, 'all')).toThrow(/depth\/2/);
  });

  it('allows radius ≥ depth/2 when only vertical edges are filleted', () => {
    // depth/2 gate doesn't apply when top/bottom not in selection.
    const wide: ExtrudeFeature = {
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
    const f = buildFilletFeature(wide, 2, 'vertical');
    expect(f.radius).toBe(2);
  });

  it('rejects non-rect child extrude (Phase 1 limitation)', () => {
    const tri: ExtrudeFeature = {
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
    expect(() => buildFilletFeature(tri, 1, 'all')).toThrow(/axis-aligned rectangle/);
  });
});

describe('filletToScad', () => {
  it('all-edges: emits minkowski with sphere seed and inset cube', () => {
    const f = buildFilletFeature(rectExtrude(), 1, 'all');
    const scad = filletToScad(f);
    expect(scad).toContain('minkowski()');
    expect(scad).toContain('sphere(r=1');
    // inset cube dimensions: 10-2=8, 5-2=3, 20-2=18
    expect(scad).toMatch(/cube\(\[8, 3, 18\]\)/);
  });

  it('vertical-edges: emits minkowski with $fn=32 cylinder seed', () => {
    const f = buildFilletFeature(rectExtrude(), 1, 'vertical');
    const scad = filletToScad(f);
    expect(scad).toContain('minkowski()');
    expect(scad).toMatch(/cylinder\(r=1.*\$fn=32\)/);
    // inset cube z stays at full depth (cylinder h≈0 doesn't extend Z)
    expect(scad).toMatch(/cube\(\[8, 3, 20\]\)/);
  });

  it('top-edges: emits union of bottom slab + minkowski crown', () => {
    const f = buildFilletFeature(rectExtrude(20), 1, 'top');
    const scad = filletToScad(f);
    expect(scad).toContain('union()');
    expect(scad).toContain('minkowski()');
    // bottom slab height = depth - r = 19
    expect(scad).toMatch(/cube\(\[10, 5, 19\]\)/);
    // crown translated to z = depth - r = 19
    expect(scad).toMatch(/translate\(\[1, 1, 19\]\)/);
  });

  it('bottom-edges: emits union of top slab + minkowski crown at z=r', () => {
    const f = buildFilletFeature(rectExtrude(20), 1, 'bottom');
    const scad = filletToScad(f);
    expect(scad).toContain('union()');
    // upper slab placed at z=r=1
    expect(scad).toMatch(/translate\(\[0, 0, 1\]\)[\s\S]*cube\(\[10, 5, 19\]\)/);
    // crown also placed at z=r=1
    expect(scad).toMatch(/translate\(\[1, 1, 1\]\)/);
  });

  it('embeds a parametric comment with radius + edges', () => {
    const f = buildFilletFeature(rectExtrude(), 1.5, 'top');
    const scad = filletToScad(f);
    expect(scad).toContain('NEXYFAB:FILLET radius=1.5 edges=top');
  });

  it('emits deterministic output for identical input', () => {
    const f1 = buildFilletFeature(rectExtrude(), 1, 'all');
    const f2 = buildFilletFeature(rectExtrude(), 1, 'all');
    expect(filletToScad(f1)).toBe(filletToScad(f2));
  });

  it('different edgeSelection produces different SCAD', () => {
    const a = filletToScad(buildFilletFeature(rectExtrude(), 1, 'all'));
    const v = filletToScad(buildFilletFeature(rectExtrude(), 1, 'vertical'));
    const t = filletToScad(buildFilletFeature(rectExtrude(), 1, 'top'));
    const b = filletToScad(buildFilletFeature(rectExtrude(), 1, 'bottom'));
    expect(new Set([a, v, t, b]).size).toBe(4);
  });
});
