import { describe, it, expect } from 'vitest';
import { compute, biggestLoss, summarize, type OeeInput } from './oee';

// 480 min planned, 60 min down → 420 run. Ideal 1.0 s/part, 20000 parts,
// 19500 good.
const base: OeeInput = {
  plannedProductionTimeMin: 480, downtimeMin: 60, idealCycleTimeSec: 1.0,
  totalCount: 20000, goodCount: 19500,
};

describe('compute', () => {
  it('availability = runTime / planned', () => {
    expect(compute(base).availability).toBeCloseTo(420 / 480, 5);
  });

  it('performance = ideal·count / runTime', () => {
    const r = compute(base);
    expect(r.performance).toBeCloseTo((1.0 / 60 * 20000) / 420, 5);
  });

  it('quality = good / total', () => {
    expect(compute(base).quality).toBeCloseTo(19500 / 20000, 5);
  });

  it('OEE = A·P·Q', () => {
    const r = compute(base);
    expect(r.oee).toBeCloseTo(r.availability * r.performance * r.quality, 5);
  });

  it('runTime = planned − downtime', () => {
    expect(compute(base).runTimeMin).toBe(420);
  });

  it('world-class when OEE ≥ 0.85', () => {
    const wc = compute({ plannedProductionTimeMin: 480, downtimeMin: 24, idealCycleTimeSec: 1.0, totalCount: 27000, goodCount: 26973 });
    expect(wc.oee).toBeGreaterThanOrEqual(0.85);
    expect(wc.worldClass).toBe(true);
  });

  it('performance capped at 1 and warns when ideal understated', () => {
    const r = compute({ ...base, idealCycleTimeSec: 5 });
    expect(r.performance).toBeLessThanOrEqual(1);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('good > total → warning', () => {
    expect(compute({ ...base, goodCount: 21000 }).warnings.length).toBeGreaterThan(0);
  });

  it('more downtime → lower availability', () => {
    const lo = compute({ ...base, downtimeMin: 30 });
    const hi = compute({ ...base, downtimeMin: 120 });
    expect(hi.availability).toBeLessThan(lo.availability);
  });
});

describe('biggestLoss', () => {
  it('flags the smallest factor', () => {
    const r = compute({ plannedProductionTimeMin: 480, downtimeMin: 200, idealCycleTimeSec: 1.0, totalCount: 16000, goodCount: 15900 });
    expect(biggestLoss(r)).toBe('availability');
  });
});

describe('summarize', () => {
  it('reports oee + bottleneck', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.oee).toBe(r.oee);
    expect(['availability', 'performance', 'quality']).toContain(s.bottleneck);
  });
});
