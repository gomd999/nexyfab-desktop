/**
 * chamferProfile — IR builder + SCAD serializer tests (Phase 2.2).
 */
import { describe, it, expect } from 'vitest';
import {
  buildChamferFeature,
  chamferToScad,
  edgeDistancesToVertexDistances,
} from './chamferProfile';
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

// ─── Phase 3: variable distance per vertex / per edge ─────────────────────

describe('edgeDistancesToVertexDistances (Phase 3)', () => {
  it('uniform → uniform', () => {
    expect(edgeDistancesToVertexDistances([1, 1, 1, 1])).toEqual([1, 1, 1, 1]);
  });
  it('picks max of two adjacent edges per corner', () => {
    expect(edgeDistancesToVertexDistances([1, 3, 2, 4])).toEqual([4, 3, 3, 4]);
  });
});

describe('buildChamferFeature (Phase 3 variable distance)', () => {
  it('accepts vertexDistances of correct length on rect', () => {
    const f = buildChamferFeature(rectExtrude(), {
      distance: 1,
      edgeSelection: 'vertical',
      vertexDistances: [0.5, 1, 1.5, 1],
    });
    expect(f.kind).toBe('chamfer');
    expect(f.vertexDistances).toEqual([0.5, 1, 1.5, 1]);
  });

  it('accepts edgeDistances → uniform vertexDistances when all equal', () => {
    const f = buildChamferFeature(rectExtrude(), {
      distance: 2,
      edgeSelection: 'vertical',
      edgeDistances: [2, 2, 2, 2],
    });
    expect(f.vertexDistances).toEqual([2, 2, 2, 2]);
  });

  it('vertexDistances precedence over edgeDistances when both supplied', () => {
    const f = buildChamferFeature(rectExtrude(), {
      distance: 1,
      edgeSelection: 'vertical',
      vertexDistances: [0.5, 0.5, 0.5, 0.5],
      edgeDistances: [9, 9, 9, 9],
    });
    expect(f.vertexDistances).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('rejects vertexDistances with wrong length', () => {
    expect(() =>
      buildChamferFeature(rectExtrude(), {
        distance: 1,
        edgeSelection: 'vertical',
        vertexDistances: [1, 1, 1],
      }),
    ).toThrow(/vertexDistances length/);
  });

  it('rejects vertexDistances with negative or zero entry', () => {
    expect(() =>
      buildChamferFeature(rectExtrude(), {
        distance: 1,
        edgeSelection: 'vertical',
        vertexDistances: [1, -1, 1, 1],
      }),
    ).toThrow(/vertexDistances\[1\].*positive/);
    expect(() =>
      buildChamferFeature(rectExtrude(), {
        distance: 1,
        edgeSelection: 'vertical',
        vertexDistances: [1, 0, 1, 1],
      }),
    ).toThrow(/vertexDistances\[1\].*positive/);
  });

  it('rejects vertexDistances entry ≥ min(bbox)/2', () => {
    expect(() =>
      buildChamferFeature(rectExtrude(), {
        distance: 1,
        edgeSelection: 'vertical',
        vertexDistances: [1, 1, 1, 3],
      }),
    ).toThrow(/vertexDistances\[3\].*bbox/);
  });

  it('rejects vertexDistances entry ≥ depth/2 when chamfering top/bottom', () => {
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
    expect(() =>
      buildChamferFeature(wide, {
        distance: 1,
        edgeSelection: 'all',
        vertexDistances: [1, 1, 3, 1],
      }),
    ).toThrow(/vertexDistances\[2\].*depth\/2/);
  });

  it('throws Phase 4 wishlist error for convex N-gon + vertexDistances', () => {
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
    expect(() =>
      buildChamferFeature(tri, {
        distance: 0.3,
        edgeSelection: 'vertical',
        vertexDistances: [0.3, 0.3, 0.3],
      }),
    ).toThrow(/Phase 3 rect-only|Phase 4/);
  });
});

describe('chamferToScad (Phase 3 variable distance)', () => {
  it('vertexDistances vertical: emits hull of 4 rotated $fn=4 circles with varying half-diag', () => {
    const f = buildChamferFeature(rectExtrude(), {
      distance: 1,
      edgeSelection: 'vertical',
      vertexDistances: [0.5, 1, 1.5, 1],
    });
    const scad = chamferToScad(f);
    expect(scad).toContain('linear_extrude');
    expect(scad).toContain('hull()');
    expect(scad).toMatch(/rotate\(\[0, 0, 45\]\) circle\(r=/);
    expect(scad).toContain('NEXYFAB:CHAMFER vertexDistances=[0.5,1,1.5,1]');
    expect(scad).not.toContain('minkowski()');
  });

  it('vertexDistances all: emits hull of 8 octahedra (4 corners × top/bottom)', () => {
    const f = buildChamferFeature(rectExtrude(20), {
      distance: 1,
      edgeSelection: 'all',
      vertexDistances: [1, 2, 1, 2],
    });
    const scad = chamferToScad(f);
    expect(scad).toContain('hull()');
    const polyCount = (scad.match(/polyhedron\(/g) ?? []).length;
    expect(polyCount).toBe(8);
  });

  it('edgeDistances [2,2,2,2] produces same number of seed primitives as uniform', () => {
    const f = buildChamferFeature(rectExtrude(), {
      distance: 2,
      edgeSelection: 'vertical',
      edgeDistances: [2, 2, 2, 2],
    });
    const scad = chamferToScad(f);
    // 4 rotated $fn=4 circles in the hull.
    const r2Count = (scad.match(/circle\(r=/g) ?? []).length;
    expect(r2Count).toBe(4);
  });

  it('vertexDistances top: emits union of slab + hull of 4 octahedra', () => {
    const f = buildChamferFeature(rectExtrude(20), {
      distance: 1,
      edgeSelection: 'top',
      vertexDistances: [1, 2, 1, 2],
    });
    const scad = chamferToScad(f);
    expect(scad).toContain('union()');
    expect(scad).toContain('hull()');
    const polyCount = (scad.match(/polyhedron\(/g) ?? []).length;
    expect(polyCount).toBe(4);
    // Slab height = depth - maxD = 18
    expect(scad).toMatch(/cube\(\[10, 5, 18\]\)/);
  });

  it('vertexDistances bottom: slab translated up by maxD', () => {
    const f = buildChamferFeature(rectExtrude(20), {
      distance: 1,
      edgeSelection: 'bottom',
      vertexDistances: [1, 2, 1, 2],
    });
    const scad = chamferToScad(f);
    expect(scad).toMatch(/translate\(\[0, 0, 2\]\)[\s\S]*cube\(\[10, 5, 18\]\)/);
  });

  it('deterministic for identical vertexDistances inputs', () => {
    const opts = {
      distance: 1,
      edgeSelection: 'vertical' as const,
      vertexDistances: [0.5, 1, 1.5, 1],
    };
    const a = chamferToScad(buildChamferFeature(rectExtrude(), opts));
    const b = chamferToScad(buildChamferFeature(rectExtrude(), opts));
    expect(a).toBe(b);
  });

  it('uniform path NOT affected when no vertexDistances given (no regression)', () => {
    const f = buildChamferFeature(rectExtrude(), 1, 'all');
    const scad = chamferToScad(f);
    expect(scad).toContain('minkowski()');
    expect(scad).not.toContain('hull()');
  });
});
