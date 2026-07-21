/**
 * featureMesh — extrude → polyhedron tests (Phase 4.1.2).
 */
import { describe, it, expect } from 'vitest';
import {
  extrudePolyhedron,
  revolvePolyhedron,
  sweepPolyhedron,
  loftPolyhedron,
  featureToPolyhedron,
  polyhedronEdges,
} from './featureMesh';
import type { ExtrudeFeature } from './extrudeProfile';
import type { RevolveFeature } from './revolveProfile';
import type { SweepFeature, LoftFeature } from './sweepLoft';
import { dot, sub } from '@/lib/sketch/sketchPlane';

const UNIT_SQUARE: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

function extrude(dir: ExtrudeFeature['direction'] = 'one_sided', depth = 4): ExtrudeFeature {
  return { kind: 'extrude', loop: UNIT_SQUARE, depth, direction: dir, mode: 'add' };
}

describe('extrudePolyhedron', () => {
  it('a square prism has 8 vertices, 6 faces, 12 manifold edges', () => {
    const poly = extrudePolyhedron(extrude());
    expect(poly.vertices).toHaveLength(8);
    expect(poly.faces).toHaveLength(6);
    const edges = polyhedronEdges(poly);
    expect(edges).toHaveLength(12);
    // Every edge is shared by exactly 2 faces (closed manifold).
    expect(edges.every((e) => e.faces.length === 2)).toBe(true);
  });

  it('one_sided extrudes 0..depth', () => {
    const poly = extrudePolyhedron(extrude('one_sided', 4));
    const zs = poly.vertices.map((v) => v.z).sort((a, b) => a - b);
    expect(zs[0]).toBe(0);
    expect(zs[zs.length - 1]).toBe(4);
  });

  it('midplane extrudes -depth/2..depth/2; two_sided -depth..depth', () => {
    const mid = extrudePolyhedron(extrude('midplane', 4));
    const mz = mid.vertices.map((v) => v.z);
    expect(Math.min(...mz)).toBe(-2);
    expect(Math.max(...mz)).toBe(2);
    const two = extrudePolyhedron(extrude('two_sided', 4));
    const tz = two.vertices.map((v) => v.z);
    expect(Math.min(...tz)).toBe(-4);
    expect(Math.max(...tz)).toBe(4);
  });

  it('all face normals point outward (away from the centroid)', () => {
    const poly = extrudePolyhedron(extrude());
    const c = poly.vertices.reduce(
      (acc, v) => ({ x: acc.x + v.x / 8, y: acc.y + v.y / 8, z: acc.z + v.z / 8 }),
      { x: 0, y: 0, z: 0 },
    );
    for (const f of poly.faces) {
      const p0 = poly.vertices[f.vertices[0]];
      // centroid is on the inner side → dot(normal, centroid - p0) must be < 0.
      expect(dot(f.normal, sub(c, p0))).toBeLessThan(0);
    }
  });

  it('has exactly one +Z (top) and one −Z (bottom) cap normal', () => {
    const poly = extrudePolyhedron(extrude());
    const top = poly.faces.filter((f) => f.normal.z > 0.99);
    const bottom = poly.faces.filter((f) => f.normal.z < -0.99);
    expect(top).toHaveLength(1);
    expect(bottom).toHaveLength(1);
  });

  it('rejects a degenerate loop', () => {
    expect(() =>
      extrudePolyhedron({ kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }], depth: 1, direction: 'one_sided', mode: 'add' }),
    ).toThrow(/≥ 3/);
  });
});

// A rectangular profile offset from the axis → revolves into a hollow-ish
// ring / tube cross-section (a closed loop in the X≥0 half-plane).
function revolveFeat(angle = 360): RevolveFeature {
  return {
    kind: 'revolve',
    loop: [{ x: 4, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 3 }, { x: 4, y: 3 }],
    angleDegrees: angle,
    mode: 'add',
  };
}

