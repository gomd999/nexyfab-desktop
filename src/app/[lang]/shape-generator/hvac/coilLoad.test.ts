import { describe, it, expect } from 'vitest';
import {
  compute,
  sensibleShortcutW,
  latentShortcutW,
  summarize,
  type CoilLoadInput,
} from './coilLoad';

// Cooling coil: 27°C/0.012 → 13°C/0.009.
const cooling: CoilLoadInput = {
  flowRateM3PerS: 1.0,
  entering: { dryBulbC: 27, humidityRatio: 0.012, enthalpyKJkg: 57.5 },
  leaving: { dryBulbC: 13, humidityRatio: 0.009, enthalpyKJkg: 36.0 },
};

describe('compute', () => {
  it('mass flow = Q·ρ', () => {
    const r = compute(cooling);
    expect(r.massFlowKgS).toBeCloseTo(1.2, 6);
  });

  it('sensible load positive for cooling', () => {
    expect(compute(cooling).sensibleKW).toBeGreaterThan(0);
  });

  it('latent load positive when dehumidifying', () => {
    expect(compute(cooling).latentKW).toBeGreaterThan(0);
  });

  it('total ≈ sensible + latent (approx, enthalpy basis)', () => {
    const r = compute(cooling);
    expect(r.totalKW).toBeGreaterThan(0);
    expect(r.totalKW).toBeCloseTo(r.massFlowKgS * (57.5 - 36.0), 5);
  });

  it('SHR between 0 and 1 for cooling', () => {
    const r = compute(cooling);
    expect(r.sensibleHeatRatio).toBeGreaterThan(0);
    expect(r.sensibleHeatRatio).toBeLessThanOrEqual(1.01);
  });

  it('cooling mode detected', () => {
    expect(compute(cooling).mode).toBe('cooling');
  });

  it('heating mode when leaving warmer', () => {
    const heating: CoilLoadInput = {
      flowRateM3PerS: 1,
      entering: { dryBulbC: 15, humidityRatio: 0.005, enthalpyKJkg: 27 },
      leaving: { dryBulbC: 30, humidityRatio: 0.005, enthalpyKJkg: 43 },
    };
    expect(compute(heating).mode).toBe('heating');
  });

  it('condensate positive when dehumidifying', () => {
    expect(compute(cooling).condensateKgH).toBeGreaterThan(0);
  });

  it('no condensate when W unchanged', () => {
    const r = compute({
      flowRateM3PerS: 1,
      entering: { dryBulbC: 27, humidityRatio: 0.009, enthalpyKJkg: 50 },
      leaving: { dryBulbC: 18, humidityRatio: 0.009, enthalpyKJkg: 41 },
    });
    expect(r.condensateKgH).toBe(0);
  });

  it('higher flow → higher load', () => {
    const low = compute({ ...cooling, flowRateM3PerS: 0.5 });
    const high = compute({ ...cooling, flowRateM3PerS: 2 });
    expect(high.totalKW).toBeGreaterThan(low.totalKW);
  });

  it('zero flow → warning', () => {
    const r = compute({ ...cooling, flowRateM3PerS: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('shortcuts', () => {
  it('sensible 1.23·Lps·ΔT', () => {
    expect(sensibleShortcutW(1000, 14)).toBeCloseTo(1.23 * 1000 * 14, 6);
  });

  it('latent 3010·Lps·ΔW', () => {
    expect(latentShortcutW(1000, 0.003)).toBeCloseTo(3010 * 1000 * 0.003, 6);
  });
});

describe('summarize', () => {
  it('reports total + SHR + mode', () => {
    const r = compute(cooling);
    const s = summarize(r);
    expect(s.totalKW).toBe(r.totalKW);
    expect(s.mode).toBe('cooling');
  });
});
