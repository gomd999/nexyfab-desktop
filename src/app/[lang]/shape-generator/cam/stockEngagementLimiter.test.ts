import { describe, it, expect } from 'vitest';
import {
  applyLimits,
  engagementAngleDeg,
  analyzePath,
  tallyRecommendations,
  summarize,
  type ToolPathSegment,
} from './stockEngagementLimiter';

function seg(id: string, stepover: number, dia: number = 10): ToolPathSegment {
  return { id, stepoverMm: stepover, lengthMm: 100, toolDiameterMm: dia };
}

describe('engagementAngleDeg', () => {
  it('zero stepover → 0°', () => {
    expect(engagementAngleDeg(0, 5)).toBe(0);
  });

  it('full slot (ae = 2R) → 180°', () => {
    expect(engagementAngleDeg(10, 5)).toBeCloseTo(180, 1);
  });

  it('ae = R → 90°', () => {
    expect(engagementAngleDeg(5, 5)).toBeCloseTo(90, 1);
  });

  it('zero radius → 0', () => {
    expect(engagementAngleDeg(1, 0)).toBe(0);
  });
});

describe('applyLimits', () => {
  it('low engagement → ok', () => {
    const r = applyLimits([seg('s1', 0.5)]);
    expect(r[0]!.recommendedAction).toBe('ok');
  });

  it('high engagement triggers reduce-stepover', () => {
    const r = applyLimits([seg('s1', 5)], { maxEngagementDeg: 35, preferFeedOverride: false });
    expect(r[0]!.recommendedAction).toBe('reduce-stepover');
    expect(r[0]!.adjustedStepoverMm).toBeLessThan(5);
  });

  it('preferFeedOverride → reduce-feed', () => {
    const r = applyLimits([seg('s1', 5)], { maxEngagementDeg: 35, preferFeedOverride: true });
    expect(r[0]!.recommendedAction).toBe('reduce-feed');
    expect(r[0]!.feedOverride).toBeLessThan(1);
  });

  it('zero radius → ok', () => {
    const r = applyLimits([seg('s1', 5, 0)]);
    expect(r[0]!.recommendedAction).toBe('ok');
  });

  it('adjusted stepover does not exceed original', () => {
    const r = applyLimits([seg('s1', 8)]);
    expect(r[0]!.adjustedStepoverMm).toBeLessThanOrEqual(8);
  });

  it('feed override floor 0.2', () => {
    const r = applyLimits([seg('s1', 10)], { maxEngagementDeg: 5, preferFeedOverride: true });
    expect(r[0]!.feedOverride).toBeGreaterThanOrEqual(0.2);
  });
});

describe('analyzePath', () => {
  it('reports worst engagement', () => {
    const segs = [seg('s1', 0.5), seg('s2', 5)];
    const res = applyLimits(segs);
    const a = analyzePath(segs, res);
    expect(a.worstEngagementDeg).toBeGreaterThan(35);
  });

  it('counts overLimit segments', () => {
    const segs = [seg('s1', 0.5), seg('s2', 5)];
    const res = applyLimits(segs);
    expect(analyzePath(segs, res).overLimitSegments).toBeGreaterThanOrEqual(1);
  });

  it('empty list → zero average', () => {
    expect(analyzePath([], []).averageEngagementDeg).toBe(0);
  });
});

describe('tallyRecommendations', () => {
  it('counts actions', () => {
    const res = applyLimits([seg('s1', 0.5), seg('s2', 5)], { maxEngagementDeg: 35, preferFeedOverride: false });
    const t = tallyRecommendations(res);
    expect(t.ok + t.reduceStepover + t.reduceFeed + t.removeSegment).toBe(2);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const res = applyLimits([seg('s1', 0.5), seg('s2', 5)]);
    const s = summarize(res);
    expect(s.segmentCount).toBe(2);
    expect(s.worstEngagementDeg).toBeGreaterThan(0);
  });
});
