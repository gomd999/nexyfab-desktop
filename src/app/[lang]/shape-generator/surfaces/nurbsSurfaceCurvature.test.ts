/**
 * nurbsSurfaceCurvature — ANALYTIC differential geometry, verified against the
 * closed-form curvature of canonical surfaces: a plane (K=0, H=0), a parabolic
 * cylinder and a rational circular cylinder (both developable, K=0, one
 * principal curvature zero), and a rational sphere octant (K=1/R², κ1=κ2=1/R).
 * The sphere exercises the full bivariate RATIONAL path (both fundamental forms,
 * non-zero Gaussian curvature).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { nurbsSurfaceCurvature } from './nurbsSurfaceCurvature';
import type { NurbsSurface } from './nurbsSurface';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('nurbsSurfaceCurvature — closed-form validation', () => {
  it('a plane has zero Gaussian and mean curvature', () => {
    const plane: NurbsSurface = {
      controlPoints: [[V(0, 0, 0), V(0, 10, 0)], [V(10, 0, 0), V(10, 10, 0)]],
      degreeU: 1, degreeV: 1, knotsU: [0, 0, 1, 1], knotsV: [0, 0, 1, 1],
    };
    const c = nurbsSurfaceCurvature(plane, 0.5, 0.5);
    expect(c.gaussian).toBeCloseTo(0, 6);
    expect(c.mean).toBeCloseTo(0, 6);
    expect(c.k1).toBeCloseTo(0, 6);
    expect(c.k2).toBeCloseTo(0, 6);
  });

  it('a parabolic cylinder is developable (K=0) with one principal curvature', () => {
    // Parabola P(v)=(0,0)→(5,5)→(10,0) in (y,z) extruded along x. At v=0.5 the
    // hand-computed principal curvatures are {0, −0.2}.
    const s: NurbsSurface = {
      controlPoints: [
        [V(0, 0, 0), V(0, 5, 5), V(0, 10, 0)],
        [V(10, 0, 0), V(10, 5, 5), V(10, 10, 0)],
      ],
      degreeU: 1, degreeV: 2, knotsU: [0, 0, 1, 1], knotsV: [0, 0, 0, 1, 1, 1],
    };
    const c = nurbsSurfaceCurvature(s, 0.5, 0.5);
    expect(c.gaussian).toBeCloseTo(0, 5);
    expect(c.k1).toBeCloseTo(0, 4);
    expect(c.k2).toBeCloseTo(-0.2, 4);
  });

  it('a rational circular cylinder of radius R has K=0 and principal {1/R, 0}', () => {
    const R = 10, w = Math.SQRT1_2;
    const cyl: NurbsSurface = {
      controlPoints: [
        [V(0, R, 0), V(0, R, R), V(0, 0, R)],
        [V(20, R, 0), V(20, R, R), V(20, 0, R)],
      ],
      weights: [[1, w, 1], [1, w, 1]],
      degreeU: 1, degreeV: 2, knotsU: [0, 0, 1, 1], knotsV: [0, 0, 0, 1, 1, 1],
    };
    for (const v of [0.25, 0.5, 0.75]) {
      const c = nurbsSurfaceCurvature(cyl, 0.5, v);
      expect(c.gaussian).toBeCloseTo(0, 4);
      const maxK = Math.max(Math.abs(c.k1), Math.abs(c.k2));
      const minK = Math.min(Math.abs(c.k1), Math.abs(c.k2));
      expect(maxK).toBeCloseTo(1 / R, 3); // 0.1
      expect(minK).toBeCloseTo(0, 3);
    }
  });

  it('a rational sphere octant of radius R has K=1/R² and κ1=κ2=1/R', () => {
    const R = 10, w = Math.SQRT1_2;
    const sphere: NurbsSurface = {
      controlPoints: [
        [V(R, 0, 0), V(R, R, 0), V(0, R, 0)],
        [V(R, 0, R), V(R, R, R), V(0, R, R)],
        [V(0, 0, R), V(0, 0, R), V(0, 0, R)],
      ],
      weights: [[1, w, 1], [w, 0.5, w], [1, w, 1]],
      degreeU: 2, degreeV: 2, knotsU: [0, 0, 0, 1, 1, 1], knotsV: [0, 0, 0, 1, 1, 1],
    };
    for (const [u, v] of [[0.5, 0.5], [0.3, 0.7], [0.5, 0.25]] as Array<[number, number]>) {
      const c = nurbsSurfaceCurvature(sphere, u, v);
      expect(c.gaussian).toBeCloseTo(1 / (R * R), 4); // 0.01
      expect(c.k1).toBeCloseTo(1 / R, 3);             // 0.1
      expect(c.k2).toBeCloseTo(1 / R, 3);
      expect(c.normal.length()).toBeCloseTo(1, 6);
    }
  });
});
