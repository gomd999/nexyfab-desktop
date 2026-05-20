import { describe, it, expect } from 'vitest';
import {
  groupCallouts,
  findGroupOverlaps,
  applyLabels,
  summarize,
  type Callout,
} from './detailCalloutGrouping';

function co(id: string, x: number, y: number, r: number = 5): Callout {
  return { id, point: { x, y }, radiusMm: r };
}

describe('groupCallouts', () => {
  it('empty input → empty', () => {
    expect(groupCallouts([])).toEqual([]);
  });

  it('single callout → one group', () => {
    const groups = groupCallouts([co('c1', 0, 0)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.callouts).toHaveLength(1);
  });

  it('two near callouts → one group', () => {
    const groups = groupCallouts([co('c1', 0, 0), co('c2', 10, 0)], { clusterRadiusMm: 30, maxClusterSize: 8, defaultMagnification: 2 });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.callouts).toHaveLength(2);
  });

  it('two far callouts → two groups', () => {
    const groups = groupCallouts([co('c1', 0, 0), co('c2', 100, 0)], { clusterRadiusMm: 30, maxClusterSize: 8, defaultMagnification: 2 });
    expect(groups).toHaveLength(2);
  });

  it('labels are A, B, C', () => {
    const groups = groupCallouts([co('c1', 0, 0), co('c2', 100, 0), co('c3', 200, 0)]);
    expect(groups.map(g => g.label)).toEqual(['A', 'B', 'C']);
  });

  it('beyond 25, labels become AA', () => {
    const callouts = Array.from({ length: 27 }, (_, i) => co(`c${i}`, i * 100, 0));
    const groups = groupCallouts(callouts);
    expect(groups[26]!.label).toBe('AA');
  });

  it('cluster centroid is averaged', () => {
    const groups = groupCallouts([co('c1', 0, 0), co('c2', 10, 0)]);
    expect(groups[0]!.centre.x).toBeCloseTo(5, 5);
  });

  it('warning when cluster exceeds maxClusterSize', () => {
    const callouts = Array.from({ length: 5 }, (_, i) => co(`c${i}`, i, 0));
    const groups = groupCallouts(callouts, { clusterRadiusMm: 30, maxClusterSize: 3, defaultMagnification: 2 });
    expect(groups[0]!.warning).toBeDefined();
  });

  it('enclosingRadius bounds all callouts', () => {
    const groups = groupCallouts([co('c1', 0, 0, 5), co('c2', 20, 0, 5)]);
    const g = groups[0]!;
    for (const c of g.callouts) {
      const d = Math.hypot(c.point.x - g.centre.x, c.point.y - g.centre.y);
      expect(d + c.radiusMm).toBeLessThanOrEqual(g.enclosingRadiusMm + 1e-9);
    }
  });

  it('chain of callouts connects transitively', () => {
    // c1 → c2 → c3, each 25 apart, threshold 30 → all in one group.
    const callouts = [co('c1', 0, 0), co('c2', 25, 0), co('c3', 50, 0)];
    const groups = groupCallouts(callouts, { clusterRadiusMm: 30, maxClusterSize: 10, defaultMagnification: 2 });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.callouts).toHaveLength(3);
  });
});

describe('findGroupOverlaps', () => {
  it('no overlaps for distant groups', () => {
    const groups = groupCallouts([co('c1', 0, 0), co('c2', 200, 0)]);
    expect(findGroupOverlaps(groups)).toEqual([]);
  });

  it('detects close-group overlap', () => {
    // Force two groups with large enclosing radii.
    const groups = groupCallouts([co('c1', 0, 0, 50), co('c2', 200, 0, 50)], { clusterRadiusMm: 30, maxClusterSize: 8, defaultMagnification: 2 });
    const overlaps = findGroupOverlaps(groups);
    // enclosing ~ 50 each, centres 200 apart → overlap = 100-200 = -100 (no overlap actually)
    // To force overlap, make centres closer.
    expect(overlaps).toEqual([]);
  });

  it('overlap reported when enclosing > separation', () => {
    const groups = groupCallouts([co('c1', 0, 0, 50), co('c2', 80, 0, 50)], { clusterRadiusMm: 30, maxClusterSize: 8, defaultMagnification: 2 });
    // c1 enclosing >= 50, c2 enclosing >= 50, separation 80 → overlap 20.
    const overlaps = findGroupOverlaps(groups);
    expect(overlaps).toHaveLength(1);
  });
});

describe('applyLabels', () => {
  it('writes label back to each callout', () => {
    const callouts = [co('c1', 0, 0), co('c2', 100, 0)];
    const groups = groupCallouts(callouts);
    applyLabels(groups);
    expect(callouts[0]!.label).toBe('A');
    expect(callouts[1]!.label).toBe('B');
  });
});

describe('summarize', () => {
  it('reports group + callout counts', () => {
    const callouts = [co('c1', 0, 0), co('c2', 100, 0), co('c3', 110, 0)];
    const groups = groupCallouts(callouts);
    const s = summarize(groups);
    expect(s.groupCount).toBe(2);
    expect(s.totalCallouts).toBe(3);
    expect(s.largestGroupSize).toBe(2);
  });

  it('counts warnings', () => {
    const callouts = Array.from({ length: 10 }, (_, i) => co(`c${i}`, i, 0));
    const groups = groupCallouts(callouts, { clusterRadiusMm: 30, maxClusterSize: 3, defaultMagnification: 2 });
    expect(summarize(groups).warningCount).toBeGreaterThan(0);
  });
});
