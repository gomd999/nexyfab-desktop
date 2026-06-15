/**
 * booleanRobust.test.ts — the robust-boolean wrapper (applyBooleanRobust) had
 * NO test coverage despite being the production layer that short-circuits the
 * disjoint / identical cases per operation and runs the jitter → weld retry
 * pipeline. Each short-circuit has an exact, operation-dependent right answer;
 * these pin them and exercise a real overlapping subtract end-to-end.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyBooleanRobust } from './booleanRobust';

/** A 10mm cube centred at (x,0,0). */
function cubeAt(x: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(10, 10, 10);
  g.translate(x, 0, 0);
  return g;
}

function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position');
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  let v = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(v);
}

describe('applyBooleanRobust · disjoint short-circuit (per operation)', () => {
  it('union of disjoint solids concatenates both', () => {
    const r = applyBooleanRobust('union', cubeAt(0), cubeAt(100));
    expect(r.geometry).not.toBeNull();
    expect(r.failure).toBeNull();
    expect(r.hints[0]?.code).toBe('disjoint');
    // Both cubes survive → ~2000 mm³ total.
    expect(meshVolume(r.geometry!)).toBeCloseTo(2000, 0);
  });

  it('subtract of a non-touching tool returns the base unchanged', () => {
    const r = applyBooleanRobust('subtract', cubeAt(0), cubeAt(100));
    expect(r.geometry).not.toBeNull();
    expect(r.failure).toBeNull();
    expect(meshVolume(r.geometry!)).toBeCloseTo(1000, 0); // base only
  });

  it('intersect of disjoint solids is empty', () => {
    const r = applyBooleanRobust('intersect', cubeAt(0), cubeAt(100));
    expect(r.geometry).toBeNull();
    expect(r.failure?.kind).toBe('disjoint_inputs');
  });
});

describe('applyBooleanRobust · identical-input short-circuit (per operation)', () => {
  it('subtract of identical inputs is empty (A − A = ∅)', () => {
    const r = applyBooleanRobust('subtract', cubeAt(0), cubeAt(0));
    expect(r.geometry).toBeNull();
    expect(r.failure?.kind).toBe('identical_inputs');
  });

  it('union of identical inputs returns A unchanged', () => {
    const r = applyBooleanRobust('union', cubeAt(0), cubeAt(0));
    expect(r.geometry).not.toBeNull();
    expect(r.failure).toBeNull();
    expect(meshVolume(r.geometry!)).toBeCloseTo(1000, 0);
  });

  it('intersect of identical inputs returns A unchanged', () => {
    const r = applyBooleanRobust('intersect', cubeAt(0), cubeAt(0));
    expect(r.geometry).not.toBeNull();
    expect(meshVolume(r.geometry!)).toBeCloseTo(1000, 0);
  });
});

describe('applyBooleanRobust · real overlapping boolean', () => {
  it('subtracting an overlapping tool removes the intersection volume', () => {
    // Base cube [-5,5]³; tool shifted +5 in x overlaps the [0,5] slab (half).
    const r = applyBooleanRobust('subtract', cubeAt(0), cubeAt(5));
    expect(r.geometry).not.toBeNull();
    expect(r.failure).toBeNull();
    // Removed half the cube → ~500 mm³ remains.
    expect(meshVolume(r.geometry!)).toBeGreaterThan(400);
    expect(meshVolume(r.geometry!)).toBeLessThan(600);
  });

  it('union of overlapping cubes is less than the disjoint sum (overlap merged once)', () => {
    const r = applyBooleanRobust('union', cubeAt(0), cubeAt(5));
    expect(r.geometry).not.toBeNull();
    // Two 1000mm³ cubes overlapping by 500 → ~1500, well under 2000.
    expect(meshVolume(r.geometry!)).toBeGreaterThan(1400);
    expect(meshVolume(r.geometry!)).toBeLessThan(1600);
  });
});
