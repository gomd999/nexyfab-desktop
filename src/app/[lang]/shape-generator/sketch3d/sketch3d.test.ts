import { describe, it, expect } from 'vitest';
import {
  createSketch3D, addEntity, removeEntity, listEntities, entityCounts, getPoint, freeDofs,
  type Point3D, type Line3D,
} from './sketch3dEntity';
import { solveSketch3D, type Sketch3DConstraint } from './sketch3dConstraints';
import { projectSketch, xyPlane, xzPlane, projectPoint } from './planeIntersection';
import { sampleHelix, helixLength, planarSpiral, taperedHelix } from './helix';

// ── Entity model ────────────────────────────────────────────────────

describe('Sketch3D entities', () => {
  it('adds points + counts', () => {
    const s = createSketch3D('s1');
    addEntity(s, { id: 'p1', x: 0, y: 0, z: 0 });
    addEntity(s, { id: 'p2', x: 1, y: 0, z: 0 });
    expect(entityCounts(s)).toEqual({ points: 2, lines: 0, arcs: 0, splines: 0 });
  });

  it('rejects duplicate ids', () => {
    const s = createSketch3D('s1');
    addEntity(s, { id: 'p1', x: 0, y: 0, z: 0 });
    expect(() => addEntity(s, { id: 'p1', x: 1, y: 1, z: 1 })).toThrow();
  });

  it('removes entities', () => {
    const s = createSketch3D('s1');
    addEntity(s, { id: 'p1', x: 0, y: 0, z: 0 });
    expect(removeEntity(s, 'p1')).toBe(true);
    expect(removeEntity(s, 'phantom')).toBe(false);
  });

  it('freeDofs counts movable points only', () => {
    const s = createSketch3D('s1');
    addEntity(s, { id: 'p1', x: 0, y: 0, z: 0 });
    addEntity(s, { id: 'p2', x: 1, y: 0, z: 0, fixed: true });
    expect(freeDofs(s)).toBe(3);
  });

  it('getPoint returns null for non-point ids', () => {
    const s = createSketch3D('s1');
    addEntity(s, { id: 'p1', x: 0, y: 0, z: 0 });
    addEntity(s, { id: 'L1', startId: 'p1', endId: 'p1' } as Line3D);
    expect(getPoint(s, 'L1')).toBeNull();
  });
});

// ── 3D constraint solver ───────────────────────────────────────────

describe('3D constraint solver', () => {
  it('distance constraint pulls points together', () => {
    const s = createSketch3D('s1');
    addEntity(s, { id: 'a', x: 0, y: 0, z: 0, fixed: true } as Point3D);
    addEntity(s, { id: 'b', x: 10, y: 0, z: 0 } as Point3D);
    const cs: Sketch3DConstraint[] = [
      { kind: 'distance', pointA: 'a', pointB: 'b', targetMm: 5 },
    ];
    const result = solveSketch3D(s, cs, { tol: 0.01, maxIters: 500, step: 0.1 });
    const final = getPoint(s, 'b')!;
    const dist = Math.hypot(final.x, final.y, final.z);
    expect(dist).toBeCloseTo(5, 0); // within ±1mm
    expect(result.finalError).toBeLessThan(0.5);
  });

  it('coincident constraint merges two points', () => {
    const s = createSketch3D('s1');
    addEntity(s, { id: 'a', x: 0, y: 0, z: 0, fixed: true } as Point3D);
    addEntity(s, { id: 'b', x: 5, y: 5, z: 5 } as Point3D);
    solveSketch3D(s, [{ kind: 'coincident', pointA: 'a', pointB: 'b' }],
      { tol: 0.01, maxIters: 500, step: 0.1 });
    const final = getPoint(s, 'b')!;
    expect(Math.hypot(final.x, final.y, final.z)).toBeLessThan(0.5);
  });

  it('fixed-coord locks a single axis', () => {
    const s = createSketch3D('s1');
    addEntity(s, { id: 'p', x: 5, y: 5, z: 5 } as Point3D);
    solveSketch3D(s, [{ kind: 'fixed-coord', point: 'p', axis: 'z', value: 0 }],
      { tol: 0.001, maxIters: 200, step: 0.1 });
    const final = getPoint(s, 'p')!;
    expect(final.z).toBeCloseTo(0, 1);
  });

  it('on-axis constraint pulls point onto axis', () => {
    const s = createSketch3D('s1');
    addEntity(s, { id: 'p', x: 5, y: 5, z: 5 } as Point3D);
    solveSketch3D(s, [{ kind: 'on-axis', point: 'p', axis: 'x' }],
      { tol: 0.01, maxIters: 500, step: 0.1 });
    const final = getPoint(s, 'p')!;
    expect(Math.hypot(final.y, final.z)).toBeLessThan(0.5);
  });
});

