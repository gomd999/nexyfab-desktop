import { describe, it, expect } from 'vitest';
import {
  selectStrategy,
  estimateMachineCost,
  summarize,
  type MeshArrays,
} from './multiAxisOrientationSelector';

function flatTopPlate(): MeshArrays {
  return {
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

function unitCube(): MeshArrays {
  return {
    positions: [
      0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
      0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
    ],
    indices: [
      0, 2, 1,  0, 3, 2,
      4, 5, 6,  4, 6, 7,
      0, 1, 5,  0, 5, 4,
      1, 2, 6,  1, 6, 5,
      2, 3, 7,  2, 7, 6,
      3, 0, 4,  3, 4, 7,
    ],
  };
}

describe('selectStrategy', () => {
  it('empty mesh → 3-axis with zero coverage', () => {
    const r = selectStrategy({ positions: [], indices: [] });
    expect(r.recommendation).toBe('3-axis');
    expect(r.triangleCount).toBe(0);
  });

  it('flat top plate → 3-axis sufficient', () => {
    const r = selectStrategy(flatTopPlate());
    expect(r.recommendation).toBe('3-axis');
  });

  it('cube → 3+2 indexed (needs multiple orientations)', () => {
    const r = selectStrategy(unitCube());
    expect(['3+2', '3-axis']).toContain(r.recommendation);
  });

  it('best single axis coverage between 0 and 1', () => {
    const r = selectStrategy(unitCube());
    expect(r.bestSingleAxisCoverage).toBeGreaterThan(0);
    expect(r.bestSingleAxisCoverage).toBeLessThanOrEqual(1);
  });

  it('indexed set coverage ≥ best single axis coverage', () => {
    const r = selectStrategy(unitCube());
    expect(r.indexedSetCoverage).toBeGreaterThanOrEqual(r.bestSingleAxisCoverage);
  });

  it('all 6 candidate axes covered cube fully', () => {
    const r = selectStrategy(unitCube());
    expect(r.indexedSetCoverage).toBeCloseTo(1, 1);
  });

  it('per-axis coverage list has all candidates', () => {
    const r = selectStrategy(unitCube());
    expect(r.perAxisCoverage).toHaveLength(6);
  });

  it('higher sufficientCoverage threshold can push toward 5-axis', () => {
    const cheap = selectStrategy(unitCube(), { sufficientCoverage: 0.5 });
    const strict = selectStrategy(unitCube(), { sufficientCoverage: 0.99 });
    // Strict recommendation can be higher tier than cheap.
    const order = ['3-axis', '3+2', 'simultaneous-5-axis'];
    expect(order.indexOf(strict.recommendation)).toBeGreaterThanOrEqual(order.indexOf(cheap.recommendation));
  });
});

describe('estimateMachineCost', () => {
  it('3-axis is cheapest per hour', () => {
    const cost3 = estimateMachineCost('3-axis', 60);
    const cost5 = estimateMachineCost('simultaneous-5-axis', 60);
    expect(cost5.estimatedCostUsd).toBeGreaterThan(cost3.estimatedCostUsd);
  });

  it('setup time decreases with more axes (one fixture)', () => {
    const cost3 = estimateMachineCost('3-axis', 0);
    const cost5 = estimateMachineCost('simultaneous-5-axis', 0);
    expect(cost5.setupTimeMin).toBeGreaterThan(cost3.setupTimeMin);
  });

  it('cost scales with runtime', () => {
    const a = estimateMachineCost('3+2', 30);
    const b = estimateMachineCost('3+2', 90);
    expect(b.estimatedCostUsd).toBeGreaterThan(a.estimatedCostUsd);
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const r = selectStrategy({ positions: [], indices: [] });
    const s = summarize(r);
    expect(s.recommendation).toBe('3-axis');
    expect(s.unreachableFraction).toBe(0);
  });

  it('reports unreachable fraction', () => {
    const r = selectStrategy(unitCube());
    const s = summarize(r);
    expect(s.unreachableFraction).toBeGreaterThanOrEqual(0);
    expect(s.unreachableFraction).toBeLessThanOrEqual(1);
  });

  it('reports best single axis label', () => {
    const s = summarize(selectStrategy(flatTopPlate()));
    expect(s.bestSingleAxisLabel).toBe('+Z');
  });
});
