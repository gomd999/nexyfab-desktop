import { describe, it, expect } from 'vitest';
import {
  assessFixtureCompliance,
  aggregate,
  summarize,
  DEFAULT_OPTIONS,
  type FixturePoint,
  type PartProperties,
} from './fixtureCompliance';

const part: PartProperties = {
  youngMpa: 200000,
  characteristicLengthMm: 100,
  thicknessMm: 5,
};

function fix(id: string, stiffness: number): FixturePoint {
  return {
    id,
    point: { x: 0, y: 0, z: 0 },
    fixtureStiffnessN_mm: stiffness,
  };
}

describe('assessFixtureCompliance', () => {
  it('empty list → empty results', () => {
    expect(assessFixtureCompliance([], part)).toEqual([]);
  });

  it('high fixture stiffness → rigid classification', () => {
    // partLocalStiff ≈ 200000 · 125 / 1e6 = 25 N/mm. Need ≥10× = 250 N/mm.
    const results = assessFixtureCompliance([fix('f1', 10000)], part);
    expect(results[0]!.classification).toBe('rigid');
  });

  it('moderate fixture (3-10× part) → moderate', () => {
    // partLocalStiff ≈ 25. Want ratio ~5 → stiffness ~125.
    const results = assessFixtureCompliance([fix('f1', 125)], part);
    expect(results[0]!.classification).toBe('moderate');
  });

  it('low fixture (1-3× part) → compliant', () => {
    // ratio ~2 → stiffness ~50.
    const results = assessFixtureCompliance([fix('f1', 50)], part);
    expect(results[0]!.classification).toBe('compliant');
  });

  it('fixture less stiff than part → dominated', () => {
    // ratio <1 → stiffness ~10.
    const results = assessFixtureCompliance([fix('f1', 10)], part);
    expect(results[0]!.classification).toBe('dominated');
  });

  it('ratio is fixtureStiffness / partLocalStiffness', () => {
    const results = assessFixtureCompliance([fix('f1', 100)], part);
    expect(results[0]!.ratio).toBeCloseTo(100 / results[0]!.partLocalStiffness, 5);
  });

  it('zero characteristic length → ratio infinite, classification rigid', () => {
    const oddPart: PartProperties = { youngMpa: 200000, characteristicLengthMm: 0, thicknessMm: 5 };
    const results = assessFixtureCompliance([fix('f1', 100)], oddPart);
    expect(results[0]!.classification).toBe('rigid');
  });

  it('recommendation populated', () => {
    const results = assessFixtureCompliance([fix('f1', 100)], part);
    expect(results[0]!.recommendation.length).toBeGreaterThan(0);
  });

  it('respects custom thresholds', () => {
    // Without override: stiffness 50 → ratio 2 → compliant.
    // With moderateThreshold 1.5: ratio 2 ≥ 1.5 → moderate.
    const results = assessFixtureCompliance(
      [fix('f1', 50)],
      part,
      { moderateThreshold: 1.5, rigidThreshold: 10 },
    );
    expect(results[0]!.classification).toBe('moderate');
  });
});

describe('aggregate', () => {
  it('empty input → rigid worst (defaults)', () => {
    const agg = aggregate([]);
    expect(agg.worstClassification).toBe('rigid');
  });

  it('finds worst classification', () => {
    const results = assessFixtureCompliance(
      [fix('a', 10000), fix('b', 10)],
      part,
    );
    expect(aggregate(results).worstClassification).toBe('dominated');
  });

  it('counts each category', () => {
    const results = assessFixtureCompliance(
      [fix('a', 10000), fix('b', 10000), fix('c', 50), fix('d', 10)],
      part,
    );
    const agg = aggregate(results);
    expect(agg.rigidCount).toBe(2);
    expect(agg.dominatedCount).toBe(1);
  });

  it('worstRatio is minimum across fixtures', () => {
    const results = assessFixtureCompliance(
      [fix('a', 10000), fix('b', 10)],
      part,
    );
    const agg = aggregate(results);
    expect(agg.worstRatio).toBeLessThan(1);
  });

  it('recommendation differs by worst class', () => {
    const rigid = aggregate(assessFixtureCompliance([fix('a', 10000)], part));
    const dominated = aggregate(assessFixtureCompliance([fix('a', 10)], part));
    expect(rigid.recommendedAction).not.toBe(dominated.recommendedAction);
  });
});

describe('summarize', () => {
  it('empty → 0 fixtures', () => {
    const s = summarize([]);
    expect(s.fixtureCount).toBe(0);
    expect(s.rigidFraction).toBe(0);
  });

  it('reports fixture count', () => {
    const results = assessFixtureCompliance(
      [fix('a', 10000), fix('b', 10000)],
      part,
    );
    expect(summarize(results).fixtureCount).toBe(2);
  });

  it('rigidFraction 1.0 when all rigid', () => {
    const results = assessFixtureCompliance(
      [fix('a', 10000), fix('b', 10000)],
      part,
    );
    expect(summarize(results).rigidFraction).toBe(1);
  });
});

describe('DEFAULT_OPTIONS', () => {
  it('rigid threshold ≥ moderate threshold', () => {
    expect(DEFAULT_OPTIONS.rigidThreshold).toBeGreaterThan(DEFAULT_OPTIONS.moderateThreshold);
  });
});
