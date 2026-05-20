import { describe, it, expect } from 'vitest';
import {
  wireMrr,
  wireBurnTimeSec,
  planSkimPasses,
  buildTaperedPath,
  sinkerBurnTimeSec,
  electrodeWearVolume,
  type WireEdmParams,
  type WirePath2D,
} from './edmToolpath';

const baseParams: WireEdmParams = {
  wireDiameterMm: 0.25,
  wireMaterial: 'brass',
  workpieceThicknessMm: 25,
  workpieceMaterial: 'tool-steel',
  ampSetting: 6,
  pulseOnUs: 8,
  pulseOffUs: 12,
};

describe('wireMrr', () => {
  it('higher amps → faster MRR', () => {
    const lo = wireMrr({ ...baseParams, ampSetting: 2 });
    const hi = wireMrr({ ...baseParams, ampSetting: 10 });
    expect(hi).toBeGreaterThan(lo);
  });

  it('carbide MRR < tool steel MRR', () => {
    const ts = wireMrr(baseParams);
    const wc = wireMrr({ ...baseParams, workpieceMaterial: 'carbide' });
    expect(wc).toBeLessThan(ts);
  });

  it('aluminum cuts ~2× tool steel', () => {
    const ts = wireMrr(baseParams);
    const al = wireMrr({ ...baseParams, workpieceMaterial: 'aluminum' });
    expect(al).toBeGreaterThan(ts);
  });

  it('amps clamped at 12', () => {
    const r12 = wireMrr({ ...baseParams, ampSetting: 12 });
    const r999 = wireMrr({ ...baseParams, ampSetting: 999 });
    expect(r999).toBe(r12);
  });
});

describe('wireBurnTimeSec', () => {
  it('zero length path → ~0 time', () => {
    const path: WirePath2D = { points: [[0, 0]], closed: false };
    expect(wireBurnTimeSec(path, baseParams)).toBe(0);
  });

  it('time grows with path length', () => {
    const short: WirePath2D = { points: [[0, 0], [10, 0]], closed: false };
    const long: WirePath2D = { points: [[0, 0], [100, 0]], closed: false };
    expect(wireBurnTimeSec(long, baseParams)).toBeGreaterThan(wireBurnTimeSec(short, baseParams));
  });

  it('closed loop adds the wrap-around segment', () => {
    const open: WirePath2D = { points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: false };
    const closed: WirePath2D = { points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true };
    expect(wireBurnTimeSec(closed, baseParams)).toBeGreaterThan(wireBurnTimeSec(open, baseParams));
  });

  it('multiple passes increase time', () => {
    const path: WirePath2D = { points: [[0, 0], [50, 0]], closed: false };
    const one = wireBurnTimeSec(path, baseParams, 1);
    const four = wireBurnTimeSec(path, baseParams, 4);
    expect(four).toBeGreaterThan(one);
  });
});

describe('planSkimPasses', () => {
  it('emits requested pass count', () => {
    const passes = planSkimPasses(5);
    expect(passes).toHaveLength(5);
  });

  it('first pass is the rough cut (largest offset + amp)', () => {
    const passes = planSkimPasses(4);
    expect(passes[0]!.offsetMm).toBe(0.12);
    expect(passes[0]!.ampSetting).toBe(8);
  });

  it('offsets monotonically decrease', () => {
    const passes = planSkimPasses(6);
    for (let i = 1; i < passes.length; i++) {
      expect(passes[i]!.offsetMm).toBeLessThanOrEqual(passes[i - 1]!.offsetMm);
    }
  });

  it('Ra targets decrease (rougher → smoother)', () => {
    const passes = planSkimPasses(6);
    for (let i = 1; i < passes.length; i++) {
      expect(passes[i]!.expectedRaUm).toBeLessThanOrEqual(passes[i - 1]!.expectedRaUm);
    }
  });

  it('empty when totalPasses < 1', () => {
    expect(planSkimPasses(0)).toHaveLength(0);
  });
});

describe('buildTaperedPath', () => {
  const square: WirePath2D = { points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true };

  it('upper + lower path same point count', () => {
    const t = buildTaperedPath(square, 30, 5);
    expect(t.upperPath.points).toHaveLength(t.lowerPath.points.length);
  });

  it('positive taper expands upper path', () => {
    const t = buildTaperedPath(square, 30, 5);
    // Upper point 0 should be further from centroid (5,5) than lower point 0.
    const upperDist = Math.hypot(t.upperPath.points[0]![0] - 5, t.upperPath.points[0]![1] - 5);
    const lowerDist = Math.hypot(t.lowerPath.points[0]![0] - 5, t.lowerPath.points[0]![1] - 5);
    expect(upperDist).toBeGreaterThan(lowerDist);
  });

  it('zero taper → identical paths', () => {
    const t = buildTaperedPath(square, 30, 0);
    expect(t.upperPath.points[0]).toEqual(t.lowerPath.points[0]);
  });
});

describe('sinkerBurnTimeSec', () => {
  it('time grows with depth + area', () => {
    const shallow = sinkerBurnTimeSec({
      electrodeMaterial: 'graphite', electrodeAreaMm2: 100,
      plungeDepthMm: 5, ampSetting: 10,
    });
    const deep = sinkerBurnTimeSec({
      electrodeMaterial: 'graphite', electrodeAreaMm2: 100,
      plungeDepthMm: 50, ampSetting: 10,
    });
    expect(deep).toBeGreaterThan(shallow * 5);
  });

  it('higher amps reduce time', () => {
    const slow = sinkerBurnTimeSec({
      electrodeMaterial: 'graphite', electrodeAreaMm2: 100,
      plungeDepthMm: 10, ampSetting: 2,
    });
    const fast = sinkerBurnTimeSec({
      electrodeMaterial: 'graphite', electrodeAreaMm2: 100,
      plungeDepthMm: 10, ampSetting: 20,
    });
    expect(fast).toBeLessThan(slow);
  });
});

describe('electrodeWearVolume', () => {
  it('tungsten-copper wears far less than graphite', () => {
    const tc = electrodeWearVolume({
      electrodeMaterial: 'tungsten-copper', electrodeAreaMm2: 100,
      plungeDepthMm: 10, ampSetting: 8,
    });
    const gr = electrodeWearVolume({
      electrodeMaterial: 'graphite', electrodeAreaMm2: 100,
      plungeDepthMm: 10, ampSetting: 8,
    });
    expect(tc).toBeLessThan(gr);
  });

  it('wear scales with cut volume', () => {
    const small = electrodeWearVolume({
      electrodeMaterial: 'copper', electrodeAreaMm2: 100,
      plungeDepthMm: 5, ampSetting: 8,
    });
    const big = electrodeWearVolume({
      electrodeMaterial: 'copper', electrodeAreaMm2: 100,
      plungeDepthMm: 50, ampSetting: 8,
    });
    expect(big).toBeCloseTo(small * 10, 4);
  });
});
