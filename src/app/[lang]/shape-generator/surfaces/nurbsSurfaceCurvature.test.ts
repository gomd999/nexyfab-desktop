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
import {
  nurbsSurfaceCurvature, normalCurvature, nurbsIsoCurvatureComb,
  buildCurvatureCombGeometry, buildCombScene,
} from './nurbsSurfaceCurvature';
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

describe('normalCurvature — directional', () => {
  it('on a cylinder: ~1/R around the circumference, ~0 along the axis', () => {
    const R = 10, w = Math.SQRT1_2;
    const cyl: NurbsSurface = {
      controlPoints: [
        [V(0, R, 0), V(0, R, R), V(0, 0, R)],
        [V(20, R, 0), V(20, R, R), V(20, 0, R)],
      ],
      weights: [[1, w, 1], [1, w, 1]],
      degreeU: 1, degreeV: 2, knotsU: [0, 0, 1, 1], knotsV: [0, 0, 0, 1, 1, 1],
    };
    // U is the axis (straight) → 0; V is the circle → 1/R.
    expect(Math.abs(normalCurvature(cyl, 0.5, 0.5, 1, 0))).toBeCloseTo(0, 3);
    expect(Math.abs(normalCurvature(cyl, 0.5, 0.5, 0, 1))).toBeCloseTo(1 / R, 3);
  });

  it('on a sphere: 1/R in every tangent direction', () => {
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
    for (const [a, b] of [[1, 0], [0, 1], [1, 1], [1, -1]] as Array<[number, number]>) {
      expect(Math.abs(normalCurvature(sphere, 0.5, 0.5, a, b))).toBeCloseTo(1 / R, 3);
    }
  });
});

describe('nurbsIsoCurvatureComb — analytic comb', () => {
  const R = 10, w = Math.SQRT1_2;
  const cyl: NurbsSurface = {
    controlPoints: [
      [V(0, R, 0), V(0, R, R), V(0, 0, R)],
      [V(20, R, 0), V(20, R, R), V(20, 0, R)],
    ],
    weights: [[1, w, 1], [1, w, 1]],
    degreeU: 1, degreeV: 2, knotsU: [0, 0, 1, 1], knotsV: [0, 0, 0, 1, 1, 1],
  };

  it('along the circular (v) isocurve: κ_n = 1/R, unit tangent ⟂ unit normal', () => {
    const comb = nurbsIsoCurvatureComb(cyl, 'u', 0.5, 12); // fixed u, sweep v = circle
    expect(comb).toHaveLength(12);
    for (const c of comb) {
      expect(Math.abs(c.curvature)).toBeCloseTo(1 / R, 3);
      expect(c.tangent.length()).toBeCloseTo(1, 6);
      expect(c.normal.length()).toBeCloseTo(1, 6);
      expect(Math.abs(c.tangent.dot(c.normal))).toBeLessThan(1e-6);
    }
  });

  it('along the straight (u) axis isocurve: κ_n = 0 (developable direction)', () => {
    const comb = nurbsIsoCurvatureComb(cyl, 'v', 0.5, 8); // fixed v, sweep u = axis
    for (const c of comb) expect(Math.abs(c.curvature)).toBeCloseTo(0, 3);
  });

  it('on a sphere every isocurve station reads κ_n = 1/R', () => {
    const sphere: NurbsSurface = {
      controlPoints: [
        [V(R, 0, 0), V(R, R, 0), V(0, R, 0)],
        [V(R, 0, R), V(R, R, R), V(0, R, R)],
        [V(0, 0, R), V(0, 0, R), V(0, 0, R)],
      ],
      weights: [[1, w, 1], [w, 0.5, w], [1, w, 1]],
      degreeU: 2, degreeV: 2, knotsU: [0, 0, 0, 1, 1, 1], knotsV: [0, 0, 0, 1, 1, 1],
    };
    for (const c of nurbsIsoCurvatureComb(sphere, 'u', 0.4, 6)) {
      expect(Math.abs(c.curvature)).toBeCloseTo(1 / R, 3);
    }
  });
});

