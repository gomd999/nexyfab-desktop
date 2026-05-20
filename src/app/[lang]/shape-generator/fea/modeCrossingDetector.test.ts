import { describe, it, expect } from 'vitest';
import {
  detectModeCrossing,
  modalAssuranceCriterion,
  summarize,
  type SweepStep,
} from './modeCrossingDetector';

function step(p: number, modes: { freq: number; shape: number[] }[]): SweepStep {
  return {
    parameterValue: p,
    modes: modes.map((m, i) => ({ index: i, frequencyHz: m.freq, shape: m.shape })),
  };
}

describe('modalAssuranceCriterion', () => {
  it('identical vectors → 1', () => {
    expect(modalAssuranceCriterion([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });

  it('orthogonal vectors → 0', () => {
    expect(modalAssuranceCriterion([1, 0], [0, 1])).toBe(0);
  });

  it('scaled vectors → 1', () => {
    expect(modalAssuranceCriterion([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 5);
  });

  it('mismatched lengths → 0', () => {
    expect(modalAssuranceCriterion([1, 2], [1])).toBe(0);
  });

  it('zero vector → 0', () => {
    expect(modalAssuranceCriterion([0, 0], [1, 1])).toBe(0);
  });
});

describe('detectModeCrossing', () => {
  it('empty sweep → empty result', () => {
    const r = detectModeCrossing([]);
    expect(r.tracked).toEqual([]);
  });

  it('single-step sweep tracks initial modes', () => {
    const sweep = [step(1, [{ freq: 100, shape: [1, 0] }, { freq: 200, shape: [0, 1] }])];
    const r = detectModeCrossing(sweep);
    expect(r.tracked).toHaveLength(2);
    expect(r.crossings).toEqual([]);
  });

  it('no crossing → mode-1 follows index 0 through sweep', () => {
    const sweep = [
      step(1, [{ freq: 100, shape: [1, 0] }, { freq: 200, shape: [0, 1] }]),
      step(2, [{ freq: 110, shape: [1, 0] }, { freq: 210, shape: [0, 1] }]),
    ];
    const r = detectModeCrossing(sweep);
    expect(r.tracked[0]!.perStepIndex).toEqual([0, 0]);
    expect(r.crossings).toEqual([]);
  });

  it('mode crossing detected when indices swap', () => {
    // At step 1: mode A (shape [1,0]) is at index 0, freq 100; mode B (shape [0,1]) at index 1, freq 200.
    // At step 2: solver returns them in swapped order (e.g., shape [0,1] at index 0, freq 150; shape [1,0] at index 1, freq 250).
    const sweep = [
      step(1, [{ freq: 100, shape: [1, 0] }, { freq: 200, shape: [0, 1] }]),
      step(2, [{ freq: 150, shape: [0, 1] }, { freq: 250, shape: [1, 0] }]),
    ];
    const r = detectModeCrossing(sweep);
    expect(r.crossings.length).toBeGreaterThan(0);
  });

  it('veering flagged when frequencies converge', () => {
    const sweep = [
      step(1, [{ freq: 100, shape: [1, 0] }, { freq: 200, shape: [0, 1] }]),
      step(2, [{ freq: 150, shape: [1, 0] }, { freq: 152, shape: [0, 1] }]),
    ];
    const r = detectModeCrossing(sweep, { macThreshold: 0.85, veeringFrequencyTolHz: 5 });
    expect(r.veerings.length).toBeGreaterThan(0);
  });

  it('low MAC → lost track flagged', () => {
    const sweep = [
      step(1, [{ freq: 100, shape: [1, 0] }]),
      step(2, [{ freq: 150, shape: [0.1, 0.9] }]), // very different shape → MAC ≈ 0.01
    ];
    const r = detectModeCrossing(sweep, { macThreshold: 0.85, veeringFrequencyTolHz: 5 });
    expect(r.tracked[0]!.perStepIndex).toContain(-1);
  });

  it('frequencies tracked per step', () => {
    const sweep = [
      step(1, [{ freq: 100, shape: [1, 0] }]),
      step(2, [{ freq: 110, shape: [1, 0] }]),
      step(3, [{ freq: 120, shape: [1, 0] }]),
    ];
    const r = detectModeCrossing(sweep);
    expect(r.tracked[0]!.perStepFrequency).toEqual([100, 110, 120]);
  });
});

describe('summarize', () => {
  it('reports tracked count', () => {
    const sweep = [
      step(1, [{ freq: 100, shape: [1, 0] }, { freq: 200, shape: [0, 1] }]),
      step(2, [{ freq: 110, shape: [1, 0] }, { freq: 210, shape: [0, 1] }]),
    ];
    const r = detectModeCrossing(sweep);
    const s = summarize(r);
    expect(s.trackedModeCount).toBe(2);
  });

  it('lostTrackCount > 0 when track lost', () => {
    const sweep = [
      step(1, [{ freq: 100, shape: [1, 0] }]),
      step(2, [{ freq: 150, shape: [0, 1] }]),
    ];
    const r = detectModeCrossing(sweep, { macThreshold: 0.85, veeringFrequencyTolHz: 5 });
    expect(summarize(r).lostTrackCount).toBeGreaterThan(0);
  });
});
