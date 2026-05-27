import { describe, it, expect } from 'vitest';
import { size, capacityForSize, summarize, type FanCoilInput } from './fanCoilUnit';

const base: FanCoilInput = {
  sensibleLoadKW: 3.0, totalLoadKW: 4.0, supplyAirDeltaTC: 10, waterDeltaTC: 5,
};

describe('size', () => {
  it('airflow = Q_sens / (ρ·cp·ΔT)', () => {
    const r = size(base);
    expect(r.airflowM3PerS).toBeCloseTo(3.0 / (1.2 * 1.006 * 10), 5);
  });

  it('water flow = Q_total / (cp_w·ΔT)', () => {
    const r = size(base);
    expect(r.waterFlowLPerS).toBeCloseTo(4.0 / (4.186 * 5), 5);
  });

  it('selects an FCU size', () => {
    expect(size(base).selectedSizeCfm).toBeGreaterThan(0);
  });

  it('bigger sensible load → more airflow', () => {
    const lo = size({ ...base, sensibleLoadKW: 1.5 });
    const hi = size({ ...base, sensibleLoadKW: 6 });
    expect(hi.airflowM3PerS).toBeGreaterThan(lo.airflowM3PerS);
  });

  it('within capacity when load ≤ band nominal', () => {
    expect(size(base).withinCapacity).toBe(true);
  });

  it('overloaded → warning', () => {
    const r = size({ sensibleLoadKW: 1.0, totalLoadKW: 20, supplyAirDeltaTC: 10, waterDeltaTC: 5 });
    expect(r.withinCapacity).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('SHR = sensible/total', () => {
    const r = size(base);
    expect(r.sensibleHeatRatio).toBeCloseTo(0.75, 5);
  });

  it('m³/h = m³/s × 3600', () => {
    const r = size(base);
    expect(r.airflowM3PerH).toBeCloseTo(r.airflowM3PerS * 3600, 4);
  });

  it('zero water ΔT → warning', () => {
    expect(size({ ...base, waterDeltaTC: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('capacityForSize', () => {
  it('returns band capacity', () => {
    expect(capacityForSize(400)).toBe(3.5);
  });

  it('unknown size → null', () => {
    expect(capacityForSize(999)).toBeNull();
  });
});

describe('summarize', () => {
  it('reports airflow + water + size', () => {
    const r = size(base);
    const s = summarize(r);
    expect(s.selectedSizeCfm).toBe(r.selectedSizeCfm);
    expect(s.waterFlowLPerS).toBe(r.waterFlowLPerS);
  });
});
