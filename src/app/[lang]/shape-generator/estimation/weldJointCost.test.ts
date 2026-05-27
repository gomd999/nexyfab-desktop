import { describe, it, expect } from 'vitest';
import { estimate, grooveArea, summarize, type WeldJointCostInput } from './weldJointCost';

const base: WeldJointCostInput = {
  jointType: 'single-V', thicknessMm: 10, lengthMm: 1000, legOrGapMm: 2,
  grooveAngleDeg: 60, travelSpeedMmMin: 250, fillerPricePerKg: 3, labourRatePerHour: 50,
};

describe('estimate', () => {
  it('weld volume = area × length', () => {
    const r = estimate(base);
    expect(r.weldVolumeMm3).toBeCloseTo(r.grooveAreaMm2 * 1000, 4);
  });

  it('deposit mass accounts for efficiency', () => {
    const hi = estimate({ ...base, depositionEfficiency: 0.95 });
    const lo = estimate({ ...base, depositionEfficiency: 0.6 });
    expect(lo.depositMassG).toBeGreaterThan(hi.depositMassG);
  });

  it('weld time = length / travel speed', () => {
    const r = estimate({ ...base, passes: 1 });
    expect(r.weldTimeMin).toBeCloseTo(1000 / 250, 5);
  });

  it('more passes → more time', () => {
    const one = estimate({ ...base, passes: 1 });
    const three = estimate({ ...base, passes: 3 });
    expect(three.weldTimeMin).toBeCloseTo(one.weldTimeMin * 3, 5);
  });

  it('total = filler + labour', () => {
    const r = estimate(base);
    expect(r.totalCost).toBeCloseTo(r.fillerCost + r.labourCost, 5);
  });

  it('thicker plate → bigger groove → more cost', () => {
    const thin = estimate({ ...base, thicknessMm: 6 });
    const thick = estimate({ ...base, thicknessMm: 20 });
    expect(thick.totalCost).toBeGreaterThan(thin.totalCost);
  });

  it('zero travel speed → warning', () => {
    expect(estimate({ ...base, travelSpeedMmMin: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('grooveArea', () => {
  it('fillet = ½ leg²', () => {
    expect(grooveArea({ jointType: 'fillet', thicknessMm: 10, legOrGapMm: 8 })).toBeCloseTo(0.5 * 64, 4);
  });

  it('square-butt = t × gap', () => {
    expect(grooveArea({ jointType: 'square-butt', thicknessMm: 6, legOrGapMm: 2 })).toBeCloseTo(12, 4);
  });

  it('double-V smaller than single-V (same t)', () => {
    const single = grooveArea({ jointType: 'single-V', thicknessMm: 12, legOrGapMm: 2, grooveAngleDeg: 60 });
    const double = grooveArea({ jointType: 'double-V', thicknessMm: 12, legOrGapMm: 2, grooveAngleDeg: 60 });
    expect(double).toBeLessThan(single);
  });

  it('wider angle → larger V area', () => {
    const narrow = grooveArea({ jointType: 'single-V', thicknessMm: 10, legOrGapMm: 2, grooveAngleDeg: 45 });
    const wide = grooveArea({ jointType: 'single-V', thicknessMm: 10, legOrGapMm: 2, grooveAngleDeg: 80 });
    expect(wide).toBeGreaterThan(narrow);
  });
});

describe('summarize', () => {
  it('reports total + mass', () => {
    const r = estimate(base);
    const s = summarize(r);
    expect(s.totalCost).toBe(r.totalCost);
    expect(s.depositMassG).toBe(r.depositMassG);
  });
});
