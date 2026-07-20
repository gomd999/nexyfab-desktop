/**
 * topoNaming — stable names survive a parameter rebuild (K2, ADR-014).
 */
import { describe, it, expect } from 'vitest';
import {
  buildExtrudeTopo, resolveFace, resolveEdge, namesOf, edgeMidpoint,
  buildRevolveTopo, revolveEdgeAnchor, revolveNamesOf, revolveEdgeAnchors,
} from './topoNaming';
import type { ExtrudeFeature } from './extrudeProfile';
import type { RevolveFeature } from './revolveProfile';
import { dot } from '@/lib/sketch/sketchPlane';

function box(half: number, depth: number): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }],
    depth, direction: 'one_sided', mode: 'add',
  };
}

describe('buildExtrudeTopo', () => {
  it('names the caps + one side per profile edge', () => {
    const t = buildExtrudeTopo(box(5, 5));
    expect(resolveFace(t, 'f.cap.bottom')).not.toBeNull();
    expect(resolveFace(t, 'f.cap.top')).not.toBeNull();
    // square → 4 sides f.side.0..3
    expect(namesOf(t, 'face').filter((n) => n.startsWith('f.side.'))).toHaveLength(4);
  });

  it('cap names resolve to the correct ±Z faces', () => {
    const t = buildExtrudeTopo(box(5, 5));
    expect(resolveFace(t, 'f.cap.top')!.normal.z).toBeGreaterThan(0.99);
    expect(resolveFace(t, 'f.cap.bottom')!.normal.z).toBeLessThan(-0.99);
  });

  it('edges: 4 bottom + 4 top + 4 vertical for a square prism', () => {
    const t = buildExtrudeTopo(box(5, 5));
    const e = namesOf(t, 'edge');
    expect(e.filter((n) => n.startsWith('e.bottom.'))).toHaveLength(4);
    expect(e.filter((n) => n.startsWith('e.top.'))).toHaveLength(4);
    expect(e.filter((n) => n.startsWith('e.vert.'))).toHaveLength(4);
  });

  // ─── THE topological-naming property: stable across a rebuild ──────────────
  it('a name keeps pointing at the same wall after a parameter edit', () => {
    const small = buildExtrudeTopo(box(5, 5));   // 10×10×5
    const big = buildExtrudeTopo(box(20, 30));   // 40×40×30 — same topology, new params

    // Same name exists in both builds.
    expect(small.byName.has('f.side.1')).toBe(true);
    expect(big.byName.has('f.side.1')).toBe(true);

    // And it resolves to the SAME wall (same outward normal direction) even
    // though the geometry moved + grew — the volatile kernel index would not.
    const a = resolveFace(small, 'f.side.1')!.normal;
    const b = resolveFace(big, 'f.side.1')!.normal;
    expect(dot(a, b)).toBeGreaterThan(0.999); // identical direction

    // Top cap name still resolves to +Z in both (z changed 5 → 30).
    expect(resolveFace(small, 'f.cap.top')!.normal.z).toBeGreaterThan(0.99);
    expect(resolveFace(big, 'f.cap.top')!.normal.z).toBeGreaterThan(0.99);

    // A vertical edge name is stable too.
    expect(resolveEdge(small, 'e.vert.2')).not.toBeNull();
    expect(resolveEdge(big, 'e.vert.2')).not.toBeNull();
  });

  it('every face + edge has exactly one stable name (bijective)', () => {
    const t = buildExtrudeTopo(box(5, 5));
    expect(namesOf(t, 'face')).toHaveLength(t.poly.faces.length);
    expect(namesOf(t, 'edge')).toHaveLength(t.edges.length);
  });

  it('unknown name resolves to null', () => {
    const t = buildExtrudeTopo(box(5, 5));
    expect(resolveFace(t, 'f.side.99')).toBeNull();
    expect(resolveEdge(t, 'nope')).toBeNull();
  });

  // ─── K3 anchor: name → 3D midpoint for kernel edge matching ────────────────
  it('edgeMidpoint anchors a vertical edge at the loop corner, mid-height', () => {
    const t = buildExtrudeTopo(box(5, 5)); // 10×10×5, corners at ±5, z 0..5
    const m = edgeMidpoint(t, 'e.vert.0')!;
    expect(m).not.toBeNull();
    expect(m.z).toBeCloseTo(2.5, 6);                 // mid-height
    expect(Math.hypot(m.x, m.y)).toBeCloseTo(Math.hypot(5, 5), 6); // a corner
    expect(edgeMidpoint(t, 'f.cap.top')).toBeNull(); // not an edge
    expect(edgeMidpoint(t, 'nope')).toBeNull();
  });
});

// ─── revolve (ADR-017 S5 — kernel-measured suite lives in revolveTopo.test.ts) ─

function rev(loop: Array<{ x: number; y: number }>, angle: number): RevolveFeature {
  return { kind: 'revolve', loop, angleDegrees: angle, mode: 'add' };
}
/** Cylinder profile: on-axis edge 3, off-axis vertices 1+2. */
const cyl = (r: number, h: number) =>
  [{ x: 0, y: 0 }, { x: r, y: 0 }, { x: r, y: h }, { x: 0, y: h }];

