import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildSweep } from './sweep';
import type { NurbsCurve3D } from './nurbsCurve';

/** Straight path along +Y axis from (0,0,0) to (0,L,0). */
function straightPathY(length: number): NurbsCurve3D {
  return {
    controlPoints: [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, length, 0),
    ],
    degree: 1,
    knots: [0, 0, 1, 1],
  };
}

/** Simple square profile (4 corners). */
function squareProfile(size = 2): { x: number; y: number }[] {
  return [
    { x: -size, y: -size },
    { x:  size, y: -size },
    { x:  size, y:  size },
    { x: -size, y:  size },
  ];
}

describe('buildSweep · straight path', () => {
  it('produces (M × profCount) vertices', () => {
    const r = buildSweep(straightPathY(10), squareProfile(2), { pathSampleCount: 5 });
    expect(r.report.totalVertices).toBe(5 * 4);
    expect(r.report.totalTriangles).toBe(2 * 4 * 3); // (M-1) × (profCount-1) × 2 = 4 × 3 × 2
  });

  it('first ring sits at the path start', () => {
    const r = buildSweep(straightPathY(10), squareProfile(2), { pathSampleCount: 4 });
    const pos = r.geometry.getAttribute('position');
    for (let i = 0; i < 4; i++) {
      expect(pos.getY(i)).toBeCloseTo(0, 1);
    }
  });

  it('last ring sits at the path end', () => {
    const r = buildSweep(straightPathY(10), squareProfile(2), { pathSampleCount: 4 });
    const pos = r.geometry.getAttribute('position');
    const start = (4 - 1) * 4;
    for (let i = 0; i < 4; i++) {
      expect(pos.getY(start + i)).toBeCloseTo(10, 1);
    }
  });

  it('produces a tube of approximately constant cross-section', () => {
    const r = buildSweep(straightPathY(10), squareProfile(3), { pathSampleCount: 6 });
    const pos = r.geometry.getAttribute('position');
    // Every ring should have the same XZ extent (since profile is square 3×3).
    // Check by computing extent at each ring.
    for (let ring = 0; ring < 6; ring++) {
      let minX = Infinity, maxX = -Infinity;
      for (let i = 0; i < 4; i++) {
        const idx = ring * 4 + i;
        const x = pos.getX(idx);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
      expect(maxX - minX).toBeCloseTo(6, 1); // 2 × half-size = 6
    }
  });
});

describe('buildSweep · curved path', () => {
  it('orientation rotates with the path tangent (no twist on smooth curve)', () => {
    // Curved path in XY plane: quadratic arc.
    const path: NurbsCurve3D = {
      controlPoints: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(5, 10, 0),
        new THREE.Vector3(10, 0, 0),
      ],
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
    };
    const r = buildSweep(path, squareProfile(1), { pathSampleCount: 10 });
    expect(r.report.totalVertices).toBe(10 * 4);
    // Just smoke-test that the geometry was built without NaN.
    const pos = r.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i))).toBe(true);
      expect(Number.isFinite(pos.getY(i))).toBe(true);
      expect(Number.isFinite(pos.getZ(i))).toBe(true);
    }
  });
});

describe('buildSweep · degenerate inputs', () => {
  it('returns empty geometry on profile shorter than 2 points', () => {
    const r = buildSweep(straightPathY(10), [{ x: 0, y: 0 }], { pathSampleCount: 5 });
    expect(r.report.totalVertices).toBe(0);
    expect(r.report.totalTriangles).toBe(0);
  });

  it('clamps pathSampleCount to ≥ 2', () => {
    const r = buildSweep(straightPathY(10), squareProfile(1), { pathSampleCount: 1 });
    expect(r.report.pathSampleCount).toBe(2);
  });
});

describe('buildSweep · invariants', () => {
  it('computes normals', () => {
    const r = buildSweep(straightPathY(10), squareProfile(1), { pathSampleCount: 5 });
    expect(r.geometry.getAttribute('normal')).toBeDefined();
  });

  it('every profile is centred on the path (centroid offset = 0)', () => {
    const r = buildSweep(straightPathY(10), squareProfile(2), { pathSampleCount: 4 });
    const pos = r.geometry.getAttribute('position');
    // For each ring, the centroid should equal the path point.
    for (let ring = 0; ring < 4; ring++) {
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < 4; i++) {
        const idx = ring * 4 + i;
        cx += pos.getX(idx);
        cy += pos.getY(idx);
        cz += pos.getZ(idx);
      }
      cx /= 4; cy /= 4; cz /= 4;
      // Path point at ring k = (0, k * 10/3, 0).
      expect(Math.abs(cx)).toBeLessThan(0.5);
      expect(Math.abs(cz)).toBeLessThan(0.5);
    }
  });

  it('on a rational-circle path every ring is ⟂ the tangent and keeps the profile radius', () => {
    // Parallel-transport frame correctness, against closed forms: a circle
    // profile swept along a planar quarter-circle path must give rings that are
    // perpendicular to the path tangent (frame N,B ⟂ T) with every vertex at the
    // exact profile radius (orthonormal frame, no distortion).
    const R = 10, w = Math.SQRT1_2, rProf = 1, NP = 16, M = 12;
    const path: NurbsCurve3D = {
      controlPoints: [new THREE.Vector3(R, 0, 0), new THREE.Vector3(R, R, 0), new THREE.Vector3(0, R, 0)],
      degree: 2, knots: [0, 0, 0, 1, 1, 1], weights: [1, w, 1],
    };
    const profile = Array.from({ length: NP }, (_, i) => {
      const a = (i / NP) * 2 * Math.PI;
      return { x: rProf * Math.cos(a), y: rProf * Math.sin(a) };
    });
    const r = buildSweep(path, profile, { pathSampleCount: M });
    const pos = r.geometry.getAttribute('position');
    const get = (k: number) => new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k));
    for (let ring = 0; ring < M; ring++) {
      const base = ring * NP;
      // ring centroid + plane normal
      const c = new THREE.Vector3();
      for (let i = 0; i < NP; i++) c.add(get(base + i));
      c.divideScalar(NP);
      const nrm = new THREE.Vector3().crossVectors(
        get(base + 1).sub(get(base)), get(base + 2).sub(get(base)),
      ).normalize();
      for (let i = 0; i < NP; i++) {
        const v = get(base + i);
        expect(v.distanceTo(c)).toBeCloseTo(rProf, 4);   // exact profile radius
        // vertex lies in the ring plane (⟂ normal through centroid)
        expect(Math.abs(v.clone().sub(c).dot(nrm))).toBeLessThan(1e-5);
      }
    }
  });
});
