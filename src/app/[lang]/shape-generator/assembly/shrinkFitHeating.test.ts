import { describe, it, expect } from 'vitest';
import {
  compute,
  diametralExpansion,
  suggestMethod,
  summarize,
  type ShrinkFitInput,
} from './shrinkFitHeating';

// Steel hub (α ≈ 12e-6/K) onto steel shaft.
const base: ShrinkFitInput = {
  nominalDiameterMm: 100,
  diametralInterferenceMm: 0.05,
  hubCTE_perK: 12e-6,
  shaftCTE_perK: 12e-6,
};

describe('compute', () => {
  it('heat-hub: ΔT = (δ+c)/(α·d)', () => {
    const r = compute(base);
    const expected = (0.05 + 0.02) / (12e-6 * 100);
    expect(r.requiredDeltaTHeatC).toBeCloseTo(expected, 3);
  });

  it('hub target = ambient + ΔT', () => {
    const r = compute(base);
    expect(r.hubTargetTempC).toBeCloseTo(20 + r.requiredDeltaTHeatC!, 3);
  });

  it('cool-shaft path computes cooling ΔT', () => {
    const r = compute({ ...base, method: 'cool-shaft' });
    expect(r.requiredDeltaTCoolC).not.toBeNull();
    expect(r.shaftTargetTempC!).toBeLessThan(20);
  });

  it('both method splits interference', () => {
    const heatOnly = compute({ ...base, method: 'heat-hub' });
    const both = compute({ ...base, method: 'both' });
    expect(both.requiredDeltaTHeatC!).toBeCloseTo(heatOnly.requiredDeltaTHeatC! / 2, 3);
  });

  it('larger interference → higher ΔT', () => {
    const low = compute({ ...base, diametralInterferenceMm: 0.05 });
    const high = compute({ ...base, diametralInterferenceMm: 0.15 });
    expect(high.requiredDeltaTHeatC!).toBeGreaterThan(low.requiredDeltaTHeatC!);
  });

  it('infeasible when target exceeds oven limit', () => {
    const r = compute({ ...base, diametralInterferenceMm: 2, ovenLimitC: 300 });
    expect(r.feasible).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('feasible for modest interference', () => {
    expect(compute(base).feasible).toBe(true);
  });

  it('zero diameter → warning', () => {
    const r = compute({ ...base, nominalDiameterMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('diametralExpansion', () => {
  it('Δd = α·d·ΔT', () => {
    expect(diametralExpansion(100, 12e-6, 100)).toBeCloseTo(0.12, 6);
  });

  it('zero ΔT → no expansion', () => {
    expect(diametralExpansion(100, 12e-6, 0)).toBe(0);
  });
});

describe('suggestMethod', () => {
  it('modest interference → heat-hub', () => {
    expect(suggestMethod(base)).toBe('heat-hub');
  });

  it('huge interference exceeding oven → both or cool', () => {
    const m = suggestMethod({ ...base, diametralInterferenceMm: 1.5, ovenLimitC: 250 });
    expect(['cool-shaft', 'both']).toContain(m);
  });
});

describe('summarize', () => {
  it('reports method + feasibility', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.method).toBe('heat-hub');
    expect(s.feasible).toBe(r.feasible);
  });
});
