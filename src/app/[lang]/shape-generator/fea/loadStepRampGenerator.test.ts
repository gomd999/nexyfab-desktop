import { describe, it, expect } from 'vitest';
import {
  generateRamp,
  initAdaptive,
  nextSubstep,
  recommendProfile,
  diagnoseRamp,
  summarize,
  type SubstepFeedback,
} from './loadStepRampGenerator';

describe('generateRamp', () => {
  it('linear ramp reaches 1.0', () => {
    const r = generateRamp({ profile: 'linear', initialDt: 0.25, minDt: 0.01, maxDt: 0.5, maxNewtonIterations: 12, exponentialBase: 1.5 });
    expect(r.substepLoadFractions[r.substepLoadFractions.length - 1]).toBeCloseTo(1, 3);
  });

  it('linear ramp produces ~4 substeps for dt=0.25', () => {
    const r = generateRamp({ profile: 'linear', initialDt: 0.25, minDt: 0.01, maxDt: 0.5, maxNewtonIterations: 12, exponentialBase: 1.5 });
    expect(r.totalSubsteps).toBe(4);
  });

  it('quadratic ramp grows dt', () => {
    const r = generateRamp({ profile: 'quadratic', initialDt: 0.05, minDt: 0.001, maxDt: 1.0, maxNewtonIterations: 12, exponentialBase: 1.5 });
    const diff1 = r.substepLoadFractions[1]! - r.substepLoadFractions[0]!;
    const diffN = r.substepLoadFractions[r.substepLoadFractions.length - 1]! - r.substepLoadFractions[r.substepLoadFractions.length - 2]!;
    expect(diffN).toBeGreaterThan(diff1);
  });

  it('exponential ramp fewer substeps than linear for same initial', () => {
    const linear = generateRamp({ profile: 'linear', initialDt: 0.05, minDt: 0.001, maxDt: 1.0, maxNewtonIterations: 12, exponentialBase: 1.5 });
    const exp = generateRamp({ profile: 'exponential', initialDt: 0.05, minDt: 0.001, maxDt: 1.0, maxNewtonIterations: 12, exponentialBase: 1.5 });
    expect(exp.totalSubsteps).toBeLessThan(linear.totalSubsteps);
  });

  it('maxDt clamps step growth', () => {
    const r = generateRamp({ profile: 'exponential', initialDt: 0.1, minDt: 0.001, maxDt: 0.15, maxNewtonIterations: 12, exponentialBase: 5 });
    let maxStep = 0;
    for (let i = 1; i < r.substepLoadFractions.length; i++) {
      const step = r.substepLoadFractions[i]! - r.substepLoadFractions[i - 1]!;
      if (step > maxStep) maxStep = step;
    }
    expect(maxStep).toBeLessThanOrEqual(0.16);
  });

  it('cost score positive', () => {
    const r = generateRamp();
    expect(r.estimatedCostScore).toBeGreaterThan(0);
  });
});

describe('nextSubstep (adaptive)', () => {
  it('converged + fast → grow dt', () => {
    const state = initAdaptive({ initialDt: 0.1, minDt: 0.001, maxDt: 1, maxNewtonIterations: 12, exponentialBase: 1.5, profile: 'adaptive' });
    const feedback: SubstepFeedback = { step: 1, loadFraction: 0.1, iterationsUsed: 3, converged: true };
    nextSubstep(state, feedback);
    expect(state.currentDt).toBeGreaterThan(0.1);
  });

  it('not converged → cut dt in half', () => {
    const state = initAdaptive({ initialDt: 0.2, minDt: 0.001, maxDt: 1, maxNewtonIterations: 12, exponentialBase: 1.5, profile: 'adaptive' });
    const feedback: SubstepFeedback = { step: 1, loadFraction: 0.2, iterationsUsed: 20, converged: false };
    nextSubstep(state, feedback);
    expect(state.currentDt).toBeCloseTo(0.1, 3);
  });

  it('iterations at max → shrink dt', () => {
    const state = initAdaptive({ initialDt: 0.2, minDt: 0.001, maxDt: 1, maxNewtonIterations: 12, exponentialBase: 1.5, profile: 'adaptive' });
    const feedback: SubstepFeedback = { step: 1, loadFraction: 0.2, iterationsUsed: 12, converged: true };
    nextSubstep(state, feedback);
    expect(state.currentDt).toBeLessThan(0.2);
  });

  it('history records feedback', () => {
    const state = initAdaptive();
    nextSubstep(state, { step: 1, loadFraction: 0.1, iterationsUsed: 5, converged: true });
    expect(state.history).toHaveLength(1);
  });
});

describe('recommendProfile', () => {
  it('small-deformation → linear', () => {
    expect(recommendProfile('small-deformation')).toBe('linear');
  });

  it('contact → adaptive', () => {
    expect(recommendProfile('contact')).toBe('adaptive');
  });

  it('plastic → adaptive', () => {
    expect(recommendProfile('plastic')).toBe('adaptive');
  });
});

describe('diagnoseRamp', () => {
  it('empty history → no issues', () => {
    expect(diagnoseRamp([]).recommendation).toBe('No issues.');
  });

  it('high divergence → adaptive recommendation', () => {
    const history: SubstepFeedback[] = [];
    for (let i = 0; i < 10; i++) history.push({ step: i, loadFraction: 0.1 * i, iterationsUsed: 5, converged: i % 2 === 0 });
    expect(diagnoseRamp(history).recommendation).toContain('adaptive');
  });

  it('high average iter → quadratic recommendation', () => {
    const history: SubstepFeedback[] = [];
    for (let i = 0; i < 5; i++) history.push({ step: i, loadFraction: 0.2 * i, iterationsUsed: 11, converged: true });
    expect(diagnoseRamp(history).recommendation).toContain('quadratic');
  });
});

describe('summarize', () => {
  it('reports profile + substep count', () => {
    const r = generateRamp({ profile: 'linear', initialDt: 0.25, minDt: 0.001, maxDt: 1, maxNewtonIterations: 12, exponentialBase: 1.5 });
    const s = summarize(r, 'linear');
    expect(s.profile).toBe('linear');
    expect(s.totalSubsteps).toBe(r.totalSubsteps);
  });

  it('finalLoad ≈ 1', () => {
    const r = generateRamp();
    expect(summarize(r, 'linear').finalLoad).toBeCloseTo(1, 3);
  });
});
