import { describe, it, expect } from 'vitest';
import {
  apply,
  speedForFlow,
  vfdSavingW,
  summarize,
  type FanState,
} from './fanAffinityLaws';

const base: FanState = {
  flowM3PerS: 2,
  pressurePa: 500,
  powerW: 1500,
  speedRpm: 1000,
  diameterMm: 400,
};

describe('apply', () => {
  it('doubling speed doubles flow', () => {
    const r = apply({ base, driver: 'speed', newSpeedRpm: 2000 });
    expect(r.flowM3PerS).toBeCloseTo(4, 6);
  });

  it('doubling speed quadruples pressure', () => {
    const r = apply({ base, driver: 'speed', newSpeedRpm: 2000 });
    expect(r.pressurePa).toBeCloseTo(2000, 6);
  });

  it('doubling speed → 8× power', () => {
    const r = apply({ base, driver: 'speed', newSpeedRpm: 2000 });
    expect(r.powerW).toBeCloseTo(12000, 6);
  });

  it('halving speed → ⅛ power', () => {
    const r = apply({ base, driver: 'speed', newSpeedRpm: 500 });
    expect(r.powerW).toBeCloseTo(1500 / 8, 6);
  });

  it('diameter driver works', () => {
    const r = apply({ base, driver: 'diameter', newDiameterMm: 800 });
    expect(r.flowM3PerS).toBeCloseTo(4, 6);
    expect(r.powerW).toBeCloseTo(12000, 6);
  });

  it('missing new speed → warning', () => {
    const r = apply({ base, driver: 'speed' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('missing diameter → warning', () => {
    const r = apply({ base: { ...base, diameterMm: undefined }, driver: 'diameter', newDiameterMm: 500 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('speedForFlow', () => {
  it('target flow → proportional speed', () => {
    const r = speedForFlow(base, 1);
    expect(r.speedRpm).toBeCloseTo(500, 6);
  });

  it('power scales cubically with flow ratio', () => {
    const r = speedForFlow(base, 1); // half flow
    expect(r.powerW).toBeCloseTo(1500 / 8, 6);
  });
});

describe('vfdSavingW', () => {
  it('VFD saves power at reduced flow', () => {
    expect(vfdSavingW(base, 1)).toBeGreaterThan(0);
  });

  it('no saving at full flow', () => {
    expect(vfdSavingW(base, 2)).toBeCloseTo(0, 6);
  });

  it('more turndown → more saving', () => {
    const small = vfdSavingW(base, 1.5);
    const big = vfdSavingW(base, 0.5);
    expect(big).toBeGreaterThan(small);
  });
});

describe('summarize', () => {
  it('reports ratio + flow + power', () => {
    const r = apply({ base, driver: 'speed', newSpeedRpm: 2000 });
    const s = summarize(r);
    expect(s.ratio).toBe(r.ratio);
    expect(s.powerW).toBe(r.powerW);
  });
});
