/**
 * projectView — orthographic projection + HLR tests (Phase 4.1.2).
 */
import { describe, it, expect } from 'vitest';
import { projectPolyhedron, type Segment2D } from './projectView';
import { extrudePolyhedron, revolvePolyhedron } from '@/lib/cad/featureMesh';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';

/** A 10×10×10 cube (XY square extruded 10 in Z). */
function cube(): ReturnType<typeof extrudePolyhedron> {
  const f: ExtrudeFeature = {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    depth: 10,
    direction: 'one_sided',
    mode: 'add',
  };
  return extrudePolyhedron(f);
}

/** Canonical key for an unordered 2D segment (rounded). */
function segKey(s: Segment2D): string {
  const r = (n: number): string => (Math.round(n * 1e4) / 1e4).toString();
  const p = `${r(s.x1)},${r(s.y1)}`;
  const q = `${r(s.x2)},${r(s.y2)}`;
  return p < q ? `${p}|${q}` : `${q}|${p}`;
}

function uniqueSegs(segs: Segment2D[]): Set<string> {
  return new Set(segs.filter((s) => segKey(s).split('|')[0] !== segKey(s).split('|')[1]).map(segKey));
}

describe('projectPolyhedron — cube front view', () => {
  const proj = projectPolyhedron(cube(), 'front');

  it('bbox is the 10×10 face', () => {
    expect(proj.bbox).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('the visible outline is the 10×10 square', () => {
    const vis = uniqueSegs(proj.visible);
    const expected = new Set([
      segKey({ x1: 0, y1: 0, x2: 10, y2: 0 }),
      segKey({ x1: 10, y1: 0, x2: 10, y2: 10 }),
      segKey({ x1: 10, y1: 10, x2: 0, y2: 10 }),
      segKey({ x1: 0, y1: 10, x2: 0, y2: 0 }),
    ]);
    expect(vis).toEqual(expected);
  });

  it('the back face projects to hidden edges (dashed) behind the outline', () => {
    // Back-cap edges coincide with the outline but are classified hidden.
    expect(proj.hidden.length).toBeGreaterThanOrEqual(4);
  });
});

describe('projectPolyhedron — other views', () => {
  it('right view bbox is depth(Y) × height(Z) = 10×10', () => {
    const proj = projectPolyhedron(cube(), 'right');
    expect(proj.bbox.maxX - proj.bbox.minX).toBeCloseTo(10);
    expect(proj.bbox.maxY - proj.bbox.minY).toBeCloseTo(10);
  });

  it('top view bbox is X × Y = 10×10', () => {
    const proj = projectPolyhedron(cube(), 'top');
    expect(proj.bbox.maxX - proj.bbox.minX).toBeCloseTo(10);
    expect(proj.bbox.maxY - proj.bbox.minY).toBeCloseTo(10);
  });

  it('iso view yields a finite bbox and non-empty visible outline', () => {
    const proj = projectPolyhedron(cube(), 'iso');
    expect(Number.isFinite(proj.bbox.minX)).toBe(true);
    expect(proj.visible.length).toBeGreaterThan(0);
    // Iso of a cube is wider/taller than a single face (≈ √2..√3 × edge).
    expect(proj.bbox.maxX - proj.bbox.minX).toBeGreaterThan(10);
  });
});

describe('projectPolyhedron — silhouette HLR (smooth-edge suppression)', () => {
  // A tube: rectangle [4..6]×[0..10] revolved 360° about Y (avoids axis
  // degeneracy; the cross-section is an annulus).
  function tube(segments: number): ReturnType<typeof revolvePolyhedron> {
    const f: RevolveFeature = {
      kind: 'revolve',
      loop: [{ x: 4, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 10 }, { x: 4, y: 10 }],
      angleDegrees: 360,
      mode: 'add',
    };
    return revolvePolyhedron(f, segments);
  }

  it('a 32-facet tube drops the smooth wall facet edges (visible ≪ total edges)', () => {
    const poly = tube(32);
    const totalEdges = poly.faces.reduce((n, f) => n + f.vertices.length, 0); // upper bound
    const proj = projectPolyhedron(poly, 'front');
    expect(proj.visible.length).toBeGreaterThan(0);
    // Smooth suppression keeps only rim arcs + sharp edges — far fewer than the
    // raw per-face edge incidences (which include every smooth wall edge).
    expect(proj.visible.length).toBeLessThan(totalEdges / 2);
  });

  it('no visible edge degenerates to the projected axis centre', () => {
    // Tube min radius is 4, so nothing should project onto (0,0).
    const proj = projectPolyhedron(tube(24), 'front');
    const touchesCentre = proj.visible.some(
      (s) => Math.hypot(s.x1, s.y1) < 0.5 || Math.hypot(s.x2, s.y2) < 0.5,
    );
    expect(touchesCentre).toBe(false);
  });

  it('top view (side-on) spans the full outer diameter', () => {
    const proj = projectPolyhedron(tube(32), 'top');
    expect(proj.bbox.maxX - proj.bbox.minX).toBeCloseTo(12, 1); // 2 × outer r 6
    expect(proj.visible.length).toBeGreaterThan(0);
  });

  it('a prism is unaffected — its 90° edges are all kept', () => {
    const prism = extrudePolyhedron({
      kind: 'extrude',
      loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      depth: 10, direction: 'one_sided', mode: 'add',
    });
    // Front view outline is still the full 4-edge square (no over-suppression).
    expect(projectPolyhedron(prism, 'front').visible.length).toBe(4);
  });

  it('emits suppressed smooth wall edges into `tangent` (front-facing only)', () => {
    // The tube's smooth wall facets are dropped from visible/hidden but now
    // surface in `tangent` so the UI can optionally draw them.
    const proj = projectPolyhedron(tube(32), 'front');
    expect(proj.tangent.length).toBeGreaterThan(0);
    // Tangent edges are not double-counted in the main line work.
    expect(proj.visible).not.toContain(proj.tangent[0]);
  });

  it('a sharp prism has no tangent edges', () => {
    const prism = extrudePolyhedron({
      kind: 'extrude',
      loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      depth: 10, direction: 'one_sided', mode: 'add',
    });
    expect(projectPolyhedron(prism, 'front').tangent.length).toBe(0);
  });
});

describe('projectPolyhedron — HLR occlusion (stepped solid)', () => {
  it('a back step edge hidden behind a nearer front face is dashed', () => {
    // L-shaped profile extruded: an inner concave corner. In an iso view some
    // edges fall behind a nearer face and must be classified hidden.
    const L: ExtrudeFeature = {
      kind: 'extrude',
      loop: [
        { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 8 },
        { x: 8, y: 8 }, { x: 8, y: 20 }, { x: 0, y: 20 },
      ],
      depth: 10,
      direction: 'one_sided',
      mode: 'add',
    };
    const proj = projectPolyhedron(extrudePolyhedron(L), 'iso');
    // The solid has both visible and hidden edges in iso.
    expect(proj.visible.length).toBeGreaterThan(0);
    expect(proj.hidden.length).toBeGreaterThan(0);
  });
});
