import { describe, it, expect } from 'vitest';
import {
  newPlasticState,
  vonMises,
  radialReturn,
  runIncrementalLoading,
  uniaxialElastoPlastic,
  greenLagrangeStrain1D,
  rodriguesRotation,
  deformedPosition,
  type BilinearElastoPlastic,
} from './nonlinearAnalysis';

const mildSteel: BilinearElastoPlastic = {
  E: 200000, nu: 0.3, yieldStrength: 250, tangentModulus: 2000,
};

describe('vonMises', () => {
  it('hydrostatic stress → 0', () => {
    expect(vonMises(100, 100, 100)).toBe(0);
  });

  it('uniaxial tension σ1 → σ1', () => {
    expect(vonMises(200, 0, 0)).toBeCloseTo(200, 5);
  });

  it('symmetric in principal indices', () => {
    expect(vonMises(100, 200, 150)).toBeCloseTo(vonMises(200, 100, 150), 6);
  });
});

describe('radialReturn', () => {
  it('elastic step — no plastic update', () => {
    const state = newPlasticState(mildSteel);
    const trial = { sigma1: 100, sigma2: 0, sigma3: 0 };
    const r = radialReturn(trial, state, mildSteel);
    expect(r.wasPlastic).toBe(false);
    expect(r.plasticIncrement).toBe(0);
    expect(r.newStress).toEqual(trial);
  });

  it('plastic step — returns to yield surface', () => {
    const state = newPlasticState(mildSteel);
    const trial = { sigma1: 400, sigma2: 0, sigma3: 0 }; // exceeds 250 yield
    const r = radialReturn(trial, state, mildSteel);
    expect(r.wasPlastic).toBe(true);
    expect(r.plasticIncrement).toBeGreaterThan(0);
    const vmAfter = vonMises(r.newStress.sigma1, r.newStress.sigma2, r.newStress.sigma3);
    expect(vmAfter).toBeLessThan(vonMises(trial.sigma1, trial.sigma2, trial.sigma3));
  });

  it('plastic strain accumulates', () => {
    let state = newPlasticState(mildSteel);
    const trial = { sigma1: 400, sigma2: 0, sigma3: 0 };
    state = radialReturn(trial, state, mildSteel).newState;
    const before = state.plasticStrain;
    state = radialReturn({ sigma1: 500, sigma2: 0, sigma3: 0 }, state, mildSteel).newState;
    expect(state.plasticStrain).toBeGreaterThan(before);
  });

  it('current yield surface grows with strain hardening', () => {
    let state = newPlasticState(mildSteel);
    const initialY = state.currentYield;
    state = radialReturn({ sigma1: 400, sigma2: 0, sigma3: 0 }, state, mildSteel).newState;
    expect(state.currentYield).toBeGreaterThan(initialY);
  });
});

describe('runIncrementalLoading', () => {
  it('converges for elastic-only loading', () => {
    const states = [newPlasticState(mildSteel), newPlasticState(mildSteel)];
    const solver = () => [{ sigma1: 100, sigma2: 0, sigma3: 0 }, { sigma1: 100, sigma2: 0, sigma3: 0 }];
    const r = runIncrementalLoading(states, mildSteel, [{ factor: 0.5 }, { factor: 1.0 }], solver);
    expect(r.fullyConverged).toBe(true);
    expect(r.steps[0]!.maxPlasticStrain).toBe(0);
  });

  it('tracks max plastic strain through plastic load', () => {
    const states = [newPlasticState(mildSteel)];
    let callCount = 0;
    const solver = () => {
      callCount++;
      return [{ sigma1: 400, sigma2: 0, sigma3: 0 }];
    };
    const r = runIncrementalLoading(states, mildSteel, [{ factor: 1.0 }], solver);
    expect(r.steps[0]!.maxPlasticStrain).toBeGreaterThan(0);
    expect(callCount).toBeGreaterThan(0);
  });

  it('aborts step when maxPlasticStrain threshold crossed', () => {
    const states = [newPlasticState(mildSteel)];
    const solver = () => [{ sigma1: 600, sigma2: 0, sigma3: 0 }];
    const r = runIncrementalLoading(
      states, mildSteel,
      [{ factor: 1.0, maxPlasticStrain: 0.001 }, { factor: 2.0 }],
      solver,
    );
    // Should stop after step 1 since plastic strain > threshold.
    expect(r.steps.length).toBeLessThanOrEqual(1);
  });
});

