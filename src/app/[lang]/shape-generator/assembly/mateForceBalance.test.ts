import { describe, it, expect } from 'vitest';
import {
  balanceForces,
  sizeJoint,
  summarize,
  type MateConnection,
  type ExternalLoad,
} from './mateForceBalance';

const fullDof = { fx: true, fy: true, fz: true, mx: true, my: true, mz: true };

function mate(id: string, a: string, b: string): MateConnection {
  return {
    id, bodyA: a, bodyB: b,
    point: { x: 0, y: 0, z: 0 },
    constraints: fullDof,
  };
}

function load(bodyId: string, fx: number, fy: number, fz: number): ExternalLoad {
  return {
    bodyId,
    point: { x: 0, y: 0, z: 0 },
    force: { x: fx, y: fy, z: fz },
  };
}

describe('balanceForces', () => {
  it('no bodies → empty result', () => {
    const r = balanceForces([], [], []);
    expect(r.reactions).toEqual([]);
  });

  it('single mate transfers load', () => {
    const r = balanceForces(['A', 'B'], [mate('m1', 'A', 'B')], [load('A', 0, 0, 100)]);
    expect(r.reactions).toHaveLength(1);
    expect(r.reactions[0]!.forceOnB.z).toBeCloseTo(100, 5);
  });

  it('two-body chain: load applied to A distributes to B via mate', () => {
    const r = balanceForces(['A', 'B'], [mate('m1', 'A', 'B')], [load('A', 50, 0, 0)]);
    expect(r.reactions[0]!.forceOnB.x).toBeCloseTo(50, 5);
  });

  it('sign correct when load is on bodyB', () => {
    const r = balanceForces(['A', 'B'], [mate('m1', 'A', 'B')], [load('B', 100, 0, 0)]);
    expect(r.reactions[0]!.forceOnB.x).toBeCloseTo(-100, 5);
  });

  it('three-body chain: load propagates A→B→C', () => {
    const mates = [mate('m1', 'A', 'B'), mate('m2', 'B', 'C')];
    const r = balanceForces(['A', 'B', 'C'], mates, [load('A', 0, 0, 100)]);
    expect(r.reactions).toHaveLength(2);
    const m2 = r.reactions.find(x => x.mateId === 'm2')!;
    expect(m2.forceOnB.z).toBeCloseTo(100, 5);
  });

  it('moment transfers as well', () => {
    const ext: ExternalLoad = {
      bodyId: 'A',
      point: { x: 0, y: 0, z: 0 },
      force: { x: 0, y: 0, z: 0 },
      moment: { x: 50, y: 0, z: 0 },
    };
    const r = balanceForces(['A', 'B'], [mate('m1', 'A', 'B')], [ext]);
    expect(r.reactions[0]!.momentOnB.x).toBeCloseTo(50, 5);
  });

  it('reaction magnitude is hypot of vector', () => {
    const r = balanceForces(['A', 'B'], [mate('m1', 'A', 'B')], [load('A', 30, 40, 0)]);
    expect(r.reactions[0]!.forceMagnitudeN).toBeCloseTo(50, 5);
  });

  it('totalReactionN sums mate magnitudes', () => {
    const mates = [mate('m1', 'A', 'B'), mate('m2', 'B', 'C')];
    const r = balanceForces(['A', 'B', 'C'], mates, [load('A', 100, 0, 0)]);
    expect(r.totalReactionN).toBeCloseTo(200, 1);
  });
});

describe('sizeJoint', () => {
  it('produces non-negative required area', () => {
    const r = balanceForces(['A', 'B'], [mate('m1', 'A', 'B')], [load('A', 1000, 0, 0)]);
    const check = sizeJoint(r.reactions[0]!, 250);
    expect(check.requiredAreaMm2).toBeGreaterThan(0);
  });

  it('shear vs axial separated', () => {
    const r = balanceForces(['A', 'B'], [mate('m1', 'A', 'B')], [load('A', 30, 40, 100)]);
    const check = sizeJoint(r.reactions[0]!, 250);
    expect(check.shearForceN).toBeCloseTo(50, 5);
    expect(check.axialForceN).toBeCloseTo(100, 5);
  });

  it('zero allowable stress → zero required area', () => {
    const r = balanceForces(['A', 'B'], [mate('m1', 'A', 'B')], [load('A', 1000, 0, 0)]);
    expect(sizeJoint(r.reactions[0]!, 0).requiredAreaMm2).toBe(0);
  });
});

describe('summarize', () => {
  it('reports mate count + max force', () => {
    const r = balanceForces(['A', 'B'], [mate('m1', 'A', 'B')], [load('A', 0, 0, 500)]);
    const s = summarize(r);
    expect(s.mateCount).toBe(1);
    expect(s.maxForceMagnitudeN).toBeCloseTo(500, 5);
  });

  it('empty → zero counts', () => {
    const r = balanceForces([], [], []);
    const s = summarize(r);
    expect(s.mateCount).toBe(0);
    expect(s.maxForceMagnitudeN).toBe(0);
  });

  it('unbalancedBodyCount reflects residuals', () => {
    // Apply load to an isolated body (no mates) → residual remains.
    const r = balanceForces(['A'], [], [load('A', 100, 0, 0)]);
    const s = summarize(r);
    expect(s.unbalancedBodyCount).toBeGreaterThan(0);
  });
});
