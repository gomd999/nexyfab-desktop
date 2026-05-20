import { describe, it, expect } from 'vitest';
import {
  generateAdaptiveClearing,
  estimateCycleTime,
  feedForChipLoad,
  type AdaptiveClearingParams,
} from './adaptiveClearing';

const baseParams: AdaptiveClearingParams = {
  toolDiameterMm: 10,
  maxEngagementPercent: 30,
  stepoverMm: 2,
  centreline: [[0, 0], [50, 0]],
  axialDepthMm: 5,
  spindleRpm: 8000,
  feedRateMmPerMin: 1500,
};

describe('generateAdaptiveClearing', () => {
  it('produces no arcs for invalid input', () => {
    const empty = generateAdaptiveClearing({ ...baseParams, centreline: [] });
    expect(empty.arcs).toHaveLength(0);

    const noTool = generateAdaptiveClearing({ ...baseParams, toolDiameterMm: 0 });
    expect(noTool.arcs).toHaveLength(0);
  });

  it('emits roughly length / stepover arcs', () => {
    // 50mm centreline, 2mm stepover → expect ≈ 25 arcs.
    const r = generateAdaptiveClearing(baseParams);
    expect(r.arcs.length).toBeGreaterThan(20);
    expect(r.arcs.length).toBeLessThan(30);
  });

  it('arc radius derived from engagement %', () => {
    const r = generateAdaptiveClearing(baseParams);
    // tool radius 5mm, engagement 30% → arc radius = 5 * (1 - 0.3) = 3.5
    expect(r.arcs[0]!.radius).toBeCloseTo(3.5, 6);
  });

  it('clamps absurd engagement to safe range', () => {
    const r = generateAdaptiveClearing({ ...baseParams, maxEngagementPercent: 9999 });
    expect(r.arcs[0]!.radius).toBeGreaterThan(0);
  });

  it('MRR positive when params valid', () => {
    const r = generateAdaptiveClearing(baseParams);
    expect(r.mrrCm3PerMin).toBeGreaterThan(0);
  });

  it('all arcs at the requested Z depth', () => {
    const r = generateAdaptiveClearing(baseParams);
    expect(r.arcs.every(a => a.zMm === -5)).toBe(true);
  });
});

describe('estimateCycleTime', () => {
  it('time = length / feedrate', () => {
    const path = { arcs: [], totalLengthMm: 3000, mrrCm3PerMin: 0 };
    expect(estimateCycleTime(path, 1000)).toBe(3);
  });

  it('zero feed → zero time', () => {
    expect(estimateCycleTime({ arcs: [], totalLengthMm: 100, mrrCm3PerMin: 0 }, 0)).toBe(0);
  });
});

describe('feedForChipLoad', () => {
  it('feedRate = chipLoad × flutes × RPM', () => {
    expect(feedForChipLoad(0.05, 4, 10000)).toBe(2000);
  });
});
