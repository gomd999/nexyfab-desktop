import { describe, it, expect } from 'vitest';
import {
  solve,
  permissibleUnbalanceGmm,
  summarize,
  type TwoPlaneInput,
} from './twoPlaneBalancing';

// Construct a synthetic, well-conditioned case: known influence matrix.
// Let a11=1∠0, a22=1∠0, a12=0.2∠0, a21=0.2∠0 (real for simplicity).
// V0 = [10∠0, 6∠0]. Trial mass 1 g at 0° in each plane.
// V_trial1 = V0 + a*1 column1 = [10+1, 6+0.2] = [11, 6.2]
// V_trial2 = V0 + a*1 column2 = [10+0.2, 6+1] = [10.2, 7]
const input: TwoPlaneInput = {
  v0: [{ magnitude: 10, phaseDeg: 0 }, { magnitude: 6, phaseDeg: 0 }],
  trial1: {
    massG: 1, angleDeg: 0,
    response: [{ magnitude: 11, phaseDeg: 0 }, { magnitude: 6.2, phaseDeg: 0 }],
  },
  trial2: {
    massG: 1, angleDeg: 0,
    response: [{ magnitude: 10.2, phaseDeg: 0 }, { magnitude: 7, phaseDeg: 0 }],
  },
};

describe('solve', () => {
  it('produces correction masses', () => {
    const r = solve(input);
    expect(r.plane1.massG).toBeGreaterThan(0);
    expect(r.plane2.massG).toBeGreaterThan(0);
  });

  it('predicted residual near zero', () => {
    const r = solve(input);
    expect(r.predictedResidual[0]).toBeCloseTo(0, 4);
    expect(r.predictedResidual[1]).toBeCloseTo(0, 4);
  });

  it('correction phase ≈ 180° (opposes original, real positive a)', () => {
    const r = solve(input);
    // since influence is positive-real and V0 positive-real, correction should be ~180°.
    expect(Math.abs(r.plane1.angleDeg - 180)).toBeLessThan(5);
  });

  it('singular influence matrix → warning + zero correction', () => {
    // make trial1 and trial2 responses identical to V0 → zero influence → singular
    const bad: TwoPlaneInput = {
      v0: input.v0,
      trial1: { massG: 1, angleDeg: 0, response: input.v0 },
      trial2: { massG: 1, angleDeg: 0, response: input.v0 },
    };
    const r = solve(bad);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.plane1.massG).toBe(0);
  });

  it('zero trial mass → warning', () => {
    const r = solve({ ...input, trial1: { ...input.trial1, massG: 0 } });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('correction angle in 0..360', () => {
    const r = solve(input);
    expect(r.plane1.angleDeg).toBeGreaterThanOrEqual(0);
    expect(r.plane1.angleDeg).toBeLessThan(360);
  });

  it('larger original vibration → larger correction (same influence matrix)', () => {
    // Double v0 AND shift trial responses by the same delta so the influence
    // coefficients aij = (response − v0)/U stay identical; only V0 scales.
    const big: TwoPlaneInput = {
      v0: [{ magnitude: 20, phaseDeg: 0 }, { magnitude: 12, phaseDeg: 0 }],
      trial1: { massG: 1, angleDeg: 0, response: [{ magnitude: 21, phaseDeg: 0 }, { magnitude: 12.2, phaseDeg: 0 }] },
      trial2: { massG: 1, angleDeg: 0, response: [{ magnitude: 20.2, phaseDeg: 0 }, { magnitude: 13, phaseDeg: 0 }] },
    };
    const rBase = solve(input);
    const rBig = solve(big);
    expect(rBig.plane1.massG).toBeGreaterThan(rBase.plane1.massG);
  });
});

describe('permissibleUnbalanceGmm', () => {
  it('positive for valid inputs', () => {
    expect(permissibleUnbalanceGmm(6.3, 10, 3000)).toBeGreaterThan(0);
  });

  it('higher rpm → tighter (smaller) permissible unbalance', () => {
    const slow = permissibleUnbalanceGmm(6.3, 10, 1000);
    const fast = permissibleUnbalanceGmm(6.3, 10, 6000);
    expect(fast).toBeLessThan(slow);
  });

  it('finer grade → smaller permissible', () => {
    const coarse = permissibleUnbalanceGmm(6.3, 10, 3000);
    const fine = permissibleUnbalanceGmm(1.0, 10, 3000);
    expect(fine).toBeLessThan(coarse);
  });
});

describe('summarize', () => {
  it('reports planes + max residual', () => {
    const r = solve(input);
    const s = summarize(r);
    expect(s.plane1).toEqual(r.plane1);
    expect(s.maxResidual).toBeCloseTo(Math.max(...r.predictedResidual), 6);
  });
});
