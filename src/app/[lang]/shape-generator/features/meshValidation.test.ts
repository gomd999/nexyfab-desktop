import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { validateMesh, assertMeshValid } from './meshValidation';

function makeBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(10, 10, 10);
  g.deleteAttribute('uv');
  return g;
}

describe('validateMesh · structural gates', () => {
  it('passes a clean box geometry', () => {
    const r = validateMesh(makeBox());
    expect(r.ok).toBe(true);
    expect(r.issues.filter(i => i.severity === 'error')).toHaveLength(0);
  });

  it('flags missing position attribute as fatal', () => {
    const g = new THREE.BufferGeometry();
    const r = validateMesh(g);
    expect(r.ok).toBe(false);
    expect(r.issues[0].code).toBe('no-position');
  });

  it('flags empty triangle list', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    const r = validateMesh(g);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'no-triangles')).toBe(true);
  });

  it('flags NaN / Infinity in position attribute', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      NaN, 0, 0,
    ], 3));
    const r = validateMesh(g);
    expect(r.ok).toBe(false);
    const issue = r.issues.find(i => i.code === 'non-finite-position');
    expect(issue?.count).toBe(1);
    expect(issue?.sampleIndices).toEqual([2]);
  });

  it('flags index buffer entries pointing past the vertex array', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ], 3));
    g.setIndex([0, 1, 99]); // 99 is way out of range
    const r = validateMesh(g);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'index-out-of-range')).toBe(true);
  });
});

describe('validateMesh · degeneracy', () => {
  it('flags zero-area triangles (collinear vertices)', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      2, 0, 0, // collinear → degenerate
    ], 3));
    const r = validateMesh(g, { degeneracy: true });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'degenerate-triangle')).toBe(true);
  });

  it('flags sliver triangles (extreme aspect ratio)', () => {
    const g = new THREE.BufferGeometry();
    // Long thin triangle: base 100mm, height 1e-5mm → aspect ratio ≈ 1e7.
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      100, 0, 0,
      50, 1e-5, 0,
    ], 3));
    const r = validateMesh(g, { degeneracy: true });
    // Could be degenerate OR sliver depending on which threshold fires
    // first; at least one warning/error should land.
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it('respects custom minTriangleArea', () => {
    const g = new THREE.BufferGeometry();
    // 5mm² triangle.
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      10, 0, 0,
      0, 1, 0,
    ], 3));
    // Default threshold 1e-6 → ok.
    expect(validateMesh(g).ok).toBe(true);
    // Tighter threshold 100 → fails as degenerate.
    const r = validateMesh(g, { minTriangleArea: 100 });
    expect(r.issues.some(i => i.code === 'degenerate-triangle')).toBe(true);
  });

  it('opt-out skips degeneracy checks entirely', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      2, 0, 0, // collinear
    ], 3));
    const r = validateMesh(g, { degeneracy: false });
    expect(r.issues.some(i => i.code === 'degenerate-triangle')).toBe(false);
  });
});

describe('validateMesh · topology', () => {
  it('flags non-manifold edges (3+ faces sharing one edge)', () => {
    // Build a "Y" shape: 3 triangles all sharing edge (0,1).
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,   // 0
      1, 0, 0,   // 1
      0, 1, 0,   // 2 (face a)
      0, -1, 0,  // 3 (face b)
      0, 0, 1,   // 4 (face c)
    ], 3));
    g.setIndex([0, 1, 2,  0, 1, 3,  0, 1, 4]);
    const r = validateMesh(g, { topology: true, degeneracy: false });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'non-manifold-edge')).toBe(true);
  });

  it('flags isolated (unreferenced) vertices', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      99, 99, 99, // never referenced
    ], 3));
    g.setIndex([0, 1, 2]);
    const r = validateMesh(g, { topology: true });
    const iso = r.issues.find(i => i.code === 'isolated-vertex');
    expect(iso?.count).toBe(1);
    expect(iso?.severity).toBe('warning');
  });

  it('default opts skip topology checks', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,  1, 0, 0,  0, 1, 0,  0, -1, 0,  0, 0, 1,
    ], 3));
    g.setIndex([0, 1, 2,  0, 1, 3,  0, 1, 4]);
    const r = validateMesh(g, { degeneracy: false });
    expect(r.issues.some(i => i.code === 'non-manifold-edge')).toBe(false);
  });
});

describe('assertMeshValid', () => {
  it('does not throw on a clean mesh', () => {
    expect(() => assertMeshValid(makeBox())).not.toThrow();
  });

  it('throws with a structured message on errors', () => {
    const g = new THREE.BufferGeometry();
    expect(() => assertMeshValid(g, undefined, 'boolean input')).toThrow(/boolean input validation failed/);
  });
});
