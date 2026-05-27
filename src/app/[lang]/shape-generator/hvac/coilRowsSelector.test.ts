import { describe, it, expect } from 'vitest';
import {
  select,
  crossFlowEffectiveness,
  summarize,
  type CoilRowsInput,
} from './coilRowsSelector';

const base: CoilRowsInput = {
  airFlowM3PerS: 1.0,
  enteringAirC: 27,
  targetLeavingAirC: 13,
  enteringWaterC: 6,
  waterFlowKgS: 0.8,
  uaPerRowWperK: 800,
};

describe('select', () => {
  it('selects a row count that meets the target', () => {
    const r = select(base);
    expect(r.selectedRows).not.toBeNull();
    expect(r.achievableLeavingAirC).toBeLessThanOrEqual(base.targetLeavingAirC + 1e-6);
  });

  it('deeper target (colder) → more rows', () => {
    const shallow = select({ ...base, targetLeavingAirC: 18 });
    const deep = select({ ...base, targetLeavingAirC: 11 });
    expect(deep.selectedRows!).toBeGreaterThanOrEqual(shallow.selectedRows!);
  });

  it('effectiveness between 0 and 1', () => {
    const r = select(base);
    expect(r.effectiveness).toBeGreaterThan(0);
    expect(r.effectiveness).toBeLessThanOrEqual(1);
  });

  it('capacity positive', () => {
    expect(select(base).capacityKW).toBeGreaterThan(0);
  });

  it('higher UA/row → fewer rows needed', () => {
    const low = select({ ...base, uaPerRowWperK: 400 });
    const high = select({ ...base, uaPerRowWperK: 1600 });
    expect(high.selectedRows!).toBeLessThanOrEqual(low.selectedRows!);
  });

  it('unreachable target → null + warning', () => {
    const r = select({ ...base, targetLeavingAirC: 6.1, uaPerRowWperK: 100, maxRows: 2 });
    expect(r.selectedRows).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('capacity ratio Cr between 0 and 1', () => {
    const r = select(base);
    expect(r.capacityRatioCr).toBeGreaterThan(0);
    expect(r.capacityRatioCr).toBeLessThanOrEqual(1);
  });

  it('zero water flow → warning', () => {
    const r = select({ ...base, waterFlowKgS: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('crossFlowEffectiveness', () => {
  it('rises with NTU', () => {
    expect(crossFlowEffectiveness(3, 0.5)).toBeGreaterThan(crossFlowEffectiveness(1, 0.5));
  });

  it('Cr→0 reduces to 1−e^(−NTU)', () => {
    expect(crossFlowEffectiveness(2, 0)).toBeCloseTo(1 - Math.exp(-2), 5);
  });

  it('zero NTU → 0', () => {
    expect(crossFlowEffectiveness(0, 0.5)).toBe(0);
  });

  it('bounded by 1', () => {
    expect(crossFlowEffectiveness(20, 0.3)).toBeLessThanOrEqual(1);
  });
});

describe('summarize', () => {
  it('reports rows + effectiveness + capacity', () => {
    const r = select(base);
    const s = summarize(r);
    expect(s.selectedRows).toBe(r.selectedRows);
    expect(s.capacityKW).toBe(r.capacityKW);
  });
});
