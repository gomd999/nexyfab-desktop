import { describe, it, expect } from 'vitest';
import {
  buildDimensionChain,
  validateChain,
  chainToBaseline,
  summarize,
  type ChainFeature,
} from './dimensionChainBuilder';

function feature(id: string, position: number): ChainFeature {
  return { id, position };
}

describe('buildDimensionChain', () => {
  it('< 2 features → empty result', () => {
    const r = buildDimensionChain([feature('a', 0)]);
    expect(r.dimensions).toEqual([]);
  });

  it('builds chain dimensions between consecutive features', () => {
    const r = buildDimensionChain([feature('a', 0), feature('b', 10), feature('c', 25)]);
    expect(r.dimensions).toHaveLength(2);
    expect(r.dimensions[0]!.value).toBe(10);
    expect(r.dimensions[1]!.value).toBe(15);
  });

  it('cumulative length = end - start', () => {
    const r = buildDimensionChain([feature('a', 5), feature('b', 50)]);
    expect(r.cumulativeLength).toBe(45);
  });

  it('sorts features by position', () => {
    const r = buildDimensionChain([feature('c', 30), feature('a', 0), feature('b', 15)]);
    expect(r.dimensions[0]!.fromId).toBe('a');
    expect(r.dimensions[0]!.toId).toBe('b');
  });

  it('skips < minGap dimensions', () => {
    const r = buildDimensionChain(
      [feature('a', 0), feature('b', 0.005), feature('c', 10)],
      { minGapMm: 0.01 },
    );
    expect(r.dimensions).toHaveLength(1);
    expect(r.dimensions[0]!.fromId).toBe('b');
    expect(r.dimensions[0]!.toId).toBe('c');
  });

  it('running dimensions cumulative from first', () => {
    const r = buildDimensionChain([feature('a', 0), feature('b', 10), feature('c', 25)]);
    expect(r.runningDimensions[2]!.runningMm).toBe(25);
  });

  it('extensionOffsets contain all positions', () => {
    const r = buildDimensionChain([feature('a', 0), feature('b', 10), feature('c', 25)]);
    expect(r.extensionOffsets).toEqual([0, 10, 25]);
  });

  it('rounding affects label', () => {
    const r = buildDimensionChain([feature('a', 0), feature('b', 10.456)], { decimals: 1 });
    expect(r.dimensions[0]!.label).toBe('10.5');
  });

  it('center position is midpoint', () => {
    const r = buildDimensionChain([feature('a', 0), feature('b', 20)]);
    expect(r.dimensions[0]!.centerOffset).toBe(10);
  });
});

describe('validateChain', () => {
  it('valid chain reports OK', () => {
    const r = buildDimensionChain([feature('a', 0), feature('b', 10), feature('c', 25)]);
    const v = validateChain(r);
    expect(v.isValid).toBe(true);
  });

  it('sum equals cumulative length', () => {
    const r = buildDimensionChain([feature('a', 0), feature('b', 10), feature('c', 25)]);
    const v = validateChain(r);
    expect(v.sumMm).toBeCloseTo(v.expectedMm, 5);
  });
});

describe('chainToBaseline', () => {
  it('converts to origin-referenced dimensions', () => {
    const baseline = chainToBaseline([feature('a', 0), feature('b', 10), feature('c', 25)]);
    expect(baseline).toHaveLength(2);
    expect(baseline[0]!.value).toBe(10);
    expect(baseline[1]!.value).toBe(25);
  });

  it('empty for < 2 features', () => {
    expect(chainToBaseline([])).toEqual([]);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const r = buildDimensionChain([]);
    const s = summarize(r);
    expect(s.dimensionCount).toBe(0);
  });

  it('reports min/max', () => {
    const r = buildDimensionChain([feature('a', 0), feature('b', 5), feature('c', 30), feature('d', 33)]);
    const s = summarize(r);
    expect(s.maxDimensionMm).toBe(25);
    expect(s.minDimensionMm).toBe(3);
  });

  it('average dimension correct', () => {
    const r = buildDimensionChain([feature('a', 0), feature('b', 10), feature('c', 30)]);
    const s = summarize(r);
    expect(s.averageDimensionMm).toBeCloseTo(15, 5);
  });
});
