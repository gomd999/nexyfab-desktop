/**
 * brepClosedShell — verifies the half-edge B-rep kernel's Euler–Poincaré checker
 * (eulerStats) and divergence-theorem volume (shellVolume) against a hand-built CLOSED
 * tetrahedron. Both functions existed but no test ever asserted their results: eulerStats
 * computed satisfiesFormula/genus and shellVolume computed a number, neither checked.
 *
 * A closed tetrahedron (4 vertices, 6 edges, 4 triangular faces) is the simplest closed
 * B-rep solid: V−E+F = 2, genus 0, and (built on the axes at the origin) volume a³/6.
 * An OPEN single face has a non-integer genus — the checker distinguishes a watertight
 * solid from a dangling sheet.
 */
import { describe, it, expect } from 'vitest';
import { BrepModel, createVertex, createEdgePair, createFace, eulerStats, type BrepShell } from './halfEdgeBrep';
import { shellVolume } from './brepBoolean';

/** Build a closed tetrahedron with all faces wound CCW outward (corner tet, volume a³/6). */
function buildTetra(a: number): { model: BrepModel; shell: BrepShell } {
  const m = new BrepModel();
  const s = m.newShell();
  const v0 = createVertex(m, s, [0, 0, 0]);
  const v1 = createVertex(m, s, [a, 0, 0]);
  const v2 = createVertex(m, s, [0, a, 0]);
  const v3 = createVertex(m, s, [0, 0, a]);
  const e01 = createEdgePair(m, s, v0, v1), e02 = createEdgePair(m, s, v0, v2), e03 = createEdgePair(m, s, v0, v3);
  const e12 = createEdgePair(m, s, v1, v2), e13 = createEdgePair(m, s, v1, v3), e23 = createEdgePair(m, s, v2, v3);
  const link = (x: { next: unknown; prev: unknown }, y: { next: unknown; prev: unknown }, z: { next: unknown; prev: unknown }) => {
    x.next = y; y.next = z; z.next = x; x.prev = z; y.prev = x; z.prev = y;
  };
  link(e12, e23, e13.twin!); createFace(m, s, e12);          // face v1-v2-v3 (outward +x+y+z)
  link(e03, e23.twin!, e02.twin!); createFace(m, s, e03);    // face v0-v3-v2 (outward −x)
  link(e01, e13, e03.twin!); createFace(m, s, e01);          // face v0-v1-v3 (outward −y)
  link(e02, e12.twin!, e01.twin!); createFace(m, s, e02);    // face v0-v2-v1 (outward −z)
  return { model: m, shell: s };
}

describe('brep closed shell — Euler & volume (verified)', () => {
  it('a tetrahedron satisfies V−E+F=2 with integer genus 0', () => {
    const { model } = buildTetra(6);
    const st = eulerStats(model);
    expect(st.vertices).toBe(4);
    expect(st.edges).toBe(6);          // 12 half-edges / 2
    expect(st.faces).toBe(4);
    expect(st.vertices - st.edges + st.faces).toBe(2);
    expect(st.genus).toBe(0);          // a valid closed genus-0 solid
    expect(st.satisfiesFormula).toBe(true);
  });

  it('computes the exact tetra volume a³/6 and scales with a³', () => {
    expect(shellVolume(buildTetra(6).shell)).toBeCloseTo(6 ** 3 / 6, 6);   // 36
    expect(shellVolume(buildTetra(3).shell)).toBeCloseTo(3 ** 3 / 6, 6);   // 4.5
    expect(shellVolume(buildTetra(12).shell) / shellVolume(buildTetra(6).shell)).toBeCloseTo(8, 9); // (12/6)³
  });

  it('flags an open (non-watertight) shell by a non-integer genus', () => {
    // a single triangular face: V=3, E=3, F=1 ⇒ V−E+F=1 ⇒ genus = 0.5 (not a closed solid)
    const m = new BrepModel();
    const s = m.newShell();
    const a = createVertex(m, s, [0, 0, 0]), b = createVertex(m, s, [1, 0, 0]), c = createVertex(m, s, [0, 1, 0]);
    const e0 = createEdgePair(m, s, a, b), e1 = createEdgePair(m, s, b, c), e2 = createEdgePair(m, s, c, a);
    e0.next = e1; e1.next = e2; e2.next = e0; e0.prev = e2; e1.prev = e0; e2.prev = e1;
    createFace(m, s, e0);
    const st = eulerStats(m);
    expect(Number.isInteger(st.genus)).toBe(false); // 0.5 ⇒ not a watertight manifold solid
  });
});