describe('buildCurvatureCombGeometry — overlay geometry', () => {
  const R = 10, w = Math.SQRT1_2;
  const cyl: NurbsSurface = {
    controlPoints: [
      [V(0, R, 0), V(0, R, R), V(0, 0, R)],
      [V(20, R, 0), V(20, R, R), V(20, 0, R)],
    ],
    weights: [[1, w, 1], [1, w, 1]],
    degreeU: 1, degreeV: 2, knotsU: [0, 0, 1, 1], knotsV: [0, 0, 0, 1, 1, 1],
  };

  it('emits 2 verts/station of spikes + 1 vert/station of envelope, sized arrays', () => {
    const comb = nurbsIsoCurvatureComb(cyl, 'u', 0.5, 10);
    const g = buildCurvatureCombGeometry(comb, { scale: 50 });
    expect(g.spikes).toHaveLength(10 * 6);
    expect(g.envelope).toHaveLength(10 * 3);
    expect(g.spikeColors).toHaveLength(10 * 6);
    expect(g.maxCurvature).toBeCloseTo(1 / R, 3);
  });

  it('constant-curvature comb has equal spike lengths = |κ|·scale', () => {
    const comb = nurbsIsoCurvatureComb(cyl, 'u', 0.5, 8);
    const g = buildCurvatureCombGeometry(comb, { scale: 50 });
    const expected = (1 / R) * 50; // 5
    for (let i = 0; i < 8; i++) {
      const bx = g.spikes[i * 6]!, by = g.spikes[i * 6 + 1]!, bz = g.spikes[i * 6 + 2]!;
      const tx = g.spikes[i * 6 + 3]!, ty = g.spikes[i * 6 + 4]!, tz = g.spikes[i * 6 + 5]!;
      expect(Math.hypot(tx - bx, ty - by, tz - bz)).toBeCloseTo(expected, 3);
    }
  });

  it('auto-scale fits the longest spike to targetFraction of the curve diagonal', () => {
    const comb = nurbsIsoCurvatureComb(cyl, 'u', 0.5, 12);
    const g = buildCurvatureCombGeometry(comb, { targetFraction: 0.25 });
    // diagonal of the circular isocurve points.
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 12; i++) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, comb[i]!.position.getComponent(k));
        hi[k] = Math.max(hi[k]!, comb[i]!.position.getComponent(k));
      }
    }
    const diag = Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
    const longest = g.maxCurvature * g.scale;
    expect(longest).toBeCloseTo(diag * 0.25, 4);
  });

  it('the envelope passes through every spike tip', () => {
    const comb = nurbsIsoCurvatureComb(cyl, 'u', 0.5, 6);
    const g = buildCurvatureCombGeometry(comb, { scale: 30 });
    for (let i = 0; i < 6; i++) {
      expect(g.envelope[i * 3]).toBeCloseTo(g.spikes[i * 6 + 3]!, 9);
      expect(g.envelope[i * 3 + 1]).toBeCloseTo(g.spikes[i * 6 + 4]!, 9);
      expect(g.envelope[i * 3 + 2]).toBeCloseTo(g.spikes[i * 6 + 5]!, 9);
    }
  });
});

describe('buildCombScene — multi-isocurve overlay assembly', () => {
  const R = 10, w = Math.SQRT1_2;
  const cyl: NurbsSurface = {
    controlPoints: [
      [V(0, R, 0), V(0, R, R), V(0, 0, R)],
      [V(20, R, 0), V(20, R, R), V(20, 0, R)],
    ],
    weights: [[1, w, 1], [1, w, 1]],
    degreeU: 1, degreeV: 2, knotsU: [0, 0, 1, 1], knotsV: [0, 0, 0, 1, 1, 1],
  };

  it('concatenates P combs of N stations: spikes 6·N·P, envelope segments 6·(N-1)·P', () => {
    const N = 16, params = [0.2, 0.5, 0.8];
    const scene = buildCombScene(cyl, { isoParams: params, sampleCount: N, scale: 40 });
    expect(scene.spikePositions).toHaveLength(6 * N * params.length);
    expect(scene.spikeColors).toHaveLength(6 * N * params.length);
    expect(scene.envelopeSegments).toHaveLength(6 * (N - 1) * params.length);
    expect(scene.maxCurvature).toBeCloseTo(1 / R, 3);
  });

  it('defaults to three isocurves and 24 stations', () => {
    const scene = buildCombScene(cyl);
    expect(scene.spikePositions).toHaveLength(6 * 24 * 3);
    expect(scene.envelopeSegments).toHaveLength(6 * 23 * 3);
  });

  it('envelope segments are contiguous (each tip shared by adjacent pairs)', () => {
    const N = 6;
    const scene = buildCombScene(cyl, { isoParams: [0.5], sampleCount: N, scale: 30 });
    // segment i ends where segment i+1 starts.
    for (let i = 0; i + 1 < N - 1; i++) {
      const endA = i * 6 + 3, startB = (i + 1) * 6;
      expect(scene.envelopeSegments[endA]).toBeCloseTo(scene.envelopeSegments[startB]!, 9);
      expect(scene.envelopeSegments[endA + 1]).toBeCloseTo(scene.envelopeSegments[startB + 1]!, 9);
      expect(scene.envelopeSegments[endA + 2]).toBeCloseTo(scene.envelopeSegments[startB + 2]!, 9);
    }
  });
});
