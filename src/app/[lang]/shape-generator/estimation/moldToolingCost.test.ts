import { describe, it, expect } from 'vitest';
import { estimate, cavityCostCurve, summarize, type MoldToolingInput } from './moldToolingCost';

const base: MoldToolingInput = {
  cavities: 4, complexity: 3, partEnvelopeCm3: 200,
  shopRatePerHour: 80, designHours: 40, designRatePerHour: 70,
};

describe('estimate', () => {
  it('total is sum of components', () => {
    const r = estimate(base);
    expect(r.totalToolCost).toBeCloseTo(
      r.moldBaseCost + r.cavitySteelCost + r.machiningCost + r.designCost + r.featuresCost + r.finishingCost, 4);
  });

  it('more cavities → higher machining + steel', () => {
    const c2 = estimate({ ...base, cavities: 2 });
    const c8 = estimate({ ...base, cavities: 8 });
    expect(c8.machiningCost).toBeGreaterThan(c2.machiningCost);
    expect(c8.cavitySteelCost).toBeGreaterThan(c2.cavitySteelCost);
  });

  it('higher complexity → more machining', () => {
    const lo = estimate({ ...base, complexity: 1 });
    const hi = estimate({ ...base, complexity: 5 });
    expect(hi.machiningCost).toBeGreaterThan(lo.machiningCost);
  });

  it('sliders + lifters add feature cost', () => {
    const none = estimate(base);
    const withF = estimate({ ...base, sliders: 2, lifters: 1 });
    expect(withF.featuresCost).toBeGreaterThan(none.featuresCost);
  });

  it('mirror polish costs more than standard', () => {
    const std = estimate({ ...base, polishGrade: 'standard' });
    const mir = estimate({ ...base, polishGrade: 'mirror' });
    expect(mir.finishingCost).toBeGreaterThan(std.finishingCost);
  });

  it('per-part amortisation over volume', () => {
    const r = estimate({ ...base, expectedVolume: 100000 });
    expect(r.toolCostPerPart).toBeCloseTo(r.totalToolCost / 100000, 8);
  });

  it('no volume → null per-part', () => {
    expect(estimate(base).toolCostPerPart).toBeNull();
  });

  it('complexity clamped + warning', () => {
    expect(estimate({ ...base, complexity: 9 }).warnings.length).toBeGreaterThan(0);
  });

  it('zero cavities → defaults to 1 + warning', () => {
    expect(estimate({ ...base, cavities: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('cavityCostCurve', () => {
  it('returns per-part for each cavity count', () => {
    const r = cavityCostCurve({ ...base, expectedVolume: 500000 }, [1, 2, 4, 8]);
    expect(r).toHaveLength(4);
    expect(r.every(x => x.perPart != null)).toBe(true);
  });
});

describe('summarize', () => {
  it('reports total + machining', () => {
    const r = estimate(base);
    const s = summarize(r);
    expect(s.totalToolCost).toBe(r.totalToolCost);
    expect(s.machiningCost).toBe(r.machiningCost);
  });
});
