import { describe, it, expect } from 'vitest';
import {
  size,
  capacityAtDp,
  summarize,
  type SteamTrapInput,
} from './steamTrapSizing';

const base: SteamTrapInput = {
  heatDutyKW: 100,
  latentHeatKJkg: 2100,
  inletPressureBarG: 5,
};

describe('size', () => {
  it('running load = Q/h_fg × 3600', () => {
    const r = size(base);
    expect(r.runningLoadKgH).toBeCloseTo((100 / 2100) * 3600, 3);
  });

  it('sizing load = running × safety factor', () => {
    const r = size({ ...base, safetyFactor: 3 });
    expect(r.sizingLoadKgH).toBeCloseTo(r.runningLoadKgH * 3, 3);
  });

  it('differential pressure = inlet − back', () => {
    const r = size({ ...base, backPressureBarG: 1 });
    expect(r.differentialPressureBar).toBeCloseTo(4, 6);
  });

  it('capacity coefficient = sizing / √ΔP', () => {
    const r = size(base);
    expect(r.capacityCoefficient).toBeCloseTo(r.sizingLoadKgH / Math.sqrt(5), 3);
  });

  it('higher duty → higher load', () => {
    const lo = size({ ...base, heatDutyKW: 50 });
    const hi = size({ ...base, heatDutyKW: 200 });
    expect(hi.sizingLoadKgH).toBeGreaterThan(lo.sizingLoadKgH);
  });

  it('steam-main → thermodynamic', () => {
    expect(size({ ...base, application: 'steam-main' }).recommendedType).toBe('thermodynamic');
  });

  it('tracing → thermostatic', () => {
    expect(size({ ...base, application: 'tracing' }).recommendedType).toBe('thermostatic');
  });

  it('large process load → float-thermostatic', () => {
    const r = size({ ...base, heatDutyKW: 2000, application: 'process-heater' });
    expect(r.recommendedType).toBe('float-thermostatic');
  });

  it('back-pressure ≥ inlet → warning', () => {
    const r = size({ ...base, backPressureBarG: 6 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zero duty → warning', () => {
    const r = size({ ...base, heatDutyKW: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('capacityAtDp', () => {
  it('capacity ∝ √ΔP', () => {
    const r = size(base);
    const c1 = capacityAtDp(r, 1);
    const c4 = capacityAtDp(r, 4);
    expect(c4).toBeCloseTo(2 * c1, 4);
  });

  it('zero ΔP → 0', () => {
    expect(capacityAtDp(size(base), 0)).toBe(0);
  });
});

describe('summarize', () => {
  it('reports load + type', () => {
    const r = size(base);
    const s = summarize(r);
    expect(s.sizingLoadKgH).toBe(r.sizingLoadKgH);
    expect(s.recommendedType).toBe(r.recommendedType);
  });
});
