import { describe, it, expect } from 'vitest';
import {
  evaluateCorners,
  buildFeedSchedule,
  aggregateCorners,
  summarize,
  type CornerSpec,
  type ToolSpec,
} from './cornerToolEngagement';

const tool: ToolSpec = { diameterMm: 10, flutes: 4, maxRadialEngagementMm: 2 };

function corner(id: string, angle: number, fillet: number, ae: number): CornerSpec {
  return { id, interiorAngleDeg: angle, filletRadiusMm: fillet, commandedAeMm: ae };
}

describe('evaluateCorners', () => {
  it('empty input → empty output', () => {
    expect(evaluateCorners([], tool)).toEqual([]);
  });

  it('filleted corner ≥ tool radius → peak = commanded ae', () => {
    const r = evaluateCorners([corner('c1', 90, 10, 1)], tool);
    expect(r[0]!.peakEngagementMm).toBeCloseTo(1, 5);
    expect(r[0]!.spikeRatio).toBeCloseTo(1, 3);
  });

  it('sharp corner → spike > 1', () => {
    const r = evaluateCorners([corner('c1', 90, 0, 1)], tool);
    expect(r[0]!.spikeRatio).toBeGreaterThan(1);
  });

  it('unsafe corner triggers pre-rough suggestion', () => {
    const r = evaluateCorners([corner('c1', 30, 0, 0.5)], tool, { minFeedOverride: 0.3, allowPreRough: true });
    expect(r[0]!.unsafe).toBe(true);
    expect(r[0]!.preRoughDiameterMm).toBeGreaterThan(0);
  });

  it('feed override floor respected', () => {
    const r = evaluateCorners([corner('c1', 10, 0, 0.1)], tool, { minFeedOverride: 0.2, allowPreRough: false });
    expect(r[0]!.feedOverride).toBeGreaterThanOrEqual(0.2);
  });

  it('safe corner has override 1', () => {
    const r = evaluateCorners([corner('c1', 170, 15, 0.5)], tool);
    expect(r[0]!.feedOverride).toBe(1);
    expect(r[0]!.unsafe).toBe(false);
  });

  it('no pre-rough when allowPreRough false', () => {
    const r = evaluateCorners([corner('c1', 10, 0, 0.1)], tool, { minFeedOverride: 0.2, allowPreRough: false });
    expect(r[0]!.preRoughDiameterMm).toBeUndefined();
  });
});

describe('buildFeedSchedule', () => {
  it('approach > corner', () => {
    const eng = evaluateCorners([corner('c1', 30, 0, 1)], tool);
    const schedule = buildFeedSchedule(eng);
    expect(schedule[0]!.approachOverride).toBeGreaterThanOrEqual(schedule[0]!.cornerOverride);
  });

  it('exit > corner', () => {
    const eng = evaluateCorners([corner('c1', 30, 0, 1)], tool);
    const schedule = buildFeedSchedule(eng);
    expect(schedule[0]!.exitOverride).toBeGreaterThanOrEqual(schedule[0]!.cornerOverride);
  });
});

describe('aggregateCorners', () => {
  it('counts unsafe corners', () => {
    const eng = evaluateCorners([corner('c1', 30, 0, 1), corner('c2', 170, 10, 0.5)], tool);
    const agg = aggregateCorners(eng);
    expect(agg.unsafeCount).toBeGreaterThanOrEqual(0);
    expect(agg.totalCorners).toBe(2);
  });

  it('worst spike is the maximum', () => {
    const eng = evaluateCorners([corner('c1', 30, 0, 1), corner('c2', 170, 10, 1)], tool);
    const agg = aggregateCorners(eng);
    expect(agg.worstSpikeRatio).toBeGreaterThanOrEqual(1);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const eng = evaluateCorners([corner('c1', 90, 5, 1)], tool);
    const s = summarize(eng);
    expect(s.cornerCount).toBe(1);
  });

  it('worstPeakEngagement positive', () => {
    const eng = evaluateCorners([corner('c1', 90, 5, 1)], tool);
    expect(summarize(eng).worstPeakEngagementMm).toBeGreaterThan(0);
  });
});
