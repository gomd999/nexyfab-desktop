/**
 * booleanVolume — verifies that the mesh boolean kernel (applyBooleanSync, three-bvh-csg —
 * the pipeline's kernel-of-record fallback) is CORRECT, not merely robust, by checking the
 * result VOLUME against the analytic inclusion–exclusion value. The existing boolean tests
 * only assert "doesn't crash / is watertight"; none pinned the actual geometry.
 *
 *   union:      |A ∪ B| = |A| + |B| − |A ∩ B|
 *   subtract:   |A − B| = |A| − |A ∩ B|
 *   intersect:  |A ∩ B|
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyBooleanSync } from './boolean';
import { meshVolume } from './roundingGuard';

describe('boolean — result volume vs inclusion–exclusion (verified)', () => {
  it('two overlapping cubes give exact union / subtract / intersect volumes', () => {
    // 20 mm cubes, B shifted +10 mm in x ⇒ overlap = 10·20·20 = 4000 mm³
    const A = () => new THREE.BoxGeometry(20, 20, 20);
    const B = () => { const g = new THREE.BoxGeometry(20, 20, 20); g.translate(10, 0, 0); return g; };
    expect(meshVolume(applyBooleanSync('union', A(), B()))).toBeCloseTo(12000, 0);     // 2·8000 − 4000
    expect(meshVolume(applyBooleanSync('subtract', A(), B()))).toBeCloseTo(4000, 0);   // 8000 − 4000
    expect(meshVolume(applyBooleanSync('intersect', A(), B()))).toBeCloseTo(4000, 0);  // overlap
  });

  it('a disjoint union is the exact sum (no double counting)', () => {
    const A = new THREE.BoxGeometry(10, 10, 10);
    const B = new THREE.BoxGeometry(10, 10, 10); B.translate(30, 0, 0);
    expect(meshVolume(applyBooleanSync('union', A, B))).toBeCloseTo(2000, 0);
  });

  it('subtracts a fully-enclosed body exactly (a void inside a block)', () => {
    const big = new THREE.BoxGeometry(40, 40, 40);   // 64000
    const small = new THREE.BoxGeometry(10, 10, 10); // 1000, centred inside
    expect(meshVolume(applyBooleanSync('subtract', big, small))).toBeCloseTo(63000, 0);
  });

  it('drills a cylindrical hole: V = V_box − π R² h', () => {
    const box = new THREE.BoxGeometry(40, 40, 40);
    const drill = new THREE.CylinderGeometry(10, 10, 60, 64); // through-hole along Y
    const expected = 64000 - Math.PI * 100 * 40;     // 51433.6
    expect(meshVolume(applyBooleanSync('subtract', box, drill))).toBeCloseTo(expected, -2); // within ~50 (faceting)
  });

  it('intersection of nested boxes is the smaller box', () => {
    const big = new THREE.BoxGeometry(40, 40, 40);
    const small = new THREE.BoxGeometry(10, 10, 10);
    expect(meshVolume(applyBooleanSync('intersect', big, small))).toBeCloseTo(1000, 0);
  });
});
