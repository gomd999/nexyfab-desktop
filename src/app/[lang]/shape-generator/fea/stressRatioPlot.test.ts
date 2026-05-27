import { describe, it, expect } from 'vitest';
import {
  computeStressRatios,
  aggregate,
  defaultColourMap,
  colourFor,
  summarize,
  type FeaElementStress,
} from './stressRatioPlot';

function el(id: string, vm: number, yld: number = 250): FeaElementStress {
  return { id, vonMisesMpa: vm, yieldMpa: yld };
}

describe('computeStressRatios', () => {
  it('empty → trivial', () => {
    const r = computeStressRatios([]);
    expect(r.ratios).toEqual([]);
    expect(r.peakElementId).toBeNull();
  });

  it('all-safe elements classified safe', () => {
    const r = computeStressRatios([el('a', 50), el('b', 60), el('c', 70)]);
    expect(r.ratios.every(x => x.status === 'safe')).toBe(true);
  });

  it('high vM → fail', () => {
    const r = computeStressRatios([el('a', 300)]);
    expect(r.ratios[0]!.status).toBe('fail');
  });

  it('moderate vM → warn', () => {
    const r = computeStressRatios([el('a', 150)]);
    expect(r.ratios[0]!.status).toBe('warn');
  });

  it('peak element identified', () => {
    const r = computeStressRatios([el('a', 100), el('peak', 300), el('c', 80)]);
    expect(r.peakElementId).toBe('peak');
  });

  it('histogram bins = options', () => {
    const r = computeStressRatios([el('a', 100), el('b', 200)], { safetyFactor: 1.5, bins: 4, warnThreshold: 0.67, failThreshold: 1.0 });
    expect(r.histogram).toHaveLength(4);
  });

  it('allowable = yield / safety factor', () => {
    const r = computeStressRatios([el('a', 100, 200)], { safetyFactor: 2, bins: 10, warnThreshold: 0.67, failThreshold: 1.0 });
    expect(r.ratios[0]!.allowableMpa).toBeCloseTo(100, 3);
    expect(r.ratios[0]!.stressRatio).toBeCloseTo(1, 3);
  });

  it('recommended SF ≥ input SF', () => {
    const r = computeStressRatios([el('a', 300)], { safetyFactor: 1.5, bins: 10, warnThreshold: 0.67, failThreshold: 1.0 });
    expect(r.recommendedSafetyFactor).toBeGreaterThanOrEqual(1.5);
  });
});

describe('aggregate', () => {
  it('counts safe/warn/fail', () => {
    const r = computeStressRatios([el('safe', 50), el('warn', 150), el('fail', 300)]);
    const agg = aggregate(r);
    expect(agg.safeCount).toBe(1);
    expect(agg.warnCount).toBe(1);
    expect(agg.failCount).toBe(1);
  });

  it('mean ratio averaged', () => {
    const r = computeStressRatios([el('a', 100), el('b', 200)]);
    const agg = aggregate(r);
    expect(agg.meanRatio).toBeGreaterThan(0);
  });

  it('utilisation = peak × 100%', () => {
    const r = computeStressRatios([el('a', 300)]);
    expect(aggregate(r).utilisationPct).toBe(r.peakStressRatio * 100);
  });
});

describe('colourFor', () => {
  it('safe band returns green', () => {
    expect(colourFor(0.3)[1]).toBeGreaterThan(150);
  });

  it('fail band returns red', () => {
    expect(colourFor(1.5)[0]).toBeGreaterThan(200);
  });

  it('default map has 5 bands', () => {
    expect(defaultColourMap()).toHaveLength(5);
  });
});

describe('summarize', () => {
  it('reports peak + fail count', () => {
    const r = computeStressRatios([el('a', 100), el('b', 300)]);
    const s = summarize(r);
    expect(s.peakStressRatio).toBe(r.peakStressRatio);
    expect(s.failCount).toBeGreaterThanOrEqual(0);
  });
});
