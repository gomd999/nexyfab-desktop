import { describe, it, expect } from 'vitest';
import {
  evaluate,
  summarize,
  type Triangle,
  type Point3D,
} from './profileOfSurfaceTolerance';

// Nominal surface = the z=0 plane, covered by two triangles over [0,10]².
const planeMesh: Triangle[] = [
  { a: { x: 0, y: 0, z: 0 }, b: { x: 10, y: 0, z: 0 }, c: { x: 10, y: 10, z: 0 } },
  { a: { x: 0, y: 0, z: 0 }, b: { x: 10, y: 10, z: 0 }, c: { x: 0, y: 10, z: 0 } },
];

describe('evaluate', () => {
  it('points on the plane → near-zero deviation', () => {
    const pts: Point3D[] = [{ x: 5, y: 5, z: 0 }, { x: 2, y: 8, z: 0 }];
    const r = evaluate({ nominalMesh: planeMesh, measured: pts, toleranceMm: 0.1, zoneType: 'bilateral' });
    expect(r.maxAbsoluteDeviationMm).toBeCloseTo(0, 5);
    expect(r.passed).toBe(true);
  });

  it('point above plane → positive deviation = height', () => {
    const r = evaluate({ nominalMesh: planeMesh, measured: [{ x: 5, y: 5, z: 0.05 }], toleranceMm: 0.2, zoneType: 'bilateral' });
    expect(Math.abs(r.entries[0]!.signedDeviationMm)).toBeCloseTo(0.05, 5);
  });

  it('exceeds bilateral tolerance → fail', () => {
    const r = evaluate({ nominalMesh: planeMesh, measured: [{ x: 5, y: 5, z: 0.3 }], toleranceMm: 0.2, zoneType: 'bilateral' });
    expect(r.passed).toBe(false);
  });

  it('unilateral-outside accepts +, rejects −', () => {
    const above = evaluate({ nominalMesh: planeMesh, measured: [{ x: 5, y: 5, z: 0.1 }], toleranceMm: 0.2, zoneType: 'unilateral-outside' });
    const below = evaluate({ nominalMesh: planeMesh, measured: [{ x: 5, y: 5, z: -0.1 }], toleranceMm: 0.2, zoneType: 'unilateral-outside' });
    expect(above.passed).toBe(true);
    expect(below.passed).toBe(false);
  });

  it('closest point projects onto the surface', () => {
    const r = evaluate({ nominalMesh: planeMesh, measured: [{ x: 5, y: 5, z: 2 }], toleranceMm: 10, zoneType: 'bilateral' });
    expect(r.entries[0]!.closest.z).toBeCloseTo(0, 5);
    expect(r.entries[0]!.closest.x).toBeCloseTo(5, 5);
  });

  it('rms deviation computed', () => {
    const pts: Point3D[] = [{ x: 5, y: 5, z: 0.1 }, { x: 2, y: 2, z: -0.1 }];
    const r = evaluate({ nominalMesh: planeMesh, measured: pts, toleranceMm: 1, zoneType: 'bilateral' });
    expect(r.rmsDeviationMm).toBeCloseTo(0.1, 5);
  });

  it('worst index points to largest deviation', () => {
    const pts: Point3D[] = [{ x: 5, y: 5, z: 0.01 }, { x: 2, y: 2, z: 0.5 }];
    const r = evaluate({ nominalMesh: planeMesh, measured: pts, toleranceMm: 1, zoneType: 'bilateral' });
    expect(r.worstIndex).toBe(1);
  });

  it('empty mesh → warning', () => {
    const r = evaluate({ nominalMesh: [], measured: [{ x: 0, y: 0, z: 0 }], toleranceMm: 0.1, zoneType: 'bilateral' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('point beyond triangle edge clamps to edge', () => {
    // x=20 is outside the [0,10] mesh; closest should be on the x=10 edge.
    const r = evaluate({ nominalMesh: planeMesh, measured: [{ x: 20, y: 5, z: 0 }], toleranceMm: 100, zoneType: 'bilateral' });
    expect(r.entries[0]!.closest.x).toBeCloseTo(10, 5);
  });
});

describe('summarize', () => {
  it('reports pass + max + count', () => {
    const r = evaluate({ nominalMesh: planeMesh, measured: [{ x: 5, y: 5, z: 0.05 }], toleranceMm: 0.2, zoneType: 'bilateral' });
    const s = summarize(r);
    expect(s.passed).toBe(r.passed);
    expect(s.pointCount).toBe(1);
  });
});
