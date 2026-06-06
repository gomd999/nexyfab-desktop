import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  evalNurbsCurve3D,
  evalNurbsCurve3DDerivative,
  sampleNurbsCurve3D,
  clampedUniformKnots3D,
  type NurbsCurve3D,
} from './nurbsCurve';

describe('clampedUniformKnots3D', () => {
  it('produces the standard clamped vector [0,0,0,1,1,1] for degree 2, 3 ctrl pts', () => {
    // n=2 (3 ctrl pts), p=2 → 3+2+2 = 7? No: n+p+2 = 6 knots.
    // Actually clamped uniform [0,0,0,1,1,1] is for p=2, n=2.
    const knots = clampedUniformKnots3D(2, 2);
    expect(knots).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('inserts evenly spaced interior knots for higher control point counts', () => {
    // n=4 (5 ctrl pts), p=2 → interior = 2 → [0,0,0, 1/3, 2/3, 1,1,1]
    const knots = clampedUniformKnots3D(4, 2);
    expect(knots).toEqual([0, 0, 0, 1 / 3, 2 / 3, 1, 1, 1]);
  });
});

describe('evalNurbsCurve3D', () => {
  it('endpoints are exactly the first and last control points (clamped)', () => {
    const curve: NurbsCurve3D = {
      controlPoints: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(5, 10, 0),
        new THREE.Vector3(10, 0, 0),
      ],
      degree: 2,
      knots: clampedUniformKnots3D(2, 2),
    };
    const p0 = evalNurbsCurve3D(curve, 0);
    const p1 = evalNurbsCurve3D(curve, 1);
    expect(p0.x).toBeCloseTo(0); expect(p0.y).toBeCloseTo(0);
    expect(p1.x).toBeCloseTo(10); expect(p1.y).toBeCloseTo(0);
  });

  it('linear B-spline (degree 1) interpolates between control points', () => {
    const curve: NurbsCurve3D = {
      controlPoints: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(10, 0, 0),
      ],
      degree: 1,
      knots: [0, 0, 1, 1],
    };
    const mid = evalNurbsCurve3D(curve, 0.5);
    expect(mid.x).toBeCloseTo(5);
  });

  it('quadratic Bezier (3 ctrl pts, no interior knots) hits the centre at u=0.5', () => {
    // Quadratic Bezier with control points (0,0), (5,10), (10,0)
    // B(0.5) = 0.25 · P0 + 0.5 · P1 + 0.25 · P2 = (5, 5, 0)
    const curve: NurbsCurve3D = {
      controlPoints: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(5, 10, 0),
        new THREE.Vector3(10, 0, 0),
      ],
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
    };
    const mid = evalNurbsCurve3D(curve, 0.5);
    expect(mid.x).toBeCloseTo(5);
    expect(mid.y).toBeCloseTo(5);
  });

  it('rational weights bias the curve toward weighted control points', () => {
    // Boost middle control point's weight → curve pulled toward it.
    const curve: NurbsCurve3D = {
      controlPoints: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(5, 10, 0),
        new THREE.Vector3(10, 0, 0),
      ],
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
      weights: [1, 10, 1], // heavy middle
    };
    const mid = evalNurbsCurve3D(curve, 0.5);
    // With weight=10 the curve pulls Y higher than the 5 the uniform
    // case gave us; should be closer to the control point Y=10.
    expect(mid.y).toBeGreaterThan(7);
  });

  it('rational weight of 0 anywhere returns origin (degenerate)', () => {
    const curve: NurbsCurve3D = {
      controlPoints: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(5, 0, 0),
      ],
      degree: 1,
      knots: [0, 0, 1, 1],
      weights: [0, 0],
    };
    const p = evalNurbsCurve3D(curve, 0.5);
    expect(p.length()).toBe(0);
  });

  it('handles 3-D control points (Z varies along parameter)', () => {
    const curve: NurbsCurve3D = {
      controlPoints: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 10),
      ],
      degree: 1,
      knots: [0, 0, 1, 1],
    };
    expect(evalNurbsCurve3D(curve, 0.25).z).toBeCloseTo(2.5);
    expect(evalNurbsCurve3D(curve, 0.75).z).toBeCloseTo(7.5);
  });
});

describe('evalNurbsCurve3DDerivative', () => {
  it('linear curve has constant tangent = endpoint difference', () => {
    const curve: NurbsCurve3D = {
      controlPoints: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(10, 0, 0),
      ],
      degree: 1,
      knots: [0, 0, 1, 1],
    };
    const d = evalNurbsCurve3DDerivative(curve, 0.5);
    // Tangent in +X direction.
    expect(d.x).toBeGreaterThan(0);
    expect(Math.abs(d.y)).toBeLessThan(0.1);
    expect(Math.abs(d.z)).toBeLessThan(0.1);
  });

  it('Bezier curve tangent at u=0 points toward the second control point', () => {
    const curve: NurbsCurve3D = {
      controlPoints: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(5, 10, 0),
        new THREE.Vector3(10, 0, 0),
      ],
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
    };
    const d = evalNurbsCurve3DDerivative(curve, 0).normalize();
    const expected = new THREE.Vector3(5, 10, 0).normalize();
    expect(d.dot(expected)).toBeGreaterThan(0.99);
  });

  it('rational quarter circle: every point on the circle, tangent ⟂ radius', () => {
    // Standard exact rational circle arc: 3 CPs, weights [1, √2/2, 1], degree 2.
    const R = 10, w = Math.SQRT1_2;
    const curve: NurbsCurve3D = {
      controlPoints: [
        new THREE.Vector3(R, 0, 0), new THREE.Vector3(R, R, 0), new THREE.Vector3(0, R, 0),
      ],
      degree: 2, knots: [0, 0, 0, 1, 1, 1], weights: [1, w, 1],
    };
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const p = evalNurbsCurve3D(curve, u);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(R, 3);           // exactly on the circle
      const d = evalNurbsCurve3DDerivative(curve, u);
      const radial = new THREE.Vector3(p.x, p.y, 0).normalize();
      const tangent = d.clone().normalize();
      expect(Math.abs(radial.dot(tangent))).toBeLessThan(5e-3); // tangent ⟂ radius
    }
  });
});

describe('sampleNurbsCurve3D', () => {
  it('produces N points along the parameter range', () => {
    const curve: NurbsCurve3D = {
      controlPoints: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(10, 0, 0),
      ],
      degree: 1,
      knots: [0, 0, 1, 1],
    };
    const pts = sampleNurbsCurve3D(curve, 11);
    expect(pts).toHaveLength(11);
    expect(pts[0].x).toBeCloseTo(0);
    expect(pts[10].x).toBeCloseTo(10);
    // Linear curve → monotonic increase.
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].x).toBeGreaterThanOrEqual(pts[i - 1].x - 1e-6);
    }
  });

  it('handles sampleCount=1 (returns the start point)', () => {
    const curve: NurbsCurve3D = {
      controlPoints: [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(10, 0, 0),
      ],
      degree: 1,
      knots: [0, 0, 1, 1],
    };
    const pts = sampleNurbsCurve3D(curve, 1);
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBeCloseTo(0);
  });
});
