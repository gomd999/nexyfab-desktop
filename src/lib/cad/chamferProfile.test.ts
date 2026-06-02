/**
 * chamferProfile — IR builder + SCAD serializer tests (Phase 2.2).
 */
import { describe, it, expect } from 'vitest';
import { buildChamferFeature, chamferToScad } from './chamferProfile';
import type { ExtrudeFeature } from './extrudeProfile';

function rectExtrude(depth = 20): ExtrudeFeature {
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

describe('buildChamferFeature', () => {
  it('builds a ChamferFeature from a rect extrude', () => {
    const f = buildChamferFeature(rectExtrude(), 1, 'all');
    expect(f.kind).toBe('chamfer');
    expect(f.childExtrude.depth).toBe(20);
    expect(f.distance).toBe(1);
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
      const f = buildChamferFeature(rectExtrude(), 1, s);
      expect(f.edgeSelection).toBe(s);
    }
  });

  it('rejects non-positive distance', () => {
    expect(() => buildChamferFeature(rectExtrude(), 0, 'all')).toThrow(/positive/);
    expect(() => buildChamferFeature(rectExtrude(), -1, 'all')).toThrow(/positive/);
    expect(() => buildChamferFeature(rectExtrude(), NaN, 'all')).toThrow(/positive/);
  });

  it('rejects unknown edgeSelection', () => {
    // @ts-expect-error testing runtime guard
    expect(() => buildChamferFeature(rectExtrude(), 1, 'wrong')).toThrow(/edgeSelection/);
  });

  it('rejects distance ≥ min(profileBBox)/2', () => {
    expect(() => buildChamferFeature(rectExtrude(), 2.5, 'vertical')).toThrow(/bbox/);
    expect(() => buildChamferFeature(rectExtrude(), 3, 'vertical')).toThrow(/bbox/);
    expect(buildChamferFeature(rectExtrude(), 2.4, 'vertical').distance).toBe(2.4);
  });

  it('rejects distance ≥ depth/2 when chamfering top edges', () => {
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
    expect(() => buildChamferFeature(wide, 2, 'top')).toThrow(/depth\/2/);
    expect(() => buildChamferFeature(wide, 2, 'bottom')).toThrow(/depth\/2/);
    expect(() => buildChamferFeature(wide, 2, 'all')).toThrow(/depth\/2/);
  });

  it('allows distance ≥ depth/2 when only vertical edges are chamfered', () => {
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
    const f = buildChamferFeature(wide, 2, 'vertical');
    expect(f.distance).toBe(2);
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
    const f = buildChamferFeature(tri, 0.3, 'vertical');
    expect(f.kind).toBe('chamfer');
    expect(f.distance).toBe(0.3);
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

describe('buildChamferFeature (Phase 2 N-vertex)', () => {
  it('triangle + small distance + vertical edges builds successfully', () => {
    const tri = polygonExtrude([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 8 },
    ]);
    const f = buildChamferFeature(tri, 1, 'vertical');
    expect(f.kind).toBe('chamfer');
    expect(f.distance).toBe(1);
  });

  it('regular pentagon + hexagon build successfully', () => {
    const pent = polygonExtrude(regularPolygonLoop(5, 10));
    const hex = polygonExtrude(regularPolygonLoop(6, 10));
    expect(buildChamferFeature(pent, 1, 'vertical').kind).toBe('chamfer');
    expect(buildChamferFeature(hex, 2, 'vertical').kind).toBe('chamfer');
  });

  it('rejects concave polygon with "convex profile" message', () => {
    const concave = polygonExtrude([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 3 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    expect(() => buildChamferFeature(concave, 1, 'vertical')).toThrow(/convex/i);
  });

  it('rejects distance ≥ min(edge_distances)/2 with "too large" message', () => {
    const tri = polygonExtrude([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 5 },
    ]);
    expect(() => buildChamferFeature(tri, 5, 'vertical')).toThrow(/too large/);
  });

  it('rejects distance ≥ depth/2 for "all" on a triangle', () => {
    const tri = polygonExtrude([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 10, y: 18 },
    ], 4);
    expect(() => buildChamferFeature(tri, 2, 'all')).toThrow(/depth\/2/);
  });
});

describe('chamferToScad (Phase 2 N-vertex)', () => {
  it('hexagon chamfer d=2: emits minkowski + linear_extrude + polygon + octahedron polyhedron', () => {
    const hex = polygonExtrude(regularPolygonLoop(6, 10));
    const scad = chamferToScad(buildChamferFeature(hex, 2, 'all'));
    expect(scad).toContain('minkowski()');
    expect(scad).toContain('linear_extrude');
    expect(scad).toContain('polygon(');
    expect(scad).toContain('polyhedron(');
    expect(scad).toMatch(/\[2,0,0\]/);
    expect(scad).toMatch(/\[-2,0,0\]/);
    expect(scad).not.toContain('cube(');
  });

  it('triangle chamfer d=0.3 vertical: emits rotated $fn=4 cylinder seed + polygon body', () => {
    const tri = polygonExtrude([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 5 },
    ]);
    const scad = chamferToScad(buildChamferFeature(tri, 0.3, 'vertical'));
    expect(scad).toContain('minkowski()');
    expect(scad).toContain('rotate([0, 0, 45])');
    expect(scad).toMatch(/cylinder\(.*\$fn=4\)/);
    expect(scad).toContain('polygon(');
    expect(scad).not.toContain('cube(');
  });

  it('pentagon chamfer top: emits union + slab + crown polyhedron', () => {
    const pent = polygonExtrude(regularPolygonLoop(5, 10));
    const scad = chamferToScad(buildChamferFeature(pent, 1, 'top'));
    expect(scad).toContain('union()');
    expect(scad).toContain('linear_extrude');
    expect(scad).toContain('minkowski()');
    expect(scad).toContain('polyhedron(');
  });

  it('axis-aligned rect still uses Phase 1 cube-based emission (no regression)', () => {
    const rect = polygonExtrude([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ]);
    const scad = chamferToScad(buildChamferFeature(rect, 1, 'all'));
    expect(scad).toContain('cube(');
    expect(scad).not.toContain('linear_extrude');
  });

  it('deterministic output for identical N-vertex inputs', () => {
    const hex = polygonExtrude(regularPolygonLoop(6, 10));
    const a = chamferToScad(buildChamferFeature(hex, 1, 'all'));
    const b = chamferToScad(buildChamferFeature(hex, 1, 'all'));
    expect(a).toBe(b);
  });
});

describe('chamferToScad', () => {
  it('all-edges: emits minkowski with polyhedron (octahedron) seed', () => {
    const f = buildChamferFeature(rectExtrude(), 1, 'all');
    const scad = chamferToScad(f);
    expect(scad).toContain('minkowski()');
    expect(scad).toContain('polyhedron(');
    // octahedron has 6 vertices on ±d axes → contains [1,0,0] and [-1,0,0]
    expect(scad).toMatch(/\[1,0,0\]/);
    expect(scad).toMatch(/\[-1,0,0\]/);
    // inset cube 8×3×18
    expect(scad).toMatch(/cube\(\[8, 3, 18\]\)/);
  });

  it('vertical-edges: emits minkowski with rotated $fn=4 cylinder', () => {
    const f = buildChamferFeature(rectExtrude(), 1, 'vertical');
    const scad = chamferToScad(f);
    expect(scad).toContain('minkowski()');
    expect(scad).toContain('rotate([0, 0, 45])');
    expect(scad).toMatch(/cylinder\(.*\$fn=4\)/);
    expect(scad).toMatch(/cube\(\[8, 3, 20\]\)/);
  });

  it('top-edges: emits union of bottom slab + minkowski crown', () => {
    const f = buildChamferFeature(rectExtrude(20), 1, 'top');
    const scad = chamferToScad(f);
    expect(scad).toContain('union()');
    expect(scad).toContain('minkowski()');
    expect(scad).toMatch(/cube\(\[10, 5, 19\]\)/);
    expect(scad).toMatch(/translate\(\[1, 1, 19\]\)/);
    expect(scad).toContain('polyhedron(');
  });

  it('bottom-edges: emits union of upper slab + crown at z=d', () => {
    const f = buildChamferFeature(rectExtrude(20), 1, 'bottom');
    const scad = chamferToScad(f);
    expect(scad).toContain('union()');
    expect(scad).toMatch(/translate\(\[0, 0, 1\]\)[\s\S]*cube\(\[10, 5, 19\]\)/);
    expect(scad).toMatch(/translate\(\[1, 1, 1\]\)/);
  });

  it('embeds a parametric comment with distance + edges', () => {
    const f = buildChamferFeature(rectExtrude(), 1.5, 'top');
    const scad = chamferToScad(f);
    expect(scad).toContain('NEXYFAB:CHAMFER distance=1.5 edges=top');
  });

  it('emits deterministic output for identical input', () => {
    const f1 = buildChamferFeature(rectExtrude(), 1, 'all');
    const f2 = buildChamferFeature(rectExtrude(), 1, 'all');
    expect(chamferToScad(f1)).toBe(chamferToScad(f2));
  });

  it('different edgeSelection produces different SCAD', () => {
    const a = chamferToScad(buildChamferFeature(rectExtrude(), 1, 'all'));
    const v = chamferToScad(buildChamferFeature(rectExtrude(), 1, 'vertical'));
    const t = chamferToScad(buildChamferFeature(rectExtrude(), 1, 'top'));
    const b = chamferToScad(buildChamferFeature(rectExtrude(), 1, 'bottom'));
    expect(new Set([a, v, t, b]).size).toBe(4);
  });
});
