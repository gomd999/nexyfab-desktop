import { describe, it, expect } from 'vitest';
import {
  size,
  thermalGrowthMm,
  loopStressMpa,
  summarize,
  type ExpansionLoopInput,
} from './thermalExpansionLoop';

const base: ExpansionLoopInput = {
  runLengthMm: 30000,     // 30 m run
  ctePerK: 12e-6,         // steel
  deltaTempC: 100,
  outerDiameterMm: 168.3,
  youngMpa: 200000,
  allowableStressMpa: 150,
};

describe('size', () => {
  it('thermal growth = α·L·ΔT', () => {
    const r = size(base);
    expect(r.thermalGrowthMm).toBeCloseTo(12e-6 * 30000 * 100, 5);
  });

  it('loop leg height positive', () => {
    expect(size(base).loopLegHeightMm).toBeGreaterThan(0);
  });

  it('loop width = H/2', () => {
    const r = size(base);
    expect(r.loopWidthMm).toBeCloseTo(r.loopLegHeightMm / 2, 6);
  });

  it('more growth → taller loop', () => {
    const cool = size({ ...base, deltaTempC: 50 });
    const hot = size({ ...base, deltaTempC: 200 });
    expect(hot.loopLegHeightMm).toBeGreaterThan(cool.loopLegHeightMm);
  });

  it('higher allowable stress → smaller loop', () => {
    const low = size({ ...base, allowableStressMpa: 100 });
    const high = size({ ...base, allowableStressMpa: 250 });
    expect(high.loopLegHeightMm).toBeLessThan(low.loopLegHeightMm);
  });

  it('anchor force computed when I provided', () => {
    const r = size({ ...base, momentOfInertiaMm4: 1.2e7 });
    expect(r.anchorForceN).not.toBeNull();
    expect(r.anchorForceN!).toBeGreaterThan(0);
  });

  it('no I → null anchor force', () => {
    expect(size(base).anchorForceN).toBeNull();
  });

  it('developed extra length = 2H + W', () => {
    const r = size(base);
    expect(r.developedExtraLengthMm).toBeCloseTo(2 * r.loopLegHeightMm + r.loopWidthMm, 5);
  });

  it('zero allowable stress → warning', () => {
    const r = size({ ...base, allowableStressMpa: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('thermalGrowthMm', () => {
  it('matches α·L·ΔT', () => {
    expect(thermalGrowthMm(10000, 12e-6, 80)).toBeCloseTo(12e-6 * 10000 * 80, 6);
  });
});

describe('loopStressMpa', () => {
  it('round-trips with size (stress ≈ allowable at sized H)', () => {
    const r = size(base);
    const stress = loopStressMpa(base, r.loopLegHeightMm);
    expect(stress).toBeCloseTo(base.allowableStressMpa, 0);
  });

  it('shorter leg → higher stress', () => {
    expect(loopStressMpa(base, 500)).toBeGreaterThan(loopStressMpa(base, 2000));
  });
});

describe('summarize', () => {
  it('reports growth + loop dims', () => {
    const r = size(base);
    const s = summarize(r);
    expect(s.thermalGrowthMm).toBe(r.thermalGrowthMm);
    expect(s.loopLegHeightMm).toBe(r.loopLegHeightMm);
  });
});
