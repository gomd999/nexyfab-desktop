import { describe, it, expect } from 'vitest';
import {
  extrapolateLoad,
  gridConvergenceIndex,
  recommendedSafetyFactor,
  summarize,
  type BucklingRun,
} from './bucklingLoadExtrapolator';

describe('extrapolateLoad', () => {
  it('empty runs → zero', () => {
    const r = extrapolateLoad([]);
    expect(r.extrapolatedLoadFactor).toBe(0);
    expect(r.needsMoreRefinement).toBe(true);
  });

  it('single run → that load factor', () => {
    const r = extrapolateLoad([{ meshSize: 10, dofCount: 100, loadFactor: 5 }]);
    expect(r.extrapolatedLoadFactor).toBe(5);
    expect(r.needsMoreRefinement).toBe(true);
  });

  it('two runs → Richardson extrapolation', () => {
    const runs: BucklingRun[] = [
      { meshSize: 10, dofCount: 100, loadFactor: 5.4 },
      { meshSize: 5, dofCount: 400, loadFactor: 5.1 },
    ];
    const r = extrapolateLoad(runs, { convergenceOrder: 2, convergenceTolerance: 0.02 });
    expect(r.extrapolatedLoadFactor).toBeLessThan(5.1);
  });

  it('relative changes reported', () => {
    const runs: BucklingRun[] = [
      { meshSize: 10, dofCount: 100, loadFactor: 6 },
      { meshSize: 5, dofCount: 400, loadFactor: 5 },
      { meshSize: 2.5, dofCount: 1600, loadFactor: 4.9 },
    ];
    const r = extrapolateLoad(runs);
    expect(r.relativeChanges).toHaveLength(2);
  });

  it('converged when small relative change', () => {
    const runs: BucklingRun[] = [
      { meshSize: 5, dofCount: 1000, loadFactor: 5.01 },
      { meshSize: 2.5, dofCount: 4000, loadFactor: 5.005 },
    ];
    const r = extrapolateLoad(runs, { convergenceOrder: 2, convergenceTolerance: 0.01 });
    expect(r.converged).toBe(true);
  });

  it('large change → needsMoreRefinement', () => {
    const runs: BucklingRun[] = [
      { meshSize: 10, dofCount: 100, loadFactor: 6 },
      { meshSize: 5, dofCount: 400, loadFactor: 4 },
    ];
    const r = extrapolateLoad(runs, { convergenceOrder: 2, convergenceTolerance: 0.02 });
    expect(r.needsMoreRefinement).toBe(true);
  });

  it('estimatedRate reported for ≥ 3 runs', () => {
    const runs: BucklingRun[] = [
      { meshSize: 10, dofCount: 100, loadFactor: 6 },
      { meshSize: 5, dofCount: 400, loadFactor: 5.5 },
      { meshSize: 2.5, dofCount: 1600, loadFactor: 5.1 },
    ];
    const r = extrapolateLoad(runs);
    expect(r.estimatedRate).not.toBe(0);
  });
});

describe('gridConvergenceIndex', () => {
  it('two runs → finite GCI', () => {
    const runs: BucklingRun[] = [
      { meshSize: 10, dofCount: 100, loadFactor: 5 },
      { meshSize: 5, dofCount: 400, loadFactor: 4.95 },
    ];
    const c = gridConvergenceIndex(runs);
    expect(c.gci).toBeGreaterThan(0);
  });

  it('GCI < 5% accepted', () => {
    const runs: BucklingRun[] = [
      { meshSize: 10, dofCount: 100, loadFactor: 5.001 },
      { meshSize: 5, dofCount: 400, loadFactor: 5.000 },
    ];
    const c = gridConvergenceIndex(runs);
    expect(c.acceptable).toBe(true);
  });

  it('large discrepancy → high GCI', () => {
    const runs: BucklingRun[] = [
      { meshSize: 10, dofCount: 100, loadFactor: 6 },
      { meshSize: 5, dofCount: 400, loadFactor: 4 },
    ];
    expect(gridConvergenceIndex(runs).acceptable).toBe(false);
  });

  it('insufficient runs → not acceptable', () => {
    expect(gridConvergenceIndex([{ meshSize: 10, dofCount: 100, loadFactor: 5 }]).acceptable).toBe(false);
  });
});

describe('recommendedSafetyFactor', () => {
  it('base factor 1.5 when GCI 0', () => {
    expect(recommendedSafetyFactor(10, 0).factor).toBeCloseTo(1.5, 5);
  });

  it('higher GCI → higher safety factor', () => {
    const low = recommendedSafetyFactor(10, 0).factor;
    const high = recommendedSafetyFactor(10, 0.5).factor;
    expect(high).toBeGreaterThan(low);
  });

  it('allowableLoad = extrap / factor', () => {
    const r = recommendedSafetyFactor(10, 0.1);
    expect(r.allowableLoad).toBeCloseTo(10 / r.factor, 5);
  });
});

describe('summarize', () => {
  it('reports load + converged', () => {
    const runs: BucklingRun[] = [
      { meshSize: 10, dofCount: 100, loadFactor: 5.01 },
      { meshSize: 5, dofCount: 400, loadFactor: 5.005 },
    ];
    const r = extrapolateLoad(runs);
    const s = summarize(runs, r);
    expect(s.runCount).toBe(2);
    expect(s.extrapolatedLoadFactor).toBe(r.extrapolatedLoadFactor);
  });
});
