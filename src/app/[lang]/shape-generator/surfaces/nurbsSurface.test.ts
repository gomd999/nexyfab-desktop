import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { evalNurbsSurface, evalNurbsSurfaceNormal, tessellateNurbsSurface, type NurbsSurface } from './nurbsSurface';
import { clampedUniformKnots3D } from './nurbsCurve';

/** Flat XY plane as a degree-1 NURBS surface, 2×2 control grid. */
function flatPlane(size = 10): NurbsSurface {
  return {
    controlPoints: [
      [new THREE.Vector3(0, 0, 0),    new THREE.Vector3(0, size, 0)],
      [new THREE.Vector3(size, 0, 0), new THREE.Vector3(size, size, 0)],
    ],
    degreeU: 1,
    degreeV: 1,
    knotsU: [0, 0, 1, 1],
    knotsV: [0, 0, 1, 1],
  };
}

/** A 3×3 quadratic NURBS surface bulging in +Z at its centre. */
function bulgingSurface(): NurbsSurface {
  const p = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  return {
    controlPoints: [
      [p(0, 0, 0), p(0, 5, 0), p(0, 10, 0)],
      [p(5, 0, 0), p(5, 5, 10), p(5, 10, 0)], // centre pushed up
      [p(10, 0, 0), p(10, 5, 0), p(10, 10, 0)],
    ],
    degreeU: 2,
    degreeV: 2,
    knotsU: clampedUniformKnots3D(2, 2),
    knotsV: clampedUniformKnots3D(2, 2),
  };
}

describe('evalNurbsSurface · flat plane', () => {
  it('corners are exactly the corner control points', () => {
    const s = flatPlane(10);
    expect(evalNurbsSurface(s, 0, 0)).toEqual(new THREE.Vector3(0, 0, 0));
    const c01 = evalNurbsSurface(s, 0, 1);
    expect(c01.x).toBeCloseTo(0); expect(c01.y).toBeCloseTo(10);
    const c10 = evalNurbsSurface(s, 1, 0);
    expect(c10.x).toBeCloseTo(10); expect(c10.y).toBeCloseTo(0);
    const c11 = evalNurbsSurface(s, 1, 1);
    expect(c11.x).toBeCloseTo(10); expect(c11.y).toBeCloseTo(10);
  });

  it('linearly interpolates the interior', () => {
    const s = flatPlane(10);
    const mid = evalNurbsSurface(s, 0.5, 0.5);
    expect(mid.x).toBeCloseTo(5);
    expect(mid.y).toBeCloseTo(5);
    expect(mid.z).toBeCloseTo(0);
  });
});

describe('evalNurbsSurface · bulging surface', () => {
  it('centre rises toward the bulged control point', () => {
    const s = bulgingSurface();
    const corner = evalNurbsSurface(s, 0, 0);
    const center = evalNurbsSurface(s, 0.5, 0.5);
    expect(corner.z).toBeCloseTo(0);
    expect(center.z).toBeGreaterThan(2);
  });
});

describe('evalNurbsSurfaceNormal', () => {
  it('flat plane normal is +Z (or -Z depending on winding)', () => {
    const s = flatPlane(10);
    const n = evalNurbsSurfaceNormal(s, 0.5, 0.5);
    // Normal should be along Z axis; either direction is fine for a flat patch.
    expect(Math.abs(n.z)).toBeGreaterThan(0.95);
    expect(Math.abs(n.x)).toBeLessThan(0.1);
    expect(Math.abs(n.y)).toBeLessThan(0.1);
  });

  it('bulging surface normal at centre tilts toward the bulge direction', () => {
    const s = bulgingSurface();
    const n = evalNurbsSurfaceNormal(s, 0.5, 0.5);
    // Centre control point is +Z; normal at centre should still be
    // primarily +Z (the bulge is a smooth dome).
    expect(Math.abs(n.z)).toBeGreaterThan(0.5);
  });
});

describe('tessellateNurbsSurface', () => {
  it('produces (uSeg+1)×(vSeg+1) vertices', () => {
    const s = flatPlane(10);
    const geo = tessellateNurbsSurface(s, 4, 6);
    expect(geo.attributes.position.count).toBe(5 * 7);
  });

  it('produces 2 × uSeg × vSeg triangles', () => {
    const s = flatPlane(10);
    const geo = tessellateNurbsSurface(s, 4, 6);
    expect(geo.index!.count).toBe(2 * 4 * 6 * 3);
  });

  it('writes normals into the geometry', () => {
    const s = flatPlane(10);
    const geo = tessellateNurbsSurface(s, 4, 4);
    expect(geo.getAttribute('normal')).toBeDefined();
    expect(geo.getAttribute('normal').count).toBe(geo.attributes.position.count);
  });

  it('tessellation of a flat plane lies in the source plane', () => {
    const s = flatPlane(10);
    const geo = tessellateNurbsSurface(s, 8, 8);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(Math.abs(pos.getZ(i))).toBeLessThan(1e-3);
    }
  });

  it('tessellation respects custom segment counts', () => {
    const s = flatPlane(10);
    const coarse = tessellateNurbsSurface(s, 2, 2);
    const fine = tessellateNurbsSurface(s, 16, 16);
    expect(fine.attributes.position.count).toBeGreaterThan(coarse.attributes.position.count);
  });
});

describe('rational NURBS — varying weights (homogeneous evaluation)', () => {
  // 2×2 bilinear grid; P[i][j] with i=U, j=V. Corner (1,1) weighted 5×.
  const P = [
    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)],
    [new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 1, 1)],
  ];
  const W = [[1, 1], [1, 5]];
  const rationalSurface: NurbsSurface = {
    controlPoints: P, degreeU: 1, degreeV: 1, knotsU: [0, 0, 1, 1], knotsV: [0, 0, 1, 1], weights: W,
  };

  /** Closed-form rational bilinear: Σ NᵢNⱼwᵢⱼPᵢⱼ / Σ NᵢNⱼwᵢⱼ. */
  function directRational(u: number, v: number): THREE.Vector3 {
    const Nu = [1 - u, u], Nv = [1 - v, v];
    let x = 0, y = 0, z = 0, den = 0;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const c = Nu[i]! * Nv[j]! * W[i]![j]!;
      x += c * P[i]![j]!.x; y += c * P[i]![j]!.y; z += c * P[i]![j]!.z; den += c;
    }
    return new THREE.Vector3(x / den, y / den, z / den);
  }

  it('matches the closed-form rational bilinear at interior points', () => {
    for (const [u, v] of [[0.5, 0.5], [0.3, 0.7], [0.8, 0.2], [0.25, 0.25]] as const) {
      const got = evalNurbsSurface(rationalSurface, u, v);
      const want = directRational(u, v);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
      expect(got.z).toBeCloseTo(want.z, 6);
    }
  });

  it('the weight actually pulls the surface (≠ the equal-weight result)', () => {
    const weighted = evalNurbsSurface(rationalSurface, 0.5, 0.5);
    const equal = evalNurbsSurface({ ...rationalSurface, weights: undefined }, 0.5, 0.5);
    // weighted center is pulled toward the heavy corner P[1][1]=(1,1,1).
    expect(weighted.x).toBeCloseTo(0.75, 6);
    expect(equal.x).toBeCloseTo(0.5, 6);
    expect(weighted.z).toBeGreaterThan(equal.z); // pulled up in Z too
  });

  it('interior point still lies in the unit cell (sane)', () => {
    const p = evalNurbsSurface(rationalSurface, 0.5, 0.5);
    for (const c of [p.x, p.y, p.z]) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
  });
});
