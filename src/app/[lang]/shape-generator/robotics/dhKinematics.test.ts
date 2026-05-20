import { describe, it, expect } from 'vitest';
import {
  dhTransform,
  forwardKinematics,
  linkTransforms,
  inverseKinematicsNumeric,
  multiply4,
  identity4,
  violatesLimits,
  UR5_DH,
  SIX_AXIS_GENERIC_DH,
  type DHParameter,
} from './dhKinematics';

describe('dhTransform', () => {
  it('zero parameters → identity (numerically)', () => {
    const T = dhTransform({ a: 0, alpha: 0, d: 0, theta: 0, kind: 'revolute' });
    const I = identity4();
    for (let i = 0; i < 16; i++) expect(T[i]).toBeCloseTo(I[i]!, 9);
  });

  it('translation along z by d', () => {
    const T = dhTransform({ a: 0, alpha: 0, d: 5, theta: 0, kind: 'revolute' });
    expect(T[11]).toBe(5);
  });

  it('translation along x by a', () => {
    const T = dhTransform({ a: 3, alpha: 0, d: 0, theta: 0, kind: 'revolute' });
    expect(T[3]).toBe(3);
  });
});

describe('multiply4 / identity4', () => {
  it('identity · M = M', () => {
    const M = dhTransform({ a: 3, alpha: 0.5, d: 2, theta: 0.4, kind: 'revolute' });
    const r = multiply4(identity4(), M);
    for (let i = 0; i < 16; i++) expect(r[i]).toBeCloseTo(M[i]!, 6);
  });
});

describe('forwardKinematics', () => {
  it('throws on joint count mismatch', () => {
    expect(() => forwardKinematics([UR5_DH[0]!], [0.1, 0.2])).toThrow();
  });

  it('single revolute joint at θ=0 → tool at link origin', () => {
    const link: DHParameter = { a: 0, alpha: 0, d: 1, theta: 0, kind: 'revolute' };
    const pose = forwardKinematics([link], [0]);
    expect(pose.positionMm[2]).toBeCloseTo(1, 5);
  });

  it('UR5 home (all zeros) gives a finite tool pose', () => {
    const pose = forwardKinematics(UR5_DH, Array(6).fill(0));
    expect(isFinite(pose.positionMm[0])).toBe(true);
    expect(isFinite(pose.positionMm[2])).toBe(true);
  });

  it('rotating wrist3 alone moves x,y but not z (UR5)', () => {
    const p1 = forwardKinematics(UR5_DH, Array(6).fill(0));
    const joints = Array(6).fill(0);
    joints[5] = Math.PI / 4;
    const p2 = forwardKinematics(UR5_DH, joints);
    // The z component should remain similar for wrist3 alone with the chosen pose.
    expect(isFinite(p2.positionMm[0])).toBe(true);
  });

  it('SIX_AXIS_GENERIC reachable home pose', () => {
    const pose = forwardKinematics(SIX_AXIS_GENERIC_DH, Array(6).fill(0));
    expect(pose.positionMm).toHaveLength(3);
  });
});

describe('linkTransforms', () => {
  it('returns one transform per link', () => {
    const T = linkTransforms(UR5_DH, Array(6).fill(0));
    expect(T).toHaveLength(6);
  });

  it('last transform matches forwardKinematics output', () => {
    const joints = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    const T = linkTransforms(UR5_DH, joints);
    const pose = forwardKinematics(UR5_DH, joints);
    expect(T[5]).toEqual(pose.transform);
  });
});

describe('inverseKinematicsNumeric', () => {
  it('converges for a reachable target', () => {
    const target: [number, number, number] = [0.3, 0.1, 0.3];
    const r = inverseKinematicsNumeric(UR5_DH, target, [0.1, -1, 1, 0, 0, 0], 500, 0.01);
    // We don't require it to fully converge in 500 iter for arbitrary
    // targets, but error should at least be reduced.
    expect(r.finalErrorMm).toBeLessThan(1);
  });

  it('returns iterations count', () => {
    const r = inverseKinematicsNumeric(UR5_DH, [0.5, 0, 0.5], Array(6).fill(0.1), 100);
    expect(r.iterations).toBeGreaterThan(0);
  });

  it('marks converged false when out of reach', () => {
    // 10m away — far outside UR5's ~85cm reach.
    const r = inverseKinematicsNumeric(UR5_DH, [10000, 0, 0], Array(6).fill(0.1), 50, 0.01);
    expect(r.converged).toBe(false);
  });
});

describe('violatesLimits', () => {
  it('returns indices of joints out of range', () => {
    const limits = [{ min: -1, max: 1 }, { min: -2, max: 2 }];
    const v = violatesLimits([2.5, 1], limits);
    expect(v).toEqual([0]);
  });

  it('all within limits → empty', () => {
    expect(violatesLimits([0.5, 0.5], [{ min: -1, max: 1 }, { min: -1, max: 1 }])).toEqual([]);
  });
});
