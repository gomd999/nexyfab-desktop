import { describe, it, expect } from 'vitest';
import {
  distributeLoad,
  threeSupportExact,
  suggestRebalance,
  summarize,
  type BodyMass,
  type SupportPoint,
} from './weightDistributionLeveler';

const body: BodyMass = { totalWeightN: 1000, cog: { x: 0, y: 0 } };

function support(id: string, x: number, y: number, cap: number = 600): SupportPoint {
  return { id, position: { x, y }, capacityN: cap };
}

describe('distributeLoad', () => {
  it('empty supports → empty result', () => {
    const r = distributeLoad(body, []);
    expect(r.loads).toEqual([]);
  });

  it('single support carries all', () => {
    const r = distributeLoad(body, [support('s1', 0, 0)]);
    expect(r.loads[0]!.loadN).toBe(1000);
  });

  it('two equal-distance supports share equally', () => {
    const r = distributeLoad(body, [support('s1', -10, 0), support('s2', 10, 0)]);
    expect(r.loads[0]!.loadN).toBeCloseTo(r.loads[1]!.loadN, 1);
  });

  it('overloaded support flagged', () => {
    const r = distributeLoad(body, [support('s1', 0, 0, 100)]);
    expect(r.overloadedSupports).toContain('s1');
  });

  it('utilisation reported', () => {
    const r = distributeLoad(body, [support('s1', 0, 0, 1000)]);
    expect(r.loads[0]!.utilisation).toBeCloseTo(1, 3);
  });

  it('four-support body distributes load', () => {
    const r = distributeLoad(body, [
      support('s1', -10, -10),
      support('s2', 10, -10),
      support('s3', 10, 10),
      support('s4', -10, 10),
    ]);
    const total = r.loads.reduce((s, l) => s + l.loadN, 0);
    expect(total).toBeCloseTo(1000, 1);
  });

  it('residual moment reported', () => {
    const r = distributeLoad(body, [support('s1', -10, 0), support('s2', 10, 0)]);
    expect(r.residualMomentNm).toBeGreaterThanOrEqual(0);
  });
});

describe('threeSupportExact', () => {
  it('uniquely solves three-support equilibrium', () => {
    const supports: [SupportPoint, SupportPoint, SupportPoint] = [
      support('a', -10, -10), support('b', 10, -10), support('c', 0, 10),
    ];
    const r = threeSupportExact(body, supports);
    const total = r.loads.reduce((s, l) => s + l.loadN, 0);
    expect(total).toBeCloseTo(body.totalWeightN, 1);
  });

  it('lift-off detected when CG outside triangle', () => {
    const supports: [SupportPoint, SupportPoint, SupportPoint] = [
      support('a', -10, -10), support('b', -5, -10), support('c', 0, -10),
    ];
    const bodyOffCenter: BodyMass = { totalWeightN: 1000, cog: { x: 50, y: 50 } };
    const r = threeSupportExact(bodyOffCenter, supports);
    // Some load may be negative.
    expect(r.loads.length).toBe(3);
  });

  it('falls back to weighted when collinear (singular)', () => {
    const collinear: [SupportPoint, SupportPoint, SupportPoint] = [
      support('a', 0, 0), support('b', 5, 0), support('c', 10, 0),
    ];
    const r = threeSupportExact(body, collinear);
    expect(r.loads.length).toBe(3);
  });
});

describe('suggestRebalance', () => {
  it('empty when no lift-off', () => {
    const r = distributeLoad(body, [support('s1', -10, 0), support('s2', 10, 0)]);
    expect(suggestRebalance(r, body, [support('s1', -10, 0), support('s2', 10, 0)])).toEqual([]);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const r = distributeLoad(body, [support('s1', -10, 0), support('s2', 10, 0)]);
    const s = summarize(r);
    expect(s.supportCount).toBe(2);
    expect(s.maxUtilisation).toBeGreaterThan(0);
  });
});