describe('buildRevolveTopo', () => {
  it('partial sweep names lat arcs, both cap meridians, the axis edge and caps', () => {
    const t = buildRevolveTopo(rev(cyl(10, 20), 90));
    expect(t.full).toBe(false);
    expect(revolveNamesOf(t, 'edge')).toEqual([
      'e.axis.3',
      'e.lat.1', 'e.lat.2',
      'e.mer.end.0', 'e.mer.end.1', 'e.mer.end.2',
      'e.mer.start.0', 'e.mer.start.1', 'e.mer.start.2',
    ]);
    expect(revolveNamesOf(t, 'face')).toEqual([
      'f.cap.end', 'f.cap.start', 'f.side.0', 'f.side.1', 'f.side.2',
    ]);
  });

  it('full 360° is a DIFFERENT topology: no caps/meridians/axis, seam only on periodic surfaces', () => {
    const t = buildRevolveTopo(rev(cyl(10, 20), 360));
    expect(t.full).toBe(true);
    // Radial edges (y constant → planar disc) mint no seam; the vertical wall does.
    expect(revolveNamesOf(t, 'edge')).toEqual(['e.lat.1', 'e.lat.2', 'e.seam.1']);
    expect(revolveNamesOf(t, 'face')).toEqual(['f.side.0', 'f.side.1', 'f.side.2']);
  });

  it('anchors follow the measured kernel conventions (θ=a/2 arcs, θ=180° circles, −z rotation)', () => {
    const p = buildRevolveTopo(rev(cyl(10, 20), 90));
    // arc midpoint at 45°: (10·cos45, 0, −10·sin45)
    const lat = revolveEdgeAnchor(p, 'e.lat.1')!;
    expect(lat.x).toBeCloseTo(10 * Math.SQRT1_2, 9);
    expect(lat.z).toBeCloseTo(-10 * Math.SQRT1_2, 9);
    // start meridian in the z=0 half-plane; end meridian rotated by the full angle
    expect(revolveEdgeAnchor(p, 'e.mer.start.0')).toEqual({ x: 5, y: 0, z: 0 });
    const merE = revolveEdgeAnchor(p, 'e.mer.end.0')!;
    expect(merE.x).toBeCloseTo(0, 9);
    expect(merE.z).toBeCloseTo(-5, 9);
    // axis edge midpoint sits on the axis
    expect(revolveEdgeAnchor(p, 'e.axis.3')).toEqual({ x: 0, y: 10, z: 0 });
    // full circle midpoint at 180°
    const f = buildRevolveTopo(rev(cyl(10, 20), 360));
    const circ = revolveEdgeAnchor(f, 'e.lat.1')!;
    expect(circ.x).toBeCloseTo(-10, 9);
    expect(Math.abs(circ.z)).toBeLessThan(1e-9);
  });

  it('a name keeps deriving from its profile index after a parameter edit', () => {
    const small = buildRevolveTopo(rev(cyl(10, 20), 120));
    const big = buildRevolveTopo(rev(cyl(35, 60), 240));
    // Same name set (same topology class) …
    expect(revolveNamesOf(big, 'edge')).toEqual(revolveNamesOf(small, 'edge'));
    // … and e.lat.1 still anchors to vertex 1's orbit (radius = r at y = 0).
    const a = revolveEdgeAnchor(big, 'e.lat.1')!;
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(35, 9);
    expect(a.y).toBe(0);
  });

  it('crossing full↔partial loses topology-bound names explicitly (null), never remaps them', () => {
    const part = buildRevolveTopo(rev(cyl(10, 20), 350));
    const full = buildRevolveTopo(rev(cyl(10, 20), 360));
    expect(revolveEdgeAnchor(full, 'e.mer.start.1')).toBeNull(); // not reinterpreted as the seam
    expect(revolveEdgeAnchor(full, 'e.axis.3')).toBeNull();
    expect(revolveEdgeAnchor(part, 'e.seam.1')).toBeNull();
    // The persistent entity keeps its name across the crossing.
    expect(revolveEdgeAnchor(full, 'e.lat.1')).not.toBeNull();
    expect(revolveEdgeAnchor(part, 'e.lat.1')).not.toBeNull();
  });

  it('on-axis vertices sweep no edge; duplicate loop points are canonicalised', () => {
    const t = buildRevolveTopo(rev([
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }, { x: 0, y: 0 },
    ], 360));
    expect(t.profile).toHaveLength(4); // dedupe matches featureMesh / MakePolygon
    expect(revolveNamesOf(t, 'edge')).toEqual(['e.lat.1', 'e.lat.2', 'e.seam.1']);
  });

  it('refuses instead of guessing: bad profile / frame / angle', () => {
    expect(() => buildRevolveTopo(rev([{ x: 0, y: 0 }, { x: 1, y: 0 }], 90))).toThrow(/≥ 3 distinct/);
    expect(() => buildRevolveTopo(rev([{ x: -1, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], 90))).toThrow(/canonical axis frame/);
    expect(() => buildRevolveTopo(rev(cyl(10, 20), 0))).toThrow(/angle/);
    expect(() => buildRevolveTopo(rev(cyl(10, 20), 361))).toThrow(/angle/);
  });

  it('unknown or non-edge names anchor to null; anchors map exports edges only', () => {
    const t = buildRevolveTopo(rev(cyl(10, 20), 90));
    expect(revolveEdgeAnchor(t, 'e.lat.99')).toBeNull();
    expect(revolveEdgeAnchor(t, 'f.side.0')).toBeNull(); // face, not edge
    const m = revolveEdgeAnchors(t);
    expect([...m.keys()].sort()).toEqual(revolveNamesOf(t, 'edge'));
  });
});
