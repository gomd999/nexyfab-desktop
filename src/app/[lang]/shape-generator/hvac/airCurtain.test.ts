import { describe, it, expect } from 'vitest';
import { size, fanPowerW, summarize, type AirCurtainInput } from './airCurtain';

const base: AirCurtainInput = {
  doorWidthMm: 2000, doorHeightMm: 2500, nozzleWidthMm: 100, pressureDiffPa: 10,
};

describe('size', () => {
  it('required velocity positive', () => {
    expect(size(base).requiredVelocityMS).toBeGreaterThan(0);
  });

  it('higher ΔP → higher velocity', () => {
    const lo = size({ ...base, pressureDiffPa: 5 });
    const hi = size({ ...base, pressureDiffPa: 40 });
    expect(hi.requiredVelocityMS).toBeGreaterThan(lo.requiredVelocityMS);
  });

  it('nozzle area = width × slot', () => {
    const r = size(base);
    expect(r.nozzleAreaM2).toBeCloseTo(2 * 0.1, 5);
  });

  it('airflow = velocity × area', () => {
    const r = size(base);
    expect(r.airflowM3PerS).toBeCloseTo(r.requiredVelocityMS * r.nozzleAreaM2, 5);
  });

  it('m³/h = m³/s × 3600', () => {
    const r = size(base);
    expect(r.airflowM3PerH).toBeCloseTo(r.airflowM3PerS * 3600, 4);
  });

  it('effectiveness between 0 and 0.9', () => {
    const r = size(base);
    expect(r.sealingEffectiveness).toBeGreaterThan(0);
    expect(r.sealingEffectiveness).toBeLessThanOrEqual(0.9);
  });

  it('heat loss reduction = open loss × effectiveness', () => {
    const r = size({ ...base, openDoorHeatLossKW: 50 });
    expect(r.heatLossReductionKW).toBeCloseTo(50 * r.sealingEffectiveness, 5);
  });

  it('no open loss → null reduction', () => {
    expect(size(base).heatLossReductionKW).toBeNull();
  });

  it('zero nozzle → warning', () => {
    expect(size({ ...base, nozzleWidthMm: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('fanPowerW', () => {
  it('positive', () => {
    expect(fanPowerW(size(base))).toBeGreaterThan(0);
  });

  it('lower efficiency → more shaft power', () => {
    const r = size(base);
    expect(fanPowerW(r, 0.4)).toBeGreaterThan(fanPowerW(r, 0.7));
  });
});

describe('summarize', () => {
  it('reports velocity + airflow', () => {
    const r = size(base);
    const s = summarize(r);
    expect(s.requiredVelocityMS).toBe(r.requiredVelocityMS);
    expect(s.airflowM3PerH).toBe(r.airflowM3PerH);
  });
});
