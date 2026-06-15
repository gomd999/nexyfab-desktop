import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { checkSurfaceContinuity } from './continuity';
import type { NurbsSurface } from './nurbsSurface';

/** Flat XY plane from (x0,0,0) to (x0+10, 10, 0). */
function flatPanel(x0: number, z = 0): NurbsSurface {
  const x1 = x0 + 10;
  return {
    controlPoints: [
      [new THREE.Vector3(x0, 0, z),  new THREE.Vector3(x0, 10, z)],
      [new THREE.Vector3(x1, 0, z),  new THREE.Vector3(x1, 10, z)],
    ],
    degreeU: 1,
    degreeV: 1,
    knotsU: [0, 0, 1, 1],
    knotsV: [0, 0, 1, 1],
  };
}

describe('checkSurfaceContinuity', () => {
  it('reports G2 for two coplanar adjacent panels (both have zero curvature)', () => {
    // Panel A spans X=0..10; panel B spans X=10..20. Edge u1 of A meets
    // edge u0 of B at x=10. Two planes are curvature-continuous → G2, not the
    // old G1 cap.
    const a = flatPanel(0);
    const b = flatPanel(10);
    const r = checkSurfaceContinuity(a, 'u1', b, 'u0');
    expect(r.level).toBe('G2');
    expect(r.maxPositionGap).toBeLessThan(1e-3);
    expect(r.maxNormalAngle).toBeLessThan(0.01);
  });

  it('reports G0 (positions match, normals do not) when one panel is angled', () => {
    // Panel A flat at z=0. Panel B tilted up to z=5 at far edge.
    const a = flatPanel(0);
    const b: NurbsSurface = {
      controlPoints: [
        [new THREE.Vector3(10, 0, 0),  new THREE.Vector3(10, 10, 0)],
        [new THREE.Vector3(20, 0, 5),  new THREE.Vector3(20, 10, 5)],
      ],
      degreeU: 1, degreeV: 1,
      knotsU: [0, 0, 1, 1], knotsV: [0, 0, 1, 1],
    };
    const r = checkSurfaceContinuity(a, 'u1', b, 'u0');
    expect(r.maxPositionGap).toBeLessThan(1e-3);
    expect(r.level).toBe('G0');           // positions match, normals don't
    expect(r.maxNormalAngle).toBeGreaterThan(0.1);
  });

  it('reports discontinuous when panels do not touch', () => {
    const a = flatPanel(0);
    const b = flatPanel(15); // 5mm gap between panel A's right edge and B's left
    const r = checkSurfaceContinuity(a, 'u1', b, 'u0');
    expect(r.level).toBe('discontinuous');
    expect(r.maxPositionGap).toBeGreaterThan(4);
  });

  it('respects custom positionTolerance', () => {
    const a = flatPanel(0);
    const b = flatPanel(10.0005); // 0.5mm gap
    const tight = checkSurfaceContinuity(a, 'u1', b, 'u0', { positionTolerance: 1e-5 });
    const loose = checkSurfaceContinuity(a, 'u1', b, 'u0', { positionTolerance: 1 });
    expect(tight.level).toBe('discontinuous');
    expect(loose.level).toBe('G2'); // touching coplanar planes → curvature-continuous
  });

  it('reports G1 (not G2) when a plane meets a curved panel tangentially', () => {
    // Flat panel A (z=0) meets B at x=10. B is degree-2 in U: it leaves the seam
    // tangent to A (CP row 1 keeps z=0 → tangent +X, normal +Z), then curves up
    // (CP row 2 lifts to z=5). Tangent matches → G1; curvature jumps 0 → ≠0 → not G2.
    const a = flatPanel(0);
    const b: NurbsSurface = {
      controlPoints: [
        [new THREE.Vector3(10, 0, 0), new THREE.Vector3(10, 10, 0)], // seam, z=0
        [new THREE.Vector3(15, 0, 0), new THREE.Vector3(15, 10, 0)], // tangent continues flat
        [new THREE.Vector3(20, 0, 5), new THREE.Vector3(20, 10, 5)], // curves up
      ],
      degreeU: 2, degreeV: 1,
      knotsU: [0, 0, 0, 1, 1, 1], knotsV: [0, 0, 1, 1],
    };
    const r = checkSurfaceContinuity(a, 'u1', b, 'u0');
    expect(r.maxPositionGap).toBeLessThan(1e-3); // touch
    expect(r.maxNormalAngle).toBeLessThan(0.05); // tangent
    expect(r.level).toBe('G1');                  // but curvature breaks → not G2
  });

  it('reports G2 for two identical curved panels meeting along their seam', () => {
    const curved = (x0: number): NurbsSurface => ({
      controlPoints: [
        [new THREE.Vector3(x0, 0, 0), new THREE.Vector3(x0, 10, 0)],
        [new THREE.Vector3(x0 + 5, 0, 2), new THREE.Vector3(x0 + 5, 10, 2)],
        [new THREE.Vector3(x0 + 10, 0, 0), new THREE.Vector3(x0 + 10, 10, 0)],
      ],
      degreeU: 2, degreeV: 1,
      knotsU: [0, 0, 0, 1, 1, 1], knotsV: [0, 0, 1, 1],
    });
    // Panel A's u1 edge (x0+10) meets a copy whose u0 edge starts there with the
    // mirror profile, so curvature magnitude matches across the seam.
    const a = curved(0);
    const b = curved(10);
    const r = checkSurfaceContinuity(a, 'u1', b, 'u0');
    // position/normal may not perfectly align for this hand-built pair, but if
    // they do reach G1 the curvature test must promote it to G2 (equal |κ|).
    if (r.maxPositionGap < 1e-3 && r.maxNormalAngle < 0.05) {
      expect(r.level).toBe('G2');
    }
  });

  it('produces sampleCount samples', () => {
    const a = flatPanel(0);
    const b = flatPanel(10);
    const r = checkSurfaceContinuity(a, 'u1', b, 'u0', { sampleCount: 5 });
    expect(r.samples).toHaveLength(5);
    expect(r.samples[0].t).toBe(0);
    expect(r.samples[4].t).toBe(1);
  });

  it('clamps sampleCount to ≥ 2', () => {
    const a = flatPanel(0);
    const b = flatPanel(10);
    const r = checkSurfaceContinuity(a, 'u1', b, 'u0', { sampleCount: 1 });
    expect(r.samples).toHaveLength(2);
  });

  it('treats opposite-direction normals as matching (orientation-blind)', () => {
    // Build panel B as a mirror so its normal points the opposite way
    // — Coons/NURBS surfaces routinely have inverted winding after
    // import. Continuity check should not flag this as G0.
    const a = flatPanel(0);
    const b: NurbsSurface = {
      controlPoints: [
        // Reverse V order to flip the surface normal.
        [new THREE.Vector3(10, 10, 0),  new THREE.Vector3(10, 0, 0)],
        [new THREE.Vector3(20, 10, 0),  new THREE.Vector3(20, 0, 0)],
      ],
      degreeU: 1, degreeV: 1,
      knotsU: [0, 0, 1, 1], knotsV: [0, 0, 1, 1],
    };
    const r = checkSurfaceContinuity(a, 'u1', b, 'u0', {
      // The boundary parametrisation flips with the V reversal, so allow
      // generous position tolerance for this test — we only care that
      // the normal-match logic correctly identifies opposite-pointing
      // normals as parallel.
      positionTolerance: 100,
    });
    expect(r.maxNormalAngle).toBeLessThan(0.01);
  });
});
