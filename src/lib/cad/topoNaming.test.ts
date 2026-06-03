/**
 * topoNaming — stable names survive a parameter rebuild (K2, ADR-014).
 */
import { describe, it, expect } from 'vitest';
import { buildExtrudeTopo, resolveFace, resolveEdge, namesOf, edgeMidpoint } from './topoNaming';
import type { ExtrudeFeature } from './extrudeProfile';
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
