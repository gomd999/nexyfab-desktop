import { describe, it, expect } from 'vitest';
import {
  compute,
  separationMargin,
  summarize,
  type CriticalSpeedInput,
} from './criticalSpeedCalculator';

const base: CriticalSpeedInput = {
  shaftLengthMm: 600,
  youngMpa: 200000,
  shaftDiameterMm: 30,
  discs: [{ massKg: 20, positionMm: 300 }],
};

describe('compute', () => {
  it('single central disc → positive critical speed', () => {
    const r = compute(base);
    expect(r.rayleighRpm).toBeGreaterThan(0);
    expect(r.dunkerleyRpm).toBeGreaterThan(0);
  });

  it('Rayleigh = single-disc speed for one disc', () => {
    const r = compute(base);
    expect(r.rayleighRpm).toBeCloseTo(r.perDiscRpm[0]!, 1);
  });

  it('Dunkerley ≤ Rayleigh (lower bound)', () => {
    const r = compute({
      ...base,
      discs: [{ massKg: 20, positionMm: 200 }, { massKg: 15, positionMm: 400 }],
    });
    expect(r.dunkerleyRpm).toBeLessThanOrEqual(r.rayleighRpm + 1e-6);
  });

  it('heavier disc → lower critical speed', () => {
    const light = compute({ ...base, discs: [{ massKg: 10, positionMm: 300 }] });
    const heavy = compute({ ...base, discs: [{ massKg: 40, positionMm: 300 }] });
    expect(heavy.rayleighRpm).toBeLessThan(light.rayleighRpm);
  });

  it('larger shaft diameter → higher critical speed', () => {
    const thin = compute({ ...base, shaftDiameterMm: 20 });
    const thick = compute({ ...base, shaftDiameterMm: 40 });
    expect(thick.rayleighRpm).toBeGreaterThan(thin.rayleighRpm);
  });

  it('moment of inertia = π/64·d⁴', () => {
    const r = compute(base);
    expect(r.momentOfInertiaMm4).toBeCloseTo((Math.PI / 64) * Math.pow(30, 4), 2);
  });

  it('per-disc speeds reported for each disc', () => {
    const r = compute({
      ...base,
      discs: [{ massKg: 20, positionMm: 200 }, { massKg: 15, positionMm: 400 }],
    });
    expect(r.perDiscRpm).toHaveLength(2);
  });

  it('no discs → warning', () => {
    const r = compute({ ...base, discs: [] });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('separationMargin', () => {
  it('operating well below critical → safe', () => {
    const m = separationMargin(3000, 1500);
    expect(m.ratio).toBeCloseTo(0.5, 6);
    expect(m.safe).toBe(true);
  });

  it('operating near critical → unsafe', () => {
    const m = separationMargin(3000, 3000);
    expect(m.safe).toBe(false);
  });

  it('operating well above critical → safe', () => {
    const m = separationMargin(3000, 6000);
    expect(m.safe).toBe(true);
  });

  it('zero critical → unsafe', () => {
    expect(separationMargin(0, 1000).safe).toBe(false);
  });
});

describe('summarize', () => {
  it('reports both estimates', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.rayleighRpm).toBe(r.rayleighRpm);
    expect(s.dunkerleyRpm).toBe(r.dunkerleyRpm);
  });
});
