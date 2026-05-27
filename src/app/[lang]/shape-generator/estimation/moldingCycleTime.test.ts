import { describe, it, expect } from 'vitest';
import { compute, thinWallSaving, summarize, type MoldingCycleInput } from './moldingCycleTime';

const base: MoldingCycleInput = {
  shotVolumeCm3: 60, injectionRateCm3PerSec: 40, wallThicknessMm: 2.5, cavities: 4,
};

describe('compute', () => {
  it('injection = shot / rate', () => {
    expect(compute(base).injectionSec).toBeCloseTo(60 / 40, 5);
  });

  it('cooling estimated from wall (k·s²)', () => {
    const r = compute({ ...base, coolingConstant: 2.5 });
    expect(r.coolingSec).toBeCloseTo(2.5 * 2.5 * 2.5, 4);
  });

  it('explicit cooling overrides estimate', () => {
    const r = compute({ ...base, coolingTimeSec: 20 });
    expect(r.coolingSec).toBe(20);
  });

  it('total = sum of phases', () => {
    const r = compute(base);
    expect(r.totalCycleSec).toBeCloseTo(r.injectionSec + r.packingSec + r.coolingSec + r.moldMotionSec, 5);
  });

  it('cooling is the dominant fraction', () => {
    expect(compute(base).coolingFraction).toBeGreaterThan(0.3);
  });

  it('parts/hour scales with cavities', () => {
    const c1 = compute({ ...base, cavities: 1 });
    const c4 = compute({ ...base, cavities: 4 });
    expect(c4.partsPerHour).toBeCloseTo(c1.partsPerHour * 4, 4);
  });

  it('thicker wall → much longer cooling (s²)', () => {
    const thin = compute({ ...base, wallThicknessMm: 1.5 });
    const thick = compute({ ...base, wallThicknessMm: 3 });
    expect(thick.coolingSec).toBeGreaterThan(thin.coolingSec * 3);
  });

  it('zero injection rate → warning', () => {
    expect(compute({ ...base, injectionRateCm3PerSec: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('thinWallSaving', () => {
  it('thinner wall saves cycle time', () => {
    const r = thinWallSaving(base, 1.8);
    expect(r.newCycleSec).toBeLessThan(r.oldCycleSec);
    expect(r.savingPercent).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports total + cooling + pph', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.totalCycleSec).toBe(r.totalCycleSec);
    expect(s.partsPerHour).toBe(r.partsPerHour);
  });
});
