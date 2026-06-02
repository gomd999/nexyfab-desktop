/**
 * filletProfile — IR builder + SCAD serializer tests (Phase 2.2).
 */
import { describe, it, expect } from 'vitest';
import {
  buildFilletFeature,
  filletToScad,
  isConvexPolygon,
  offsetPolygonInward,
} from './filletProfile';
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

  it('Phase 2: accepts triangle (3-vertex convex polygon) child extrude', () => {
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
    const f = buildFilletFeature(tri, 0.3, 'vertical');
    expect(f.kind).toBe('fillet');
    expect(f.radius).toBe(0.3);
  });
});

// ─── Phase 2: convex N-vertex polygon support ─────────────────────────────

function regularPolygonLoop(n: number, radius: number, cx = 0, cy = 0) {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return pts;
}

function polygonExtrude(loop: Array<{ x: number; y: number }>, depth = 20): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop,
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
}

describe('isConvexPolygon', () => {
  it('triangle is convex', () => {
    expect(isConvexPolygon([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 5 },
    ])).toBe(true);
  });

  it('axis-aligned rect is convex', () => {
    expect(isConvexPolygon([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ])).toBe(true);
  });

  it('regular hexagon is convex', () => {
    expect(isConvexPolygon(regularPolygonLoop(6, 10))).toBe(true);
  });

  it('concave Pac-Man / arrow profile is not convex', () => {
    expect(isConvexPolygon([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 3 }, // dent
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ])).toBe(false);
  });

  it('collinear-vertex polygon is rejected (degenerate)', () => {
    expect(isConvexPolygon([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ])).toBe(false);
  });

  it('fewer than 3 vertices is not convex', () => {
    expect(isConvexPolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });
});

describe('offsetPolygonInward', () => {
  it('offsets a unit square inward to a smaller centered square', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const offset = offsetPolygonInward(square, 2);
    // Expected: [(2,2),(8,2),(8,8),(2,8)]
    expect(offset).toHaveLength(4);
    expect(offset[0]!.x).toBeCloseTo(2);
    expect(offset[0]!.y).toBeCloseTo(2);
    expect(offset[1]!.x).toBeCloseTo(8);
    expect(offset[1]!.y).toBeCloseTo(2);
    expect(offset[2]!.x).toBeCloseTo(8);
    expect(offset[2]!.y).toBeCloseTo(8);
    expect(offset[3]!.x).toBeCloseTo(2);
    expect(offset[3]!.y).toBeCloseTo(8);
  });

  it('offset triangle vertices lie on the angle bisector at the correct distance', () => {
    // Right isoceles triangle: (0,0), (10,0), (0,10). For each vertex the
    // offset must be perpendicular distance r from both adjacent edges.
    const tri = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    const r = 1;
    const off = offsetPolygonInward(tri, r);
    expect(off).toHaveLength(3);
    // vertex 0 (origin, 90° corner): bisector is (+x+y)/√2; offset = r along
    // that bisector projected to (r, r).
    expect(off[0]!.x).toBeCloseTo(1, 6);
    expect(off[0]!.y).toBeCloseTo(1, 6);
    // vertex 1 (10,0, 45° corner): inward direction has |Δx|/r=1, |Δy|/r ≈ tan(22.5°) inverse...
    // simplest invariant — perpendicular distance from off[1] to the bottom
    // edge (y=0) and the hypotenuse must both equal r.
    const distBottom = off[1]!.y; // y=0 edge → perp = y
    expect(distBottom).toBeCloseTo(r, 6);
    // hypotenuse line: x + y = 10 → normal (1,1)/√2 inward points (-1,-1).
    // perp distance from off[1] = (10 - off[1].x - off[1].y) / √2
    const distHyp = (10 - off[1]!.x - off[1]!.y) / Math.SQRT2;
    expect(distHyp).toBeCloseTo(r, 6);
  });

  it('produces a polygon with positive signed area for a CCW input', () => {
    const hex = regularPolygonLoop(6, 10);
    const off = offsetPolygonInward(hex, 1);
    // Re-compute signed area inline.
    let s = 0;
    for (let i = 0; i < off.length; i++) {
      const a = off[i]!;
      const b = off[(i + 1) % off.length]!;
      s += a.x * b.y - b.x * a.y;
    }
    expect(s / 2).toBeGreaterThan(0);
  });

  it('throws for concave polygon (convex precondition)', () => {
    const concave = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 3 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(() => offsetPolygonInward(concave, 0.5)).toThrow(/convex/i);
  });

  it('throws when r is too large for the polygon (self-intersecting offset)', () => {
    // Skinny triangle: r too big collapses the offset polygon.
    const tri = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 1 },
    ];
    expect(() => offsetPolygonInward(tri, 1)).toThrow(/too large/);
  });

  it('throws for non-positive r', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(() => offsetPolygonInward(square, 0)).toThrow(/positive/);
    expect(() => offsetPolygonInward(square, -1)).toThrow(/positive/);
  });
});

