/**
 * hiddenLineRemoval — depth-occlusion HLR, the real thing the face-normal
 * projector cannot do. Verified against geometry with a known occluder.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { removeHiddenLines, trianglesFromArrays, viewBasis, type Vec3 } from './hiddenLineRemoval';

const VIEW_Z: Vec3 = [0, 0, 1]; // looking along +Z toward the viewer
/** A flat quad at z=0 covering XY [-10,10]² — two triangles. */
const QUAD: Array<[Vec3, Vec3, Vec3]> = [
  [[-10, -10, 0], [10, -10, 0], [10, 10, 0]],
  [[-10, -10, 0], [10, 10, 0], [-10, 10, 0]],
];
const segLen = (segs: { a: { x: number; y: number }; b: { x: number; y: number } }[]) =>
  segs.reduce((acc, s) => acc + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), 0);

const trisOf = (g: THREE.BufferGeometry) =>
  trianglesFromArrays(g.getAttribute('position').array as Float32Array, g.index ? (g.index.array as ArrayLike<number>) : null);

describe('removeHiddenLines — occlusion against a covering quad', () => {
  it('an edge BEHIND the quad is fully hidden', () => {
    const r = removeHiddenLines([[[-5, 0, -5], [5, 0, -5]]], QUAD, VIEW_Z);
    expect(segLen(r.hidden)).toBeCloseTo(10, 1);
    expect(segLen(r.visible)).toBeLessThan(0.5);
  });

  it('an edge IN FRONT of the quad is fully visible', () => {
    const r = removeHiddenLines([[[-5, 0, 5], [5, 0, 5]]], QUAD, VIEW_Z);
    expect(segLen(r.visible)).toBeCloseTo(10, 1);
    expect(segLen(r.hidden)).toBeLessThan(0.5);
  });

  it('an edge crossing the occluder boundary splits into visible + hidden', () => {
    // x −20..−10 is outside the quad (visible); x −10..0 is behind it (hidden).
    const r = removeHiddenLines([[[-20, 0, -5], [0, 0, -5]]], QUAD, VIEW_Z, { minSamples: 40 });
    expect(segLen(r.visible)).toBeCloseTo(10, 0);
    expect(segLen(r.hidden)).toBeCloseTo(10, 0);
  });

  it('an edge outside the occluder footprint stays visible', () => {
    const r = removeHiddenLines([[[15, 0, -5], [25, 0, -5]]], QUAD, VIEW_Z);
    expect(segLen(r.visible)).toBeCloseTo(10, 1);
    expect(segLen(r.hidden)).toBeLessThan(0.5);
  });
});

describe('removeHiddenLines — real meshes', () => {
  it('a box does NOT occlude its own front-face edge (depth epsilon)', () => {
    const g = new THREE.BoxGeometry(20, 20, 20);
    const r = removeHiddenLines([[[-10, 10, 10], [10, 10, 10]]], trisOf(g), VIEW_Z);
    expect(segLen(r.visible)).toBeCloseTo(20, 1);
    expect(segLen(r.hidden)).toBeLessThan(0.5);
  });

  it('a box sitting behind a larger box has its front edge hidden', () => {
    const front = new THREE.BoxGeometry(40, 40, 10); // z ∈ [−5, 5]
    const back = new THREE.BoxGeometry(20, 20, 10); back.translate(0, 0, -20); // z ∈ [−25, −15]
    const tris = [...trisOf(front), ...trisOf(back)];
    // back box front-top edge (z = −15) lies behind the front box → hidden.
    const hiddenEdge = removeHiddenLines([[[-10, 10, -15], [10, 10, -15]]], tris, VIEW_Z);
    expect(segLen(hiddenEdge.hidden)).toBeCloseTo(20, 0);
    expect(segLen(hiddenEdge.visible)).toBeLessThan(1);
    // the front box's own top edge is unobstructed → visible.
    const visibleEdge = removeHiddenLines([[[-20, 20, 5], [20, 20, 5]]], tris, VIEW_Z);
    expect(segLen(visibleEdge.visible)).toBeCloseTo(40, 0);
    expect(segLen(visibleEdge.hidden)).toBeLessThan(1);
  });
});

describe('viewBasis', () => {
  it('produces an orthonormal right-handed basis with w along the view dir', () => {
    const { u, v, w } = viewBasis([0, 0, 5]);
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(w, [0, 0, 1])).toBeCloseTo(1, 6); // w = +Z
    expect(dot(u, v)).toBeCloseTo(0, 6);
    expect(dot(u, w)).toBeCloseTo(0, 6);
    expect(Math.hypot(u[0], u[1], u[2])).toBeCloseTo(1, 6);
  });
});
