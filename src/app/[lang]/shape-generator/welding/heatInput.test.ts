import { describe, it, expect } from 'vitest';
import { compute, travelSpeedForHeatInput, summarize, type HeatInputInput } from './heatInput';

const base: HeatInputInput = {
  process: 'GMAW', voltageV: 28, currentA: 250, travelSpeedMmPerMin: 400, plateThicknessMm: 12,
};

describe('compute', () => {
  it('heat input = η·V·I·60 / (v·1000)', () => {
    const r = compute(base);
    expect(r.heatInputKJPerMm).toBeCloseTo(0.8 * 28 * 250 * 60 / (400 * 1000), 5);
  });

  it('GMAW arc efficiency = 0.8', () => {
    expect(compute(base).arcEfficiency).toBeCloseTo(0.8, 5);
  });

  it('SAW has higher efficiency than GTAW', () => {
    const saw = compute({ ...base, process: 'SAW' });
    const gtaw = compute({ ...base, process: 'GTAW' });
    expect(saw.heatInputKJPerMm).toBeGreaterThan(gtaw.heatInputKJPerMm);
  });

  it('faster travel → less heat input', () => {
    const slow = compute({ ...base, travelSpeedMmPerMin: 200 });
    const fast = compute({ ...base, travelSpeedMmPerMin: 600 });
    expect(fast.heatInputKJPerMm).toBeLessThan(slow.heatInputKJPerMm);
  });

  it('thick plate → 3D heat flow', () => {
    expect(compute({ ...base, plateThicknessMm: 40 }).heatFlowMode).toBe('3D');
  });

  it('thin plate → 2D heat flow', () => {
    expect(compute({ ...base, plateThicknessMm: 3 }).heatFlowMode).toBe('2D');
  });

  it('positive t8/5 and cooling rate', () => {
    const r = compute(base);
    expect(r.t8_5Seconds).toBeGreaterThan(0);
    expect(r.coolingRateCPerS).toBeGreaterThan(0);
  });

  it('preheat lengthens t8/5 (slower cooling)', () => {
    const cold = compute({ ...base, plateThicknessMm: 40, preheatTempC: 20 });
    const hot = compute({ ...base, plateThicknessMm: 40, preheatTempC: 150 });
    expect(hot.t8_5Seconds).toBeGreaterThan(cold.t8_5Seconds);
  });

  it('cooling rate = 300 / t8_5', () => {
    const r = compute(base);
    expect(r.coolingRateCPerS).toBeCloseTo(300 / r.t8_5Seconds, 5);
  });

  it('zero travel speed → warning', () => {
    expect(compute({ ...base, travelSpeedMmPerMin: 0 }).warnings.length).toBeGreaterThan(0);
  });

  it('efficiency override respected', () => {
    expect(compute({ ...base, efficiencyOverride: 0.5 }).arcEfficiency).toBe(0.5);
  });
});

describe('travelSpeedForHeatInput', () => {
  it('inverts heat input formula', () => {
    const v = travelSpeedForHeatInput('GMAW', 28, 250, base.travelSpeedMmPerMin === 400 ? compute(base).heatInputKJPerMm : 1);
    expect(v).toBeCloseTo(400, 2);
  });
});

describe('summarize', () => {
  it('reports heat input + t8/5 + mode', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.heatInputKJPerMm).toBe(r.heatInputKJPerMm);
    expect(s.heatFlowMode).toBe(r.heatFlowMode);
  });
});
