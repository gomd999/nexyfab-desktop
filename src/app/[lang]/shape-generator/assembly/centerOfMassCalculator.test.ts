import { describe, it, expect } from 'vitest';
import {
  computeMassProperties,
  principalMoments,
  summarize,
  IDENTITY3,
  type RigidBody,
} from './centerOfMassCalculator';

function body(id: string, mass: number, x: number, y: number, z: number): RigidBody {
  return {
    id,
    massKg: mass,
    localCentroid: { x: 0, y: 0, z: 0 },
    globalPosition: { x, y, z },
  };
}

describe('computeMassProperties', () => {
  it('empty bodies → zero', () => {
    const p = computeMassProperties([]);
    expect(p.totalMassKg).toBe(0);
    expect(p.centroid).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('single body → centroid at its position', () => {
    const p = computeMassProperties([body('a', 5, 3, 4, 5)]);
    expect(p.totalMassKg).toBe(5);
    expect(p.centroid).toEqual({ x: 3, y: 4, z: 5 });
  });

  it('two equal masses → centroid at midpoint', () => {
    const p = computeMassProperties([body('a', 5, 0, 0, 0), body('b', 5, 10, 0, 0)]);
    expect(p.centroid.x).toBeCloseTo(5, 5);
    expect(p.centroid.y).toBe(0);
    expect(p.centroid.z).toBe(0);
  });

  it('weighted centroid by mass', () => {
    const p = computeMassProperties([body('a', 10, 0, 0, 0), body('b', 1, 11, 0, 0)]);
    // X̄ = (10*0 + 1*11) / 11 = 1
    expect(p.centroid.x).toBeCloseTo(1, 5);
  });

  it('local centroid offset applied', () => {
    const b: RigidBody = {
      id: 'a', massKg: 1,
      localCentroid: { x: 5, y: 0, z: 0 },
      globalPosition: { x: 10, y: 0, z: 0 },
    };
    const p = computeMassProperties([b]);
    expect(p.centroid.x).toBeCloseTo(15, 5);
  });

  it('rotation matrix transforms local centroid', () => {
    const b: RigidBody = {
      id: 'a', massKg: 1,
      localCentroid: { x: 1, y: 0, z: 0 },
      globalPosition: { x: 0, y: 0, z: 0 },
      // 90° about z: x → y
      globalOrientation: [0, -1, 0, 1, 0, 0, 0, 0, 1],
    };
    const p = computeMassProperties([b]);
    expect(p.centroid.x).toBeCloseTo(0, 5);
    expect(p.centroid.y).toBeCloseTo(1, 5);
  });

  it('quaternion produces same result as matrix', () => {
    const matB: RigidBody = { id: 'a', massKg: 1, localCentroid: { x: 1, y: 0, z: 0 }, globalPosition: { x: 0, y: 0, z: 0 }, globalOrientation: IDENTITY3 };
    const quatB: RigidBody = { id: 'b', massKg: 1, localCentroid: { x: 1, y: 0, z: 0 }, globalPosition: { x: 0, y: 0, z: 0 }, globalQuaternion: { x: 0, y: 0, z: 0, w: 1 } };
    const pm = computeMassProperties([matB]);
    const pq = computeMassProperties([quatB]);
    expect(pm.centroid.x).toBeCloseTo(pq.centroid.x, 5);
  });

  it('inertia parallel-axis offset added per body', () => {
    const b: RigidBody = {
      id: 'a', massKg: 1,
      localCentroid: { x: 0, y: 0, z: 0 },
      localInertia: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      globalPosition: { x: 10, y: 0, z: 0 },
    };
    const p = computeMassProperties([b]);
    // Assembly centroid = (10, 0, 0). Body centroid same as assembly centroid → no offset.
    expect(p.inertiaAboutCentroid[0]).toBeCloseTo(1, 5);
    expect(p.inertiaAboutCentroid[4]).toBeCloseTo(1, 5);
  });

  it('per-body global centroid recorded', () => {
    const p = computeMassProperties([body('a', 1, 5, 5, 5)]);
    expect(p.perBodyCentroid['a']!.x).toBe(5);
  });
});

describe('principalMoments', () => {
  it('extracts diagonal values', () => {
    const pm = principalMoments([5, 0, 0, 0, 3, 0, 0, 0, 8]);
    expect(pm.principalMoments).toEqual([8, 5, 3]);
  });
});

describe('summarize', () => {
  it('reports total mass + centroid', () => {
    const bodies = [body('a', 5, 0, 0, 0), body('b', 5, 10, 0, 0)];
    const p = computeMassProperties(bodies);
    const s = summarize(bodies, p);
    expect(s.bodyCount).toBe(2);
    expect(s.totalMassKg).toBe(10);
    expect(s.centroid.x).toBeCloseTo(5, 5);
  });
});
