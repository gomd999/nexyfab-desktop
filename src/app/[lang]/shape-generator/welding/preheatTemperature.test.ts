import { describe, it, expect } from 'vitest';
import {
  compute,
  carbonEquivalent,
  weldability,
  summarize,
  type PreheatInput,
} from './preheatTemperature';

// Mild steel ~ low CE.
const mild: PreheatInput = {
  composition: { C: 0.15, Mn: 0.8 },
  combinedThicknessMm: 12,
  hydrogen: 'low',
};

// Higher-alloy steel.
const alloy: PreheatInput = {
  composition: { C: 0.35, Mn: 1.2, Cr: 0.8, Mo: 0.3, Ni: 0.5 },
  combinedThicknessMm: 40,
  hydrogen: 'high',
};

describe('carbonEquivalent', () => {
  it('mild steel CE', () => {
    expect(carbonEquivalent(mild.composition)).toBeCloseTo(0.15 + 0.8 / 6, 5);
  });

  it('alloy CE higher than mild', () => {
    expect(carbonEquivalent(alloy.composition)).toBeGreaterThan(carbonEquivalent(mild.composition));
  });
});

describe('compute', () => {
  it('mild steel thin → low/no preheat', () => {
    const r = compute({ ...mild, combinedThicknessMm: 8 });
    expect(r.recommendedPreheatC).toBeLessThanOrEqual(50);
  });

  it('alloy thick high-H → high preheat', () => {
    const r = compute(alloy);
    expect(r.recommendedPreheatC).toBeGreaterThan(150);
  });

  it('preheat rounded to 25°C', () => {
    const r = compute(alloy);
    expect(r.recommendedPreheatC % 25).toBe(0);
  });

  it('thickness raises preheat', () => {
    const thin = compute({ ...mild, composition: { C: 0.3, Mn: 1.0 }, combinedThicknessMm: 10 });
    const thick = compute({ ...mild, composition: { C: 0.3, Mn: 1.0 }, combinedThicknessMm: 60 });
    expect(thick.recommendedPreheatC).toBeGreaterThan(thin.recommendedPreheatC);
  });

  it('hydrogen raises preheat', () => {
    const lo = compute({ composition: { C: 0.3, Mn: 1.0 }, combinedThicknessMm: 20, hydrogen: 'low' });
    const hi = compute({ composition: { C: 0.3, Mn: 1.0 }, combinedThicknessMm: 20, hydrogen: 'high' });
    expect(hi.recommendedPreheatC).toBeGreaterThan(lo.recommendedPreheatC);
  });

  it('very high CE → warning', () => {
    const r = compute({ composition: { C: 0.5, Mn: 1.5, Cr: 1.0, Mo: 0.5 }, combinedThicknessMm: 30, hydrogen: 'medium' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('preheat never below 20°C', () => {
    const r = compute({ ...mild, combinedThicknessMm: 5 });
    expect(r.recommendedPreheatC).toBeGreaterThanOrEqual(20);
  });

  it('band reflects CE', () => {
    expect(compute({ ...mild, combinedThicknessMm: 8 }).band).toBe('none');
    expect(compute(alloy).band === 'medium' || compute(alloy).band === 'high').toBe(true);
  });
});

describe('weldability', () => {
  it('low CE → excellent', () => {
    expect(weldability(0.35)).toBe('excellent');
  });

  it('high CE → poor', () => {
    expect(weldability(0.7)).toBe('poor');
  });

  it('monotonic ordering', () => {
    const order = ['excellent', 'good', 'fair', 'poor'];
    const idx = (ce: number) => order.indexOf(weldability(ce));
    expect(idx(0.65)).toBeGreaterThan(idx(0.35));
  });
});

describe('summarize', () => {
  it('reports CE + preheat', () => {
    const r = compute(alloy);
    const s = summarize(r);
    expect(s.carbonEquivalent).toBe(r.carbonEquivalent);
    expect(s.recommendedPreheatC).toBe(r.recommendedPreheatC);
  });
});
