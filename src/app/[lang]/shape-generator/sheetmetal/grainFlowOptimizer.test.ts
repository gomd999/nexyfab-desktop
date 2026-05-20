import { describe, it, expect } from 'vitest';
import {
  optimizeOrientation,
  pickBestOrientation,
  assessBends,
  summarize,
  type BendInBlank,
} from './grainFlowOptimizer';

function bend(id: string, dirDeg: number, len: number = 100, crit: number = 1): BendInBlank {
  return { id, directionDeg: dirDeg, lengthMm: len, criticality: crit };
}

describe('optimizeOrientation', () => {
  it('candidates count matches input', () => {
    const candidates = optimizeOrientation([bend('b1', 0)], { candidateRotationsDeg: [0, 90], warnAngleDeg: 60 });
    expect(candidates).toHaveLength(2);
  });

  it('per-bend angles reported', () => {
    const candidates = optimizeOrientation([bend('b1', 90)], { candidateRotationsDeg: [0], warnAngleDeg: 60 });
    expect(candidates[0]!.perBendAngles[0]!.relativeAngleDeg).toBeCloseTo(90, 5);
  });

  it('rotation aligns with bend → angle 0', () => {
    const candidates = optimizeOrientation([bend('b1', 30)], { candidateRotationsDeg: [30], warnAngleDeg: 60 });
    expect(candidates[0]!.perBendAngles[0]!.relativeAngleDeg).toBeCloseTo(0, 5);
  });

  it('wraps angles to [0, 90]', () => {
    const candidates = optimizeOrientation([bend('b1', 170)], { candidateRotationsDeg: [0], warnAngleDeg: 60 });
    expect(candidates[0]!.perBendAngles[0]!.relativeAngleDeg).toBeLessThanOrEqual(90);
  });
});

describe('pickBestOrientation', () => {
  it('single 0° bend → rotation 0° best', () => {
    const result = pickBestOrientation([bend('b1', 0)], { candidateRotationsDeg: [0, 90], warnAngleDeg: 60 });
    expect(result.bestRotationDeg).toBe(0);
  });

  it('acceptable when worst angle within tolerance', () => {
    const result = pickBestOrientation([bend('b1', 0)], { candidateRotationsDeg: [0], warnAngleDeg: 60 });
    expect(result.acceptable).toBe(true);
  });

  it('not acceptable when worst angle exceeds tolerance', () => {
    // bend at 90° with grain rotation forced to 0 → angle 90° > 60° tol.
    const result = pickBestOrientation([bend('b1', 90)], { candidateRotationsDeg: [0], warnAngleDeg: 60 });
    expect(result.acceptable).toBe(false);
  });

  it('rationale text always populated', () => {
    const result = pickBestOrientation([bend('b1', 0)]);
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it('higher criticality dominates score', () => {
    const beads = [bend('low', 0, 100, 1), bend('high', 90, 100, 10)];
    // High-crit bend at 90°: best rotation should be ~90° to align it with grain.
    const result = pickBestOrientation(beads, {
      candidateRotationsDeg: [0, 30, 60, 90],
      warnAngleDeg: 60,
    });
    expect(result.bestRotationDeg).toBe(90);
  });
});

describe('assessBends', () => {
  it('with-grain when angle ≤ 30', () => {
    const a = assessBends([bend('b1', 20)], 0);
    expect(a[0]!.status).toBe('with-grain');
    expect(a[0]!.recommendedRadiusFactor).toBe(1.0);
  });

  it('mixed when 30 < angle ≤ 60', () => {
    const a = assessBends([bend('b1', 45)], 0);
    expect(a[0]!.status).toBe('mixed');
  });

  it('across-grain when angle > 60', () => {
    const a = assessBends([bend('b1', 90)], 0);
    expect(a[0]!.status).toBe('across-grain');
    expect(a[0]!.recommendedRadiusFactor).toBeGreaterThan(1.5);
  });
});

describe('summarize', () => {
  it('reports best rotation + acceptable flag', () => {
    const s = summarize([bend('b1', 0)], { candidateRotationsDeg: [0], warnAngleDeg: 60 });
    expect(s.bestRotationDeg).toBe(0);
    expect(s.acceptable).toBe(true);
  });

  it('worstAngleDeg ≤ 90', () => {
    const s = summarize([bend('b1', 137)], { candidateRotationsDeg: [0, 45, 90], warnAngleDeg: 60 });
    expect(s.worstAngleDeg).toBeLessThanOrEqual(90);
  });
});