describe('uniaxialElastoPlastic (coupled loop vs analytic bilinear)', () => {
  // Mild steel: E=200000, σy=250, H=2000.
  const STRESSES = [150, 240, 300, 360, 420];

  it('stays elastic below yield, flows plastically above (per-step)', () => {
    const r = uniaxialElastoPlastic(mildSteel, STRESSES);
    // 150, 240 MPa < σy=250 → no plastic strain.
    expect(r.steps[0]!.plasticStrain).toBe(0);
    expect(r.steps[1]!.plasticStrain).toBe(0);
    // 300, 360, 420 MPa > σy → monotonically accumulating plastic strain.
    expect(r.steps[2]!.plasticStrain).toBeGreaterThan(0);
    expect(r.steps[3]!.plasticStrain).toBeGreaterThan(r.steps[2]!.plasticStrain);
    expect(r.steps[4]!.plasticStrain).toBeGreaterThan(r.steps[3]!.plasticStrain);
  });

  it('hardens to the applied stress with the analytic plastic strain (420 → ε_p=0.085)', () => {
    const r = uniaxialElastoPlastic(mildSteel, STRESSES);
    expect(r.fullyConverged).toBe(true);
    // Stress-controlled: the yield surface hardens up to the final applied stress.
    expect(r.final.currentYield).toBeCloseTo(420, 0);
    // Bilinear law: ε_p = (σ − σy0) / H = (420 − 250) / 2000 = 0.085.
    expect(r.final.plasticStrain).toBeCloseTo(0.085, 3);
  });

  it('respects the isotropic-hardening law currentYield = σy0 + H·ε_p exactly', () => {
    const r = uniaxialElastoPlastic(mildSteel, STRESSES);
    expect(r.final.currentYield).toBeCloseTo(250 + 2000 * r.final.plasticStrain, 6);
  });
});

describe('rodriguesRotation', () => {
  it('zero angle = identity', () => {
    const r = rodriguesRotation([0, 0, 1], 0);
    expect(r[0]![0]!).toBeCloseTo(1, 5);
    expect(r[1]![1]!).toBeCloseTo(1, 5);
    expect(r[2]![2]!).toBeCloseTo(1, 5);
  });

  it('π about +Z flips X+Y', () => {
    const r = rodriguesRotation([0, 0, 1], Math.PI);
    expect(r[0]![0]!).toBeCloseTo(-1, 5);
    expect(r[1]![1]!).toBeCloseTo(-1, 5);
    expect(r[2]![2]!).toBeCloseTo(1, 5);
  });
});

describe('greenLagrangeStrain1D', () => {
  it('zero strain for unchanged length', () => {
    expect(greenLagrangeStrain1D(100, 100)).toBe(0);
  });

  it('1% stretch ≈ engineering strain 0.01 → GL ≈ 0.01005', () => {
    expect(greenLagrangeStrain1D(100, 101)).toBeCloseTo(0.01005, 4);
  });

  it('larger strain — GL > engineering', () => {
    // 50% stretch: engineering = 0.5, GL = (1.5²-1)/2 = 0.625
    expect(greenLagrangeStrain1D(100, 150)).toBeCloseTo(0.625, 4);
  });
});

describe('deformedPosition', () => {
  it('reference + displacement', () => {
    const r = deformedPosition({ reference: [1, 2, 3], displacement: [10, 20, 30] });
    expect(r).toEqual([11, 22, 33]);
  });
});
