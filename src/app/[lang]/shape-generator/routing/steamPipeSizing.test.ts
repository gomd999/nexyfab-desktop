import { describe, it, expect } from 'vitest';
import { size, velocityAtNb, summarize, type SteamPipeInput } from './steamPipeSizing';

const base: SteamPipeInput = {
  massFlowKgH: 1000, specificVolumeM3Kg: 0.19, service: 'saturated',
};

describe('size', () => {
  it('volume flow = m·v/3600', () => {
    expect(size(base).volumeFlowM3S).toBeCloseTo((1000 * 0.19) / 3600, 6);
  });

  it('target velocity by service', () => {
    expect(size({ ...base, service: 'saturated' }).targetVelocityMS).toBe(30);
    expect(size({ ...base, service: 'superheated' }).targetVelocityMS).toBe(50);
  });

  it('selects a standard NB ≥ ideal bore', () => {
    const r = size(base);
    expect(r.selectedNbMm).toBeGreaterThanOrEqual(Math.floor(r.idealBoreMm));
  });

  it('actual velocity computed at selected NB', () => {
    const r = size(base);
    expect(r.actualVelocityMS).toBeCloseTo(velocityAtNb(r.volumeFlowM3S, r.selectedNbMm), 5);
  });

  it('higher flow → larger bore', () => {
    const lo = size({ ...base, massFlowKgH: 500 });
    const hi = size({ ...base, massFlowKgH: 5000 });
    expect(hi.selectedNbMm).toBeGreaterThan(lo.selectedNbMm);
  });

  it('wet steam uses lower target velocity than superheated', () => {
    expect(size({ ...base, service: 'wet' }).targetVelocityMS)
      .toBeLessThan(size({ ...base, service: 'superheated' }).targetVelocityMS);
  });

  it('velocity override respected', () => {
    expect(size({ ...base, targetVelocityOverrideMS: 25 }).targetVelocityMS).toBe(25);
  });

  it('huge flow exceeds 300 NB → warning', () => {
    expect(size({ ...base, massFlowKgH: 5_000_000 }).warnings.length).toBeGreaterThan(0);
  });

  it('zero flow → warning', () => {
    expect(size({ ...base, massFlowKgH: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('velocityAtNb', () => {
  it('smaller bore → higher velocity', () => {
    expect(velocityAtNb(0.05, 25)).toBeGreaterThan(velocityAtNb(0.05, 50));
  });
});

describe('summarize', () => {
  it('reports NB + velocity', () => {
    const r = size(base);
    const s = summarize(r);
    expect(s.selectedNbMm).toBe(r.selectedNbMm);
    expect(s.actualVelocityMS).toBe(r.actualVelocityMS);
  });
});
