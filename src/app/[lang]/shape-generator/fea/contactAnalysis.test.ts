import { describe, it, expect } from 'vitest';
import {
  detectContact,
  computePenaltyForces,
  evaluateFriction,
  checkConvergence,
  summarizeContact,
  recommendPenaltyStiffness,
  FRICTION_COEFFICIENTS,
  type ContactSurface,
  type ContactPair,
} from './contactAnalysis';

function makeSurface(id: string, bodyId: string, points: Array<[number, number, number]>, normal: [number, number, number] = [0, 0, 1]): ContactSurface {
  return {
    id, bodyId, points,
    normals: points.map(() => normal),
  };
}

const pair: ContactPair = {
  id: 'p1',
  surfaceA: 'A',
  surfaceB: 'B',
  frictionCoefficient: 0.3,
  penaltyStiffness: 1e6,
};

describe('detectContact', () => {
  it('coincident surfaces → 0 penetration', () => {
    const A = makeSurface('A', 'b1', [[0, 0, 0]], [0, 0, 1]);
    const B = makeSurface('B', 'b2', [[0, 0, 0]], [0, 0, -1]);
    const r = detectContact(pair, A, B);
    expect(r.contactPoints[0]!.gapMm).toBeCloseTo(0, 5);
    expect(r.penetratingCount).toBe(0);
  });

  it('penetrating surfaces flagged', () => {
    // A at z=0 normal +z, B at z=-1 → B is behind A's normal → negative gap.
    const A = makeSurface('A', 'b1', [[0, 0, 0]], [0, 0, 1]);
    const B = makeSurface('B', 'b2', [[0, 0, -1]], [0, 0, 1]);
    const r = detectContact(pair, A, B);
    expect(r.penetratingCount).toBe(1);
    expect(r.maxPenetrationMm).toBeCloseTo(1, 5);
  });

  it('separated surfaces → inactive contact (gap > tol)', () => {
    const A = makeSurface('A', 'b1', [[0, 0, 0]], [0, 0, 1]);
    const B = makeSurface('B', 'b2', [[0, 0, 5]], [0, 0, -1]);
    const r = detectContact(pair, A, B, /* tolerance */ 0.01);
    expect(r.contactPoints[0]!.active).toBe(false);
  });

  it('returns 1 contact point per A point', () => {
    const A = makeSurface('A', 'b1', [[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
    const B = makeSurface('B', 'b2', [[0, 0, 0]]);
    const r = detectContact(pair, A, B);
    expect(r.contactPoints).toHaveLength(3);
  });
});

describe('computePenaltyForces', () => {
  it('produces equal-and-opposite forces', () => {
    const A = makeSurface('A', 'b1', [[0, 0, 0]], [0, 0, 1]);
    const B = makeSurface('B', 'b2', [[0, 0, -1]], [0, 0, 1]);
    const detection = detectContact(pair, A, B);
    const { forcesA, forcesB } = computePenaltyForces(detection, pair, 'A', 'B');
    expect(forcesA).toHaveLength(1);
    expect(forcesB).toHaveLength(1);
    for (let k = 0; k < 3; k++) {
      expect(forcesA[0]!.force[k]).toBeCloseTo(-forcesB[0]!.force[k], 5);
    }
  });

  it('force magnitude = k × penetration', () => {
    const A = makeSurface('A', 'b1', [[0, 0, 0]], [0, 0, 1]);
    const B = makeSurface('B', 'b2', [[0, 0, -0.5]], [0, 0, 1]);
    const detection = detectContact(pair, A, B);
    const { forcesA } = computePenaltyForces(detection, pair, 'A', 'B');
    const magnitude = Math.hypot(forcesA[0]!.force[0], forcesA[0]!.force[1], forcesA[0]!.force[2]);
    expect(magnitude).toBeCloseTo(pair.penaltyStiffness * 0.5, 1);
  });

  it('no forces when not penetrating', () => {
    const A = makeSurface('A', 'b1', [[0, 0, 0]], [0, 0, 1]);
    const B = makeSurface('B', 'b2', [[0, 0, 5]], [0, 0, 1]);
    const detection = detectContact(pair, A, B);
    expect(computePenaltyForces(detection, pair, 'A', 'B').forcesA).toHaveLength(0);
  });
});

describe('evaluateFriction', () => {
  it('within cap → sticking', () => {
    // tForce = 0.01 × 1000 = 10. cap = 0.3 × 100 = 30 → stick.
    const r = evaluateFriction(100, [0.01, 0, 0], 0.3, 1000);
    expect(r.sliding).toBe(false);
    expect(r.forceMagnitude).toBeCloseTo(10, 5);
  });

  it('above cap → slipping at μN', () => {
    const r = evaluateFriction(100, [1, 0, 0], 0.3, 1e6);
    expect(r.sliding).toBe(true);
    expect(r.forceMagnitude).toBeCloseTo(30, 5); // 0.3 × 100
  });

  it('zero normal force → zero friction', () => {
    const r = evaluateFriction(0, [1, 0, 0], 0.5, 1e6);
    expect(r.forceMagnitude).toBe(0);
    expect(r.sliding).toBe(true);
  });
});

describe('checkConvergence', () => {
  it('below tolerance → converged', () => {
    const detection = { pairId: 'p', contactPoints: [], penetratingCount: 0, maxPenetrationMm: 0 };
    expect(checkConvergence(5, detection, 1e-3).converged).toBe(true);
  });

  it('above tolerance → not converged', () => {
    const detection = { pairId: 'p', contactPoints: [], penetratingCount: 1, maxPenetrationMm: 0.5 };
    expect(checkConvergence(5, detection, 1e-3).converged).toBe(false);
  });
});

describe('summarizeContact', () => {
  it('aggregates across pairs', () => {
    const A = makeSurface('A', 'b1', [[0, 0, 0]], [0, 0, 1]);
    const B = makeSurface('B', 'b2', [[0, 0, -1]], [0, 0, 1]);
    const d1 = detectContact(pair, A, B);
    const d2 = detectContact(pair, A, B);
    const s = summarizeContact([d1, d2]);
    expect(s.pairCount).toBe(2);
    expect(s.penetratingPoints).toBe(2);
  });
});

describe('recommendPenaltyStiffness', () => {
  it('scales with E × L', () => {
    const k1 = recommendPenaltyStiffness(200000, 10); // steel 10mm
    const k2 = recommendPenaltyStiffness(200000, 100);
    expect(k2).toBeGreaterThan(k1);
  });
});

describe('FRICTION_COEFFICIENTS', () => {
  it('has steel-steel + teflon entries', () => {
    expect(FRICTION_COEFFICIENTS['steel-on-steel-dry']).toBeGreaterThan(0.5);
    expect(FRICTION_COEFFICIENTS['teflon-on-teflon']).toBeLessThan(0.1);
  });
});
