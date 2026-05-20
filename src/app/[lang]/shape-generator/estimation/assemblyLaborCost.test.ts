import { describe, it, expect } from 'vitest';
import { estimate, standardTimeSec, summarize, type AssemblyLaborInput } from './assemblyLaborCost';

const base: AssemblyLaborInput = {
  operations: [
    { type: 'screw', count: 4 },
    { type: 'insert', count: 6 },
    { type: 'inspect', count: 1 },
  ],
  labourRatePerHour: 45,
};

describe('estimate', () => {
  it('base time = Σ count × std time', () => {
    expect(estimate(base).baseTimeSec).toBeCloseTo(4 * 8 + 6 * 4 + 1 * 15, 3);
  });

  it('unit time adds fatigue allowance', () => {
    const r = estimate({ ...base, fatigueAllowance: 0.2 });
    expect(r.unitTimeSec).toBeCloseTo(r.baseTimeSec * 1.2, 4);
  });

  it('cost per unit = time/3600 × rate', () => {
    const r = estimate(base);
    expect(r.costPerUnit).toBeCloseTo((r.avgUnitTimeSec / 3600) * 45, 6);
  });

  it('learning curve lowers average unit time', () => {
    const noLearn = estimate({ ...base, batchQuantity: 100, learningRate: 1 });
    const learn = estimate({ ...base, batchQuantity: 100, learningRate: 0.85 });
    expect(learn.avgUnitTimeSec).toBeLessThan(noLearn.avgUnitTimeSec);
  });

  it('more operations → more time', () => {
    const few = estimate({ ...base, operations: [{ type: 'snap', count: 1 }] });
    const many = estimate({ ...base, operations: [{ type: 'screw', count: 20 }] });
    expect(many.baseTimeSec).toBeGreaterThan(few.baseTimeSec);
  });

  it('time override respected', () => {
    const r = estimate({ ...base, operations: [{ type: 'screw', count: 1, timeOverrideSec: 100 }] });
    expect(r.baseTimeSec).toBe(100);
  });

  it('total batch time = avg × n', () => {
    const r = estimate({ ...base, batchQuantity: 50 });
    expect(r.totalBatchTimeSec).toBeCloseTo(r.avgUnitTimeSec * 50, 4);
  });

  it('unknown op → warning', () => {
    expect(estimate({ ...base, operations: [{ type: 'XYZ' as never, count: 1 }] }).warnings.length).toBeGreaterThan(0);
  });

  it('empty ops → warning', () => {
    expect(estimate({ ...base, operations: [] }).warnings.length).toBeGreaterThan(0);
  });
});

describe('standardTimeSec', () => {
  it('screw > snap', () => {
    expect(standardTimeSec('screw')).toBeGreaterThan(standardTimeSec('snap'));
  });
});

describe('summarize', () => {
  it('reports cost + time', () => {
    const r = estimate(base);
    const s = summarize(r);
    expect(s.costPerUnit).toBe(r.costPerUnit);
    expect(s.unitTimeSec).toBe(r.unitTimeSec);
  });
});
