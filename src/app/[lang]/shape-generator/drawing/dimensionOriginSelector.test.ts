import { describe, it, expect } from 'vitest';
import {
  selectOrigin,
  evaluateStackRisk,
  recommendStyle,
  summarize,
  type DimFeature,
} from './dimensionOriginSelector';

function feat(id: string, x: number, y: number, critical: boolean = false): DimFeature {
  return { id, point: { x, y }, critical };
}

describe('selectOrigin', () => {
  it('empty input → origin at 0,0', () => {
    const r = selectOrigin([]);
    expect(r.bestOrigin).toEqual({ x: 0, y: 0 });
  });

  it('single feature → origin at that feature', () => {
    const r = selectOrigin([feat('f1', 10, 20)]);
    expect(r.bestOrigin).toEqual({ x: 10, y: 20 });
  });

  it('three features → restricted to one of them', () => {
    const features = [feat('a', 0, 0), feat('b', 10, 0), feat('c', 5, 10)];
    const r = selectOrigin(features, { restrictToFeatures: true, leverWeight: 0.7, gridSamples: 10 });
    expect(features.some(f => f.point.x === r.bestOrigin.x && f.point.y === r.bestOrigin.y)).toBe(true);
  });

  it('xDimensions sorted by value', () => {
    const r = selectOrigin([feat('a', 0, 0), feat('b', 10, 0), feat('c', 5, 0)]);
    const xs = r.xDimensions.map(d => d.value);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]!);
  });

  it('critical feature weighted more', () => {
    const features = [feat('A', 0, 0, true), feat('B', 100, 0, false)];
    const r = selectOrigin(features);
    // Origin should be closer to critical A (origin at A produces less weighted lever).
    expect(r.bestOrigin.x).toBe(0);
  });

  it('grid mode produces more candidates', () => {
    const features = [feat('a', 0, 0), feat('b', 10, 10)];
    const restricted = selectOrigin(features, { restrictToFeatures: true, leverWeight: 0.7, gridSamples: 5 });
    const grid = selectOrigin(features, { restrictToFeatures: false, leverWeight: 0.7, gridSamples: 5 });
    expect(grid.rankedCandidates.length).toBeGreaterThanOrEqual(restricted.rankedCandidates.length);
  });

  it('best candidate has lowest score', () => {
    const features = [feat('a', 0, 0), feat('b', 10, 0)];
    const r = selectOrigin(features);
    expect(r.rankedCandidates[0]!.score).toBeLessThanOrEqual(r.rankedCandidates[1]?.score ?? 1);
  });
});

describe('evaluateStackRisk', () => {
  it('all near origin → low risk', () => {
    const r = selectOrigin([feat('a', 0, 0), feat('b', 10, 10)]);
    expect(evaluateStackRisk(r).riskLevel).toBe('low');
  });

  it('medium spread → medium risk', () => {
    const r = selectOrigin([feat('a', 0, 0), feat('b', 100, 0), feat('c', 0, 100)]);
    expect(evaluateStackRisk(r).riskLevel).toBe('medium');
  });

  it('large spread → high risk', () => {
    const r = selectOrigin([feat('a', 0, 0), feat('b', 500, 0)]);
    expect(evaluateStackRisk(r).riskLevel).toBe('high');
  });
});

describe('recommendStyle', () => {
  it('few features → baseline', () => {
    expect(recommendStyle([feat('a', 0, 0)])).toBe('baseline');
  });

  it('many critical features → baseline', () => {
    expect(recommendStyle([feat('a', 0, 0, true), feat('b', 1, 0, true), feat('c', 2, 0, true), feat('d', 3, 0, true)])).toBe('baseline');
  });

  it('mixed → combined', () => {
    expect(recommendStyle([feat('a', 0, 0, false), feat('b', 1, 0, false), feat('c', 2, 0, false), feat('d', 3, 0, false)])).toBe('combined');
  });
});

describe('summarize', () => {
  it('reports key fields', () => {
    const r = selectOrigin([feat('a', 0, 0), feat('b', 10, 10)]);
    const s = summarize(r);
    expect(s.candidateCount).toBeGreaterThan(0);
    expect(s.xCount).toBe(2);
    expect(s.yCount).toBe(2);
  });
});
