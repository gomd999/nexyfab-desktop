/**
 * pipeFlow — Darcy-Weisbach head loss and Hardy-Cross network balancing, verified: the
 * Darcy head loss and the K=8fL/(π²gD⁵) resistance; the analytic parallel-pipe split
 * Q1/Q2=√(K2/K1) with continuity; the loop head imbalance driven to zero; and
 * convergence of a four-pipe loop.
 */
import { describe, it, expect } from 'vitest';
import { G, darcyHeadLoss, pipeResistance, reynolds, loopHeadImbalance, hardyCrossLoop } from './pipeFlow';

describe('pipeFlow — Darcy + Hardy-Cross (verified)', () => {
  it('the Darcy head loss and the K=8fL/(π²gD⁵) resistance are consistent', () => {
    const f = 0.02, L = 100, D = 0.1, v = 2;
    expect(darcyHeadLoss(f, L, D, v)).toBeCloseTo((f * (L / D) * v * v) / (2 * G), 9);
    const A = (Math.PI * D * D) / 4, Q = v * A;
    expect(pipeResistance(f, L, D) * Q * Q).toBeCloseTo(darcyHeadLoss(f, L, D, v), 9); // hf = K·Q²
  });

  it('parallel pipes split as Q1/Q2 = √(K2/K1) with continuity preserved', () => {
    const r = hardyCrossLoop([{ K: 1, Q: 5 }, { K: 4, Q: -5 }]); // total 10, equal-split start
    const Q1 = r.pipes[0].Q, Q2 = -r.pipes[1].Q;
    expect(Q1 / Q2).toBeCloseTo(Math.sqrt(4 / 1), 6);  // √(K2/K1) = 2
    expect(Q1 + Q2).toBeCloseTo(10, 9);                // continuity (loop ΔQ preserves it)
  });

  it('drives the loop head imbalance to zero (Kirchhoff pressure law)', () => {
    const r = hardyCrossLoop([{ K: 1, Q: 5 }, { K: 4, Q: -5 }]);
    expect(Math.abs(loopHeadImbalance(r.pipes))).toBeLessThan(1e-9);
    // equal head loss in each parallel branch.
    expect(1 * r.pipes[0].Q ** 2).toBeCloseTo(4 * r.pipes[1].Q ** 2, 6);
  });

  it('a four-pipe loop converges to a balanced flow distribution', () => {
    const r = hardyCrossLoop([{ K: 1, Q: 8 }, { K: 2, Q: 3 }, { K: 1, Q: -2 }, { K: 3, Q: -7 }]);
    expect(Math.abs(loopHeadImbalance(r.pipes))).toBeLessThan(1e-9);
    expect(r.iterations).toBeLessThan(20);             // quadratic convergence
  });

  it('the Reynolds number classifies the flow regime', () => {
    expect(reynolds(1000, 2, 0.1, 1e-3)).toBeCloseTo(2e5, -3); // turbulent (> 4000)
    expect(reynolds(1000, 0.01, 0.01, 1e-3)).toBeLessThan(2300); // laminar
  });
});
