import { describe, it, expect } from 'vitest';
import {
  compute,
  minClosureTimeForSurge,
  summarize,
  type WaterHammerInput,
} from './waterHammerSurge';

// Water in steel pipe.
const base: WaterHammerInput = {
  flowVelocityMS: 2,
  pipeLengthMm: 200000, // 200 m
  pipeInnerDiameterMm: 100,
  wallThicknessMm: 5,
  fluidDensityKgM3: 998,
  fluidBulkModulusPa: 2.2e9,
  pipeYoungPa: 200e9,
};

describe('compute', () => {
  it('wave speed in plausible range (~1200-1400 m/s for water/steel)', () => {
    const r = compute(base);
    expect(r.waveSpeedMS).toBeGreaterThan(1000);
    expect(r.waveSpeedMS).toBeLessThan(1500);
  });

  it('critical closure time = 2L/a', () => {
    const r = compute(base);
    expect(r.criticalClosureTimeSec).toBeCloseTo((2 * 200) / r.waveSpeedMS, 5);
  });

  it('Joukowsky surge = ρ·a·Δv', () => {
    const r = compute(base);
    expect(r.joukowskySurgePa).toBeCloseTo(998 * r.waveSpeedMS * 2, 0);
  });

  it('instantaneous closure → full surge', () => {
    const r = compute(base);
    expect(r.actualSurgePa).toBeCloseTo(r.joukowskySurgePa, 0);
    expect(r.isRapidClosure).toBe(true);
  });

  it('slow closure reduces surge (Michaud)', () => {
    const r = compute({ ...base, closureTimeSec: 5 });
    expect(r.actualSurgePa).toBeLessThan(r.joukowskySurgePa);
    expect(r.isRapidClosure).toBe(false);
  });

  it('rapid closure (< critical) → full surge + warning', () => {
    const r = compute({ ...base, closureTimeSec: 0.1 });
    expect(r.isRapidClosure).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('thicker wall → higher wave speed', () => {
    const thin = compute({ ...base, wallThicknessMm: 2 });
    const thick = compute({ ...base, wallThicknessMm: 10 });
    expect(thick.waveSpeedMS).toBeGreaterThan(thin.waveSpeedMS);
  });

  it('higher velocity → higher surge', () => {
    const lo = compute({ ...base, flowVelocityMS: 1 });
    const hi = compute({ ...base, flowVelocityMS: 3 });
    expect(hi.joukowskySurgePa).toBeGreaterThan(lo.joukowskySurgePa);
  });

  it('surge head positive', () => {
    expect(compute(base).surgeHeadM).toBeGreaterThan(0);
  });

  it('zero wall → warning', () => {
    const r = compute({ ...base, wallThicknessMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('minClosureTimeForSurge', () => {
  it('lower target surge → longer closure time', () => {
    const r = compute(base);
    const tFull = minClosureTimeForSurge(base, r.joukowskySurgePa);
    const tHalf = minClosureTimeForSurge(base, r.joukowskySurgePa / 2);
    expect(tHalf).toBeGreaterThan(tFull);
  });

  it('target ≥ full surge → critical time', () => {
    const r = compute(base);
    expect(minClosureTimeForSurge(base, r.joukowskySurgePa * 2)).toBeCloseTo(r.criticalClosureTimeSec, 3);
  });
});

describe('summarize', () => {
  it('reports wave speed + surge', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.waveSpeedMS).toBe(r.waveSpeedMS);
    expect(s.actualSurgePa).toBe(r.actualSurgePa);
  });
});