describe('buildFilletFeature (Phase 2 N-vertex)', () => {
  it('triangle + small radius + vertical edges builds successfully', () => {
    const tri = polygonExtrude([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 8 },
    ]);
    const f = buildFilletFeature(tri, 1, 'vertical');
    expect(f.kind).toBe('fillet');
    expect(f.radius).toBe(1);
  });

  it('regular pentagon (5-vertex) builds successfully', () => {
    const pent = polygonExtrude(regularPolygonLoop(5, 10));
    const f = buildFilletFeature(pent, 1, 'vertical');
    expect(f.kind).toBe('fillet');
  });

  it('regular hexagon (6-vertex) builds successfully', () => {
    const hex = polygonExtrude(regularPolygonLoop(6, 10));
    const f = buildFilletFeature(hex, 2, 'vertical');
    expect(f.kind).toBe('fillet');
  });

  it('rejects concave polygon with "convex profile" message', () => {
    const concave = polygonExtrude([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 3 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    expect(() => buildFilletFeature(concave, 1, 'vertical')).toThrow(/convex/i);
  });

  it('rejects radius ≥ min(edge_distances)/2 with "too large" message', () => {
    // Triangle with very small inscribed radius — radius 5 will be too large.
    const tri = polygonExtrude([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 5 },
    ]);
    expect(() => buildFilletFeature(tri, 5, 'vertical')).toThrow(/too large/);
  });

  it('rejects radius that produces self-intersecting offset (acute apex)', () => {
    // Sharp isoceles triangle: skinny apex makes offset blow up early.
    const sharp = polygonExtrude([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 10, y: 1.5 },
    ]);
    expect(() => buildFilletFeature(sharp, 1.5, 'vertical')).toThrow(/too large/);
  });

  it('rejects radius ≥ depth/2 for "all" on a triangle', () => {
    const tri = polygonExtrude([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 10, y: 18 },
    ], 4);
    expect(() => buildFilletFeature(tri, 2, 'all')).toThrow(/depth\/2/);
  });
});

describe('filletToScad (Phase 2 N-vertex)', () => {
  it('triangle fillet r=0.3 vertical: emits minkowski + linear_extrude + polygon + cylinder seed', () => {
    const tri = polygonExtrude([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 5 },
    ]);
    const scad = filletToScad(buildFilletFeature(tri, 0.3, 'vertical'));
    expect(scad).toContain('minkowski()');
    expect(scad).toContain('linear_extrude');
    expect(scad).toContain('polygon(');
    expect(scad).toMatch(/cylinder\(r=0\.3.*\$fn=32\)/);
    // Phase 2 path must NOT emit cube(.
    expect(scad).not.toContain('cube(');
  });

  it('pentagon fillet r=1 all: emits minkowski + sphere(r=1)', () => {
    const pent = polygonExtrude(regularPolygonLoop(5, 10));
    const scad = filletToScad(buildFilletFeature(pent, 1, 'all'));
    expect(scad).toContain('minkowski()');
    expect(scad).toContain('sphere(r=1');
    expect(scad).toContain('polygon(');
    expect(scad).not.toContain('cube(');
  });

  it('hexagon fillet r=2 top: emits union + slab linear_extrude + crown minkowski', () => {
    const hex = polygonExtrude(regularPolygonLoop(6, 10));
    const scad = filletToScad(buildFilletFeature(hex, 2, 'top'));
    expect(scad).toContain('union()');
    expect(scad).toContain('minkowski()');
    expect(scad).toContain('linear_extrude');
    expect(scad).toContain('polygon(');
    expect(scad).toContain('sphere(r=2');
  });

  it('triangle fillet bottom: crown placed at z=r', () => {
    const tri = polygonExtrude([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 8 },
    ]);
    const scad = filletToScad(buildFilletFeature(tri, 1, 'bottom'));
    expect(scad).toContain('union()');
    // both slab and crown translated to z=1
    expect(scad).toMatch(/translate\(\[0, 0, 1\]\)/);
  });

  it('axis-aligned rect still uses Phase 1 cube-based emission (no regression)', () => {
    const rect = polygonExtrude([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ]);
    const scad = filletToScad(buildFilletFeature(rect, 1, 'all'));
    expect(scad).toContain('cube(');
    expect(scad).not.toContain('linear_extrude');
  });

  it('deterministic output for identical N-vertex inputs', () => {
    const hex = polygonExtrude(regularPolygonLoop(6, 10));
    const a = filletToScad(buildFilletFeature(hex, 1, 'all'));
    const b = filletToScad(buildFilletFeature(hex, 1, 'all'));
    expect(a).toBe(b);
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
