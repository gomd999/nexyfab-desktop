import { describe, it, expect } from 'vitest';
import { check, allowablePressure, summarize, type FlangeRatingInput } from './flangeRating';

const base: FlangeRatingInput = {
  flangeClass: 300, materialGroup: '1.1-carbon', operatingTempC: 200, designPressureBar: 30,
};

describe('check', () => {
  it('adequate when design ≤ allowable', () => {
    const r = check(base);
    expect(r.adequate).toBe(true);
    expect(r.allowablePressureBar).toBeGreaterThan(30);
  });

  it('inadequate when over rating → warning', () => {
    const r = check({ ...base, designPressureBar: 200 });
    expect(r.adequate).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('rating derates with temperature', () => {
    const cool = check({ ...base, operatingTempC: 38 });
    const hot = check({ ...base, operatingTempC: 400 });
    expect(hot.allowablePressureBar).toBeLessThan(cool.allowablePressureBar);
  });

  it('higher class → higher allowable', () => {
    const c150 = check({ ...base, flangeClass: 150 });
    const c600 = check({ ...base, flangeClass: 600 });
    expect(c600.allowablePressureBar).toBeGreaterThan(c150.allowablePressureBar);
  });

  it('recommends smallest passing class', () => {
    const r = check({ ...base, flangeClass: 150, designPressureBar: 30 });
    expect(r.recommendedClass).not.toBeNull();
    expect(allowablePressure('1.1-carbon', r.recommendedClass!, 200)).toBeGreaterThanOrEqual(30);
  });

  it('304SS retains rating at high temp better than carbon', () => {
    const ss = allowablePressure('2.2-304SS', 300, 538);
    const cs = allowablePressure('1.1-carbon', 300, 538);
    expect(ss).toBeGreaterThan(cs);
  });

  it('margin = allowable − design', () => {
    const r = check(base);
    expect(r.marginBar).toBeCloseTo(r.allowablePressureBar - 30, 5);
  });
});

describe('allowablePressure', () => {
  it('interpolates between breakpoints', () => {
    const at200 = allowablePressure('1.1-carbon', 300, 200);
    const at300 = allowablePressure('1.1-carbon', 300, 300);
    expect(at300).toBeLessThan(at200);
    expect(at300).toBeGreaterThan(allowablePressure('1.1-carbon', 300, 400));
  });

  it('clamps below min temp', () => {
    expect(allowablePressure('1.1-carbon', 150, -10)).toBeCloseTo(19.6, 1);
  });
});

describe('summarize', () => {
  it('reports allowable + adequacy', () => {
    const r = check(base);
    const s = summarize(r);
    expect(s.allowablePressureBar).toBe(r.allowablePressureBar);
    expect(s.adequate).toBe(r.adequate);
  });
});