describe('revolvePolyhedron', () => {
  it('full 360° wraps into a closed manifold (every edge shared by 2 faces)', () => {
    const poly = revolvePolyhedron(revolveFeat(360), 16);
    // 16 rings × 4 profile pts; 16 segments × 4 side quads, no caps.
    expect(poly.vertices).toHaveLength(16 * 4);
    expect(poly.faces).toHaveLength(16 * 4);
    const edges = polyhedronEdges(poly);
    expect(edges.every((e) => e.faces.length === 2)).toBe(true);
  });

  it('partial sweep adds two end caps and is open at the seam', () => {
    const poly = revolvePolyhedron(revolveFeat(90), 8);
    // 9 rings × 4 pts; 8×4 side quads + 2 caps.
    expect(poly.vertices).toHaveLength(9 * 4);
    expect(poly.faces).toHaveLength(8 * 4 + 2);
  });

  it('normals are a consistent outward shell — inner walls face the axis, outer walls face away', () => {
    // A tube is NON-CONVEX: the mesh centroid sits on the (hollow) axis, so
    // "outward = away from centroid" is FALSE for the inner wall. The correct
    // invariant is a globally-consistent shell whose raw signed volume is the
    // POSITIVE faceted tube volume (hole subtracted, not doubled).
    const poly = revolvePolyhedron(revolveFeat(360), 12);
    // Radial normal test on axis-aligned side walls (skip caps: none for 360°).
    for (const f of poly.faces) {
      const p0 = poly.vertices[f.vertices[0]];
      const radial = { x: p0.x, y: 0, z: p0.z }; // outward radial dir (axis = Y)
      const rl = Math.hypot(radial.x, radial.z);
      if (rl < 1e-9) continue;
      const rn = { x: radial.x / rl, y: 0, z: radial.z / rl };
      const align = dot(f.normal, rn);
      // Inner wall (radius ≈ 4) faces the axis (align < 0); outer wall
      // (radius ≈ 6) faces away (align > 0). Either way |align| ≈ 1.
      if (Math.abs(align) > 0.5) {
        const inner = rl < 5;
        expect(align).toBeGreaterThan(inner ? -1.0001 : 0.5);
        expect(align).toBeLessThan(inner ? -0.5 : 1.0001);
      }
    }
  });

  it('rejects too few segments', () => {
    expect(() => revolvePolyhedron(revolveFeat(360), 2)).toThrow(/≥ 3/);
  });
});

function sweepFeat(path: Array<{ x: number; y: number; z: number }>): SweepFeature {
  return {
    kind: 'sweep',
    profile: { points: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }] },
    path,
    mode: 'add',
  };
}

describe('sweepPolyhedron', () => {
  it('a square swept along a straight path is a closed prism', () => {
    const poly = sweepPolyhedron(sweepFeat([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }]));
    expect(poly.vertices).toHaveLength(4 * 2);
    expect(poly.faces).toHaveLength(4 + 2); // 4 sides + 2 caps
    expect(polyhedronEdges(poly).every((e) => e.faces.length === 2)).toBe(true);
  });

  it('an L-shaped path stays a closed manifold (parallel-transport frames)', () => {
    const poly = sweepPolyhedron(
      sweepFeat([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }, { x: 8, y: 0, z: 10 }]),
    );
    expect(poly.vertices).toHaveLength(4 * 3);
    expect(polyhedronEdges(poly).every((e) => e.faces.length === 2)).toBe(true);
  });

  it('rejects a too-short profile or path', () => {
    expect(() => sweepPolyhedron(sweepFeat([{ x: 0, y: 0, z: 0 }]))).toThrow(/≥ 2/);
  });
});

function sq(half: number): Array<{ x: number; y: number }> {
  return [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }];
}
function loftFeat(): LoftFeature {
  return {
    kind: 'loft',
    sections: [
      { profile: { points: sq(5) }, z: 0 },
      { profile: { points: sq(3) }, z: 10 }, // tapers inward
    ],
    mode: 'add',
  };
}

describe('loftPolyhedron', () => {
  it('two stacked square sections form a closed tapered prism', () => {
    const poly = loftPolyhedron(loftFeat());
    expect(poly.vertices).toHaveLength(4 * 2);
    expect(poly.faces).toHaveLength(4 + 2); // 4 sides + 2 caps
    expect(polyhedronEdges(poly).every((e) => e.faces.length === 2)).toBe(true);
  });

  it('sections sit at their declared z planes', () => {
    const poly = loftPolyhedron(loftFeat());
    const zs = new Set(poly.vertices.map((v) => v.z));
    expect(zs).toEqual(new Set([0, 10]));
  });

  it('rejects <2 sections or mismatched point counts', () => {
    expect(() => loftPolyhedron({ kind: 'loft', sections: [{ profile: { points: sq(5) }, z: 0 }], mode: 'add' })).toThrow(/≥ 2/);
    expect(() =>
      loftPolyhedron({
        kind: 'loft',
        sections: [
          { profile: { points: sq(5) }, z: 0 },
          { profile: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 0 }] }, z: 5 },
        ],
        mode: 'add',
      }),
    ).toThrow(/same point count/);
  });
});

// ── centroid-independent outward orientation (WA-A non-convex fix) ──────────
//
// The as-stored winding must be a globally-consistent OUTWARD shell so the
// raw divergence-theorem sum equals the true volume even for NON-CONVEX solids
// whose centroid lies outside the material. Regression for the L-bracket /
// tube mis-orientation the design-driver geometry gate measured.

