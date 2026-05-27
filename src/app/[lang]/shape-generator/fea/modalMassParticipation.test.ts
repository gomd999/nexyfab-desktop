import { describe, it, expect } from 'vitest';
import {
  computeParticipation,
  checkSufficiency,
  summarize,
  type Mode,
} from './modalMassParticipation';

function mode(index: number, freq: number, ev: number[]): Mode {
  return { index, frequencyHz: freq, eigenvector: ev };
}

describe('computeParticipation', () => {
  it('empty modes or mass → empty result', () => {
    const r = computeParticipation([], []);
    expect(r.perMode).toEqual([]);
    expect(r.modesToReachTarget.x).toBe(-1);
  });

  it('participation factor non-negative effective mass', () => {
    const modes = [mode(1, 10, [1, 0, 0, 1, 0, 0])];
    const masses = [1, 1];
    const r = computeParticipation(modes, masses);
    expect(r.perMode[0]!.effectiveMass.x).toBeGreaterThanOrEqual(0);
  });

  it('participation factor sums to total mass for proper basis', () => {
    // Two unit modes, perfectly capturing X direction.
    const modes = [
      mode(1, 10, [1, 0, 0]),
      mode(2, 20, [-1, 0, 0]),
    ];
    const masses = [1];
    const r = computeParticipation(modes, masses);
    expect(r.perMode[0]!.effectiveMass.x).toBeCloseTo(1, 5);
    expect(r.perMode[1]!.effectiveMass.x).toBeCloseTo(1, 5);
  });

  it('cumulative fraction monotonically increases', () => {
    const modes = [
      mode(1, 10, [1, 0, 0]),
      mode(2, 20, [0.5, 0, 0]),
    ];
    const r = computeParticipation(modes, [1]);
    expect(r.cumulativeFraction[1]!.fraction.x).toBeGreaterThanOrEqual(r.cumulativeFraction[0]!.fraction.x);
  });

  it('modesToReachTarget returns first index hitting target', () => {
    const modes = [
      mode(1, 10, [0.5, 0, 0]),
      mode(2, 20, [0.5, 0, 0]),
      mode(3, 30, [0.5, 0, 0]),
      mode(4, 40, [0.5, 0, 0]),
    ];
    // Each eff = 0.25; cumulative = 0.25, 0.5, 0.75, 1.0. Target 0.9 → mode 4.
    const r = computeParticipation(modes, [1], { targetFraction: 0.9 });
    expect(r.modesToReachTarget.x).toBe(4);
  });

  it('returns -1 if target never reached', () => {
    const modes = [mode(1, 10, [0.1, 0, 0])];
    const r = computeParticipation(modes, [1], { targetFraction: 0.9 });
    expect(r.modesToReachTarget.x).toBe(-1);
  });

  it('Y direction independent of X', () => {
    const modes = [mode(1, 10, [0, 1, 0])];
    const r = computeParticipation(modes, [1]);
    expect(r.perMode[0]!.effectiveMass.x).toBe(0);
    expect(r.perMode[0]!.effectiveMass.y).toBeCloseTo(1, 5);
  });

  it('total mass = sum of per-DOF mass', () => {
    const r = computeParticipation([mode(1, 10, [1, 0, 0])], [2, 3, 5]);
    expect(r.totalMass.x).toBe(10);
  });
});

describe('checkSufficiency', () => {
  it('empty result → fail', () => {
    const r = computeParticipation([], []);
    const s = checkSufficiency(r);
    expect(s.passesX).toBe(false);
  });

  it('captures enough mass → pass', () => {
    const modes = [
      mode(1, 10, [1, 1, 1]),
    ];
    const r = computeParticipation(modes, [1], { targetFraction: 0.5 });
    const s = checkSufficiency(r);
    expect(s.passesX).toBe(true);
  });

  it('worst fraction = min across directions', () => {
    const modes = [mode(1, 10, [1, 0.5, 0.1])];
    const r = computeParticipation(modes, [1]);
    const s = checkSufficiency(r);
    expect(s.worstFraction).toBeLessThanOrEqual(0.5);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const s = summarize(computeParticipation([], []));
    expect(s.modeCount).toBe(0);
  });

  it('reports mode count', () => {
    const modes = [mode(1, 10, [1, 0, 0]), mode(2, 20, [0, 1, 0])];
    const s = summarize(computeParticipation(modes, [1]));
    expect(s.modeCount).toBe(2);
  });

  it('passesTarget when all 3 directions exceed', () => {
    const modes = [mode(1, 10, [1, 1, 1])];
    const r = computeParticipation(modes, [1], { targetFraction: 0.5 });
    const s = summarize(r);
    expect(s.passesTarget).toBe(true);
  });
});
