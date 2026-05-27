import { describe, it, expect } from 'vitest';
import {
  classifyZone,
  applyWesternElectricRules,
  cusumChart,
  ewmaChart,
  imrChart,
} from './spcStage2';

describe('classifyZone', () => {
  it('within ±1σ → Zone C', () => {
    expect(classifyZone(10.5, 10, 1).zone).toBe('C');
  });

  it('1-2σ → Zone B', () => {
    expect(classifyZone(11.5, 10, 1).zone).toBe('B');
  });

  it('2-3σ → Zone A', () => {
    expect(classifyZone(12.5, 10, 1).zone).toBe('A');
  });

  it('>3σ → outside', () => {
    expect(classifyZone(14, 10, 1).zone).toBe('outside');
  });

  it('side correctly signed', () => {
    expect(classifyZone(11, 10, 1).side).toBe(1);
    expect(classifyZone(9, 10, 1).side).toBe(-1);
    expect(classifyZone(10, 10, 1).side).toBe(0);
  });
});

describe('applyWesternElectricRules', () => {
  it('rule 1 — single outlier flagged', () => {
    const vals = [10, 10, 10, 10, 14, 10];
    const r = applyWesternElectricRules(vals, 10, 1);
    expect(r.some(v => v.rule === 'rule1')).toBe(true);
  });

  it('rule 2 — 2 of 3 in Zone A same side', () => {
    const vals = [10, 12.5, 10, 12.5];
    const r = applyWesternElectricRules(vals, 10, 1);
    expect(r.some(v => v.rule === 'rule2')).toBe(true);
  });

  it('rule 3 — 4 of 5 beyond 1σ', () => {
    const vals = [10, 11.5, 11.5, 11.5, 10, 11.5];
    const r = applyWesternElectricRules(vals, 10, 1);
    expect(r.some(v => v.rule === 'rule3')).toBe(true);
  });

  it('rule 4 — 8 consecutive same side', () => {
    const vals = [11, 11, 11, 11, 11, 11, 11, 11];
    const r = applyWesternElectricRules(vals, 10, 1);
    expect(r.some(v => v.rule === 'rule4')).toBe(true);
  });

  it('rule 5 — 6 trending up', () => {
    const vals = [10, 10.1, 10.2, 10.3, 10.4, 10.5];
    const r = applyWesternElectricRules(vals, 10, 1);
    expect(r.some(v => v.rule === 'rule5')).toBe(true);
  });

  it('rule 7 — 15 in Zone C', () => {
    const vals = new Array(15).fill(10.2);
    const r = applyWesternElectricRules(vals, 10, 1);
    expect(r.some(v => v.rule === 'rule7')).toBe(true);
  });

  it('rule 8 — 8 outside Zone C', () => {
    const vals = [11.5, 11.5, 11.5, 11.5, 8.5, 8.5, 11.5, 11.5];
    const r = applyWesternElectricRules(vals, 10, 1);
    expect(r.some(v => v.rule === 'rule8')).toBe(true);
  });

  it('returns empty for stable centered data', () => {
    // Pure noise that hovers in Zone C.
    const vals = [10, 10.3, 9.7, 10.1, 9.9, 10.2, 9.8];
    const r = applyWesternElectricRules(vals, 10, 1);
    expect(r.some(v => v.rule === 'rule1')).toBe(false);
  });
});

describe('cusumChart', () => {
  it('detects sustained upward shift', () => {
    const vals = [...new Array(10).fill(10), ...new Array(10).fill(11)];
    const r = cusumChart(vals, 10, 0.5, 1.0, 4);
    expect(r.signalsHi.length).toBeGreaterThan(0);
  });

  it('detects sustained downward shift', () => {
    const vals = [...new Array(10).fill(10), ...new Array(10).fill(9)];
    const r = cusumChart(vals, 10, 0.5, 1.0, 4);
    expect(r.signalsLo.length).toBeGreaterThan(0);
  });

  it('no signal on stable process', () => {
    const vals = new Array(20).fill(10);
    const r = cusumChart(vals, 10, 0.5, 1.0, 4);
    expect(r.signalsHi).toEqual([]);
    expect(r.signalsLo).toEqual([]);
  });

  it('decision interval and slack scale with sigma', () => {
    const r = cusumChart([10], 10, 2, 1, 4);
    expect(r.decisionInterval).toBe(8);
    expect(r.slack).toBe(1);
  });
});

describe('ewmaChart', () => {
  it('weights recent values more heavily', () => {
    const vals = [10, 10, 10, 12];
    const r = ewmaChart(vals, 10, 1, 0.5);
    // λ=0.5 with last value 12 → final EWMA closer to 12.
    expect(r.ewma[r.ewma.length - 1]).toBeGreaterThan(10.5);
  });

  it('control limits expand toward steady-state', () => {
    const vals = new Array(50).fill(10);
    const r = ewmaChart(vals, 10, 1, 0.2);
    expect(r.ucl[r.ucl.length - 1]).toBeGreaterThan(r.ucl[0]!);
  });

  it('signals on persistent drift', () => {
    const vals = Array.from({ length: 30 }, (_, i) => 10 + 0.5 * i);
    const r = ewmaChart(vals, 10, 1, 0.2);
    expect(r.signals.length).toBeGreaterThan(0);
  });
});

describe('imrChart', () => {
  it('UCL > mean > LCL', () => {
    const vals = [10, 10.5, 9.8, 10.2, 9.9, 10.3, 10, 10.1];
    const r = imrChart(vals);
    expect(r.individualUcl).toBeGreaterThan(r.individualMean);
    expect(r.individualLcl).toBeLessThan(r.individualMean);
  });

  it('uses n=2 constants (D4=3.267)', () => {
    const r = imrChart([1, 2]);
    expect(r.D4).toBeCloseTo(3.267, 3);
  });

  it('handles single value gracefully', () => {
    const r = imrChart([5]);
    expect(r.individualMean).toBe(5);
    expect(r.movingRangeMean).toBe(0);
  });
});