// ── Plane intersection ────────────────────────────────────────────

describe('Plane intersection', () => {
  it('XY plane projects points correctly', () => {
    const plane = xyPlane();
    const r = projectPoint(plane, [3, 4, 10]);
    expect(r.uv).toEqual([3, 4]);
    expect(r.depth).toBe(10);
  });

  it('XZ plane swaps Y and Z roles', () => {
    const plane = xzPlane();
    const r = projectPoint(plane, [3, 4, 10]);
    expect(r.uv).toEqual([3, 10]);
  });

  it('projectSketch handles lines', () => {
    const s = createSketch3D('s1');
    addEntity(s, { id: 'p1', x: 0, y: 0, z: 0 } as Point3D);
    addEntity(s, { id: 'p2', x: 10, y: 5, z: 0 } as Point3D);
    addEntity(s, { id: 'L1', startId: 'p1', endId: 'p2' } as Line3D);
    const r = projectSketch(s, xyPlane());
    expect(r).toHaveLength(1);
    expect(r[0]!.end).toEqual([10, 5]);
  });
});

// ── Helix ──────────────────────────────────────────────────────────

describe('Helix', () => {
  it('cylinder helix: x²+y² = r² along the path', () => {
    const samples = sampleHelix({
      pitchMm: 5, radiusStartMm: 10, turns: 2,
    });
    for (const s of samples) {
      expect(Math.hypot(s.x, s.y)).toBeCloseTo(10, 5);
    }
  });

  it('helix height = pitch × turns', () => {
    const samples = sampleHelix({ pitchMm: 5, radiusStartMm: 10, turns: 3 });
    const heights = samples.map(s => s.z);
    expect(Math.max(...heights) - Math.min(...heights)).toBeCloseTo(15, 5);
  });

  it('tapered helix shrinks radius', () => {
    const samples = taperedHelix({
      pitchMm: 5, topRadiusMm: 5, bottomRadiusMm: 10, turns: 2,
    });
    const startR = Math.hypot(samples[0]!.x, samples[0]!.y);
    const endR = Math.hypot(samples[samples.length - 1]!.x, samples[samples.length - 1]!.y);
    expect(startR).toBeCloseTo(10, 0);
    expect(endR).toBeCloseTo(5, 0);
  });

  it('helixLength matches expected for spring', () => {
    const samples = sampleHelix({ pitchMm: 0, radiusStartMm: 10, turns: 1, samplesPerTurn: 64 });
    // Pitch=0 → 1 turn = circumference = 2πr.
    expect(helixLength(samples)).toBeCloseTo(2 * Math.PI * 10, 1);
  });

  it('planarSpiral has zero pitch', () => {
    const samples = planarSpiral({ radiusStartMm: 1, radiusEndMm: 10, turns: 2 });
    const zRange = Math.max(...samples.map(s => s.z)) - Math.min(...samples.map(s => s.z));
    expect(zRange).toBe(0);
  });

  it('cw direction reverses rotation', () => {
    const ccw = sampleHelix({ pitchMm: 5, radiusStartMm: 10, turns: 1, direction: 'ccw' });
    const cw = sampleHelix({ pitchMm: 5, radiusStartMm: 10, turns: 1, direction: 'cw' });
    // After 1/4 turn ccw → +y; cw → -y.
    const qIdx = Math.floor(ccw.length / 4);
    expect(ccw[qIdx]!.y * cw[qIdx]!.y).toBeLessThan(0);
  });
});
