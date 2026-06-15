/**
 * occtFilletAvoidance — ungated unit tests for the pure policy parts
 * (the kernel-touching orchestration is covered by the gated corpus suite,
 * occtCorpus.regression.test.ts, RUN_OCCT_FEASIBILITY=1).
 */
import { describe, it, expect } from 'vitest';
import { radiusLadder, RADIUS_LADDER_FACTORS, MIN_FILLET_RADIUS } from './occtFilletAvoidance';

describe('radiusLadder', () => {
  it('descends 75% → 50% → 25% of the requested radius', () => {
    expect(radiusLadder(8)).toEqual([6, 4, 2]);
  });

  it('floors at MIN_FILLET_RADIUS (stops the ladder, never goes below)', () => {
    const ladder = radiusLadder(0.6);
    // 0.45, 0.3 ok; 0.15 < 0.2 floor → dropped.
    expect(ladder).toEqual([0.45, 0.3]);
    for (const r of ladder) expect(r).toBeGreaterThanOrEqual(MIN_FILLET_RADIUS);
  });

  it('empty for non-positive or sub-floor radii', () => {
    expect(radiusLadder(0)).toEqual([]);
    expect(radiusLadder(-3)).toEqual([]);
    expect(radiusLadder(0.2)).toEqual([]); // 0.15 < floor already
  });

  it('every step is strictly below the requested radius and deduped', () => {
    for (const req of [0.5, 1, 3, 8, 20]) {
      const ladder = radiusLadder(req);
      for (const r of ladder) expect(r).toBeLessThan(req);
      expect(new Set(ladder).size).toBe(ladder.length);
    }
  });

  it('default factor set is descending', () => {
    const sorted = [...RADIUS_LADDER_FACTORS].sort((a, b) => b - a);
    expect([...RADIUS_LADDER_FACTORS]).toEqual(sorted);
  });
});
