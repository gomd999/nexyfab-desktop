import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { evalCoonsPatch, validateCoonsBoundary, tessellateCoonsPatch, type CoonsBoundary } from './boundarySurface';
import type { NurbsCurve3D } from './nurbsCurve';

/** Build a linear NURBS curve from two endpoints. */
function lineCurve(p0: THREE.Vector3, p1: THREE.Vector3): NurbsCurve3D {
  return {
    controlPoints: [p0, p1],
    degree: 1,
    knots: [0, 0, 1, 1],
  };
}

/** A unit square boundary in the XY plane, traversed consistently. */
function squareBoundary(size = 10): CoonsBoundary {
  return {
    c0: lineCurve(new THREE.Vector3(0, 0, 0), new THREE.Vector3(size, 0, 0)),
    c1: lineCurve(new THREE.Vector3(0, size, 0), new THREE.Vector3(size, size, 0)),
    d0: lineCurve(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, size, 0)),
    d1: lineCurve(new THREE.Vector3(size, 0, 0), new THREE.Vector3(size, size, 0)),
  };
}

describe('evalCoonsPatch · square boundary → flat plane', () => {
  it('reproduces the corner control points exactly', () => {
    const b = squareBoundary(10);
    const bl = evalCoonsPatch(b, 0, 0);
    const br = evalCoonsPatch(b, 1, 0);
    const tl = evalCoonsPatch(b, 0, 1);
    const tr = evalCoonsPatch(b, 1, 1);
    expect(bl.length()).toBeCloseTo(0, 3);
    expect(br.x).toBeCloseTo(10); expect(br.y).toBeCloseTo(0);
    expect(tl.x).toBeCloseTo(0); expect(tl.y).toBeCloseTo(10);
    expect(tr.x).toBeCloseTo(10); expect(tr.y).toBeCloseTo(10);
  });

  it('interior is the flat plane (Z = 0) for a square in XY', () => {
    const b = squareBoundary(10);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        const p = evalCoonsPatch(b, u, v);
        expect(Math.abs(p.z)).toBeLessThan(1e-6);
      }
    }
  });

  it('centre point lies at the centre of the square', () => {
    const b = squareBoundary(10);
    const mid = evalCoonsPatch(b, 0.5, 0.5);
    expect(mid.x).toBeCloseTo(5);
    expect(mid.y).toBeCloseTo(5);
  });
});

describe('evalCoonsPatch · non-planar boundary', () => {
  it('produces a non-planar patch when one edge is lifted in Z', () => {
    const b: CoonsBoundary = {
      c0: lineCurve(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)),
      c1: lineCurve(new THREE.Vector3(0, 10, 5), new THREE.Vector3(10, 10, 5)), // top edge at Z=5
      d0: lineCurve(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 10, 5)),
      d1: lineCurve(new THREE.Vector3(10, 0, 0), new THREE.Vector3(10, 10, 5)),
    };
    const mid = evalCoonsPatch(b, 0.5, 0.5);
    // Patch should interpolate Z from 0 at the bottom to 5 at the top.
    expect(mid.z).toBeCloseTo(2.5, 1);
  });
});

describe('validateCoonsBoundary', () => {
  it('reports zero corner gaps for a well-formed boundary', () => {
    const v = validateCoonsBoundary(squareBoundary(10));
    expect(v.ok).toBe(true);
    expect(v.maxCornerGap).toBeLessThan(1e-6);
  });

  it('flags mismatched corners as large gaps', () => {
    const b: CoonsBoundary = {
      c0: lineCurve(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)),
      c1: lineCurve(new THREE.Vector3(0, 10, 0), new THREE.Vector3(10, 10, 0)),
      d0: lineCurve(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 10, 0)),
      d1: lineCurve(new THREE.Vector3(5, 0, 0), new THREE.Vector3(5, 10, 0)), // wrong x
    };
    const v = validateCoonsBoundary(b);
    expect(v.ok).toBe(false);
    expect(v.maxCornerGap).toBeGreaterThan(1);
  });

  it('respects custom tolerance', () => {
    const b = squareBoundary(10);
    // Tighten endpoint by hand to introduce tiny gap.
    b.d1.controlPoints[0] = new THREE.Vector3(10.0001, 0, 0);
    expect(validateCoonsBoundary(b, 1e-6).ok).toBe(false);
    expect(validateCoonsBoundary(b, 1e-2).ok).toBe(true);
  });
});

describe('tessellateCoonsPatch', () => {
  it('produces (uSeg+1)×(vSeg+1) vertices and 2·uSeg·vSeg triangles', () => {
    const b = squareBoundary(10);
    const geo = tessellateCoonsPatch(b, 6, 4);
    expect(geo.attributes.position.count).toBe(7 * 5);
    expect(geo.index!.count).toBe(2 * 6 * 4 * 3);
  });

  it('flat boundary tessellates onto Z = 0', () => {
    const b = squareBoundary(10);
    const geo = tessellateCoonsPatch(b, 8, 8);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(Math.abs(pos.getZ(i))).toBeLessThan(1e-3);
    }
  });

  it('emits computed normals', () => {
    const geo = tessellateCoonsPatch(squareBoundary(10), 4, 4);
    expect(geo.getAttribute('normal')).toBeDefined();
  });
});
