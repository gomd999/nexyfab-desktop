import { describe, it, expect } from 'vitest';
import { compute, waterConsumptionL, summarize, type HumidifierInput } from './humidifierLoad';

const steam: HumidifierInput = {
  flowRateM3PerS: 2, supplyHumidityRatio: 0.004, targetHumidityRatio: 0.008,
  supplyTempC: 20, type: 'steam',
};

describe('compute', () => {
  it('dry-air mass flow = Q·ρ', () => {
    expect(compute(steam).dryAirMassFlowKgS).toBeCloseTo(2 * 1.2, 5);
  });

  it('moisture load positive', () => {
    expect(compute(steam).moistureLoadKgH).toBeGreaterThan(0);
  });

  it('water rate (L/h) ≈ moisture (kg/h)', () => {
    const r = compute(steam);
    expect(r.waterRateLPerH).toBeCloseTo(r.moistureLoadKgH, 6);
  });

  it('steam load = moisture × steam enthalpy', () => {
    const r = compute(steam);
    expect(r.steamLoadKW).not.toBeNull();
    expect(r.steamLoadKW!).toBeGreaterThan(0);
    expect(r.evapTempDropC).toBeNull();
  });

  it('evaporative cools the air (temp drop) + no steam load', () => {
    const r = compute({ ...steam, type: 'evaporative' });
    expect(r.evapTempDropC).not.toBeNull();
    expect(r.evapTempDropC!).toBeGreaterThan(0);
    expect(r.steamLoadKW).toBeNull();
  });

  it('evaporative effectiveness caps the gain', () => {
    const r = compute({ ...steam, type: 'evaporative', evapEffectiveness: 0.8 });
    expect(r.effectiveTargetW).toBeLessThan(steam.targetHumidityRatio);
  });

  it('higher target → more moisture', () => {
    const lo = compute({ ...steam, targetHumidityRatio: 0.006 });
    const hi = compute({ ...steam, targetHumidityRatio: 0.012 });
    expect(hi.moistureLoadKgH).toBeGreaterThan(lo.moistureLoadKgH);
  });

  it('target below supply → warning', () => {
    expect(compute({ ...steam, targetHumidityRatio: 0.002 }).warnings.length).toBeGreaterThan(0);
  });

  it('zero flow → warning', () => {
    expect(compute({ ...steam, flowRateM3PerS: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('waterConsumptionL', () => {
  it('rate × hours', () => {
    const r = compute(steam);
    expect(waterConsumptionL(r, 10)).toBeCloseTo(r.waterRateLPerH * 10, 5);
  });
});

describe('summarize', () => {
  it('reports moisture + steam', () => {
    const r = compute(steam);
    const s = summarize(r);
    expect(s.moistureLoadKgH).toBe(r.moistureLoadKgH);
    expect(s.steamLoadKW).toBe(r.steamLoadKW);
  });
});