/** Raw signed volume with faces' AS-STORED winding (fan from vs[0]). */
function rawSignedVolume(poly: { vertices: { x: number; y: number; z: number }[]; faces: { vertices: number[] }[] }): number {
  let six = 0;
  for (const f of poly.faces) {
    const vs = f.vertices;
    const v0 = poly.vertices[vs[0]];
    for (let i = 1; i < vs.length - 1; i++) {
      const v1 = poly.vertices[vs[i]];
      const v2 = poly.vertices[vs[i + 1]];
      six +=
        v0.x * (v1.y * v2.z - v1.z * v2.y) +
        v0.y * (v1.z * v2.x - v1.x * v2.z) +
        v0.z * (v1.x * v2.y - v1.y * v2.x);
    }
  }
  return six / 6;
}

/** Count manifold edges traversed in the SAME direction by both faces (winding
 * inconsistencies). 0 ⇒ globally consistent orientation. */
function inconsistentEdges(poly: { faces: { vertices: number[] }[] }): number {
  const dir = new Map<string, number>();
  let bad = 0;
  for (const f of poly.faces) {
    const vs = f.vertices;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i], b = vs[(i + 1) % vs.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const fwd = a < b ? 1 : -1;
      const prev = dir.get(key);
      if (prev === undefined) dir.set(key, fwd);
      else if (prev === fwd) bad++;
    }
  }
  return bad;
}

const L_PROFILE: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 8 },
  { x: 8, y: 8 }, { x: 8, y: 40 }, { x: 0, y: 40 },
];

describe('outward orientation is centroid-independent (non-convex)', () => {
  it('L-profile prism: raw signed volume = exact 14720 mm³ (was 5760 mis-oriented)', () => {
    const poly = extrudePolyhedron({ kind: 'extrude', loop: L_PROFILE, depth: 20, direction: 'one_sided', mode: 'add' });
    // area = 60·8 + 8·32 = 736; × depth 20 = 14720.
    expect(rawSignedVolume(poly)).toBeCloseTo(14720, 6);
    expect(inconsistentEdges(poly)).toBe(0);
    expect(polyhedronEdges(poly).every((e) => e.faces.length === 2)).toBe(true);
  });

  it('revolved tube (360°) has a subtractive hole: raw signed volume < smooth Pappus 60π and > 0', () => {
    const poly = revolvePolyhedron(revolveFeat(360), 16);
    const v = rawSignedVolume(poly);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(60 * Math.PI); // faceted ⇒ under the smooth solid; the hole is subtracted, not doubled
    expect(v).toBeCloseTo(183.688, 2);
    expect(inconsistentEdges(poly)).toBe(0);
  });

  it('a face on the reentrant (concave) wall is oriented outward — the case the centroid heuristic broke', () => {
    const poly = extrudePolyhedron({ kind: 'extrude', loop: L_PROFILE, depth: 20, direction: 'one_sided', mode: 'add' });
    // The horizontal-leg top wall at y=8 (x from 8..60) borders the notch; its
    // outward normal must point +Y (out of the material below it), NOT −Y.
    const topOfHorizLeg = poly.faces.find((f) => {
      const pts = f.vertices.map((i) => poly.vertices[i]);
      return pts.every((p) => Math.abs(p.y - 8) < 1e-9) && pts.some((p) => p.x > 8 + 1e-9);
    });
    expect(topOfHorizLeg).toBeDefined();
    expect(topOfHorizLeg!.normal.y).toBeGreaterThan(0.99); // +Y outward (a naive centroid flip made it −Y)
  });
});

describe('convex shells are unchanged (bit-identical winding + normals)', () => {
  it('box prism faces match the exact pre-fix winding & normals', () => {
    const poly = extrudePolyhedron(extrude());
    expect(poly.faces).toEqual([
      { vertices: [3, 2, 1, 0], normal: { x: 0, y: 0, z: -1 } },
      { vertices: [4, 5, 6, 7], normal: { x: 0, y: 0, z: 1 } },
      { vertices: [0, 1, 5, 4], normal: { x: 0, y: -1, z: 0 } },
      { vertices: [1, 2, 6, 5], normal: { x: 1, y: 0, z: 0 } },
      { vertices: [2, 3, 7, 6], normal: { x: 0, y: 1, z: 0 } },
      { vertices: [3, 0, 4, 7], normal: { x: -1, y: 0, z: 0 } },
    ]);
  });
});

describe('featureToPolyhedron dispatcher', () => {
  it('meshes extrude', () => {
    expect(featureToPolyhedron(extrude())).not.toBeNull();
  });
  it('meshes revolve', () => {
    expect(featureToPolyhedron(revolveFeat())).not.toBeNull();
  });
  it('meshes sweep', () => {
    expect(featureToPolyhedron(sweepFeat([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }]))).not.toBeNull();
  });
  it('meshes loft', () => {
    expect(featureToPolyhedron(loftFeat())).not.toBeNull();
  });
  it('returns null for non-meshable kinds (fillet)', () => {
    expect(featureToPolyhedron({ kind: 'fillet' })).toBeNull();
  });
});
