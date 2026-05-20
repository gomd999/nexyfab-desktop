import { describe, it, expect } from 'vitest';
import {
  generateFinishingPasses,
  summarize,
  type SurfaceRegion,
} from './finishingPassGenerator';

function region(id: string, w: number = 100, h: number = 50, slope: number = 0): SurfaceRegion {
  return {
    id,
    bboxMin: { x: 0, y: 0 },
    bboxMax: { x: w, y: h },
    slopeDeg: slope,
    areaMm2: w * h,
  };
}

describe('generateFinishingPasses', () => {
  it('empty regions → empty passes', () => {
    const r = generateFinishingPasses([]);
    expect(r.passes).toEqual([]);
  });

  it('parallel raster produces zig-zag', () => {
    const r = generateFinishingPasses([region('r1')], { strategy: 'parallel-raster', stepoverMm: 10 });
    expect(r.passes[0]!.points.length).toBeGreaterThan(4);
  });

  it('spiral starts at center', () => {
    const r = generateFinishingPasses([region('r1', 100, 100)], { strategy: 'spiral' });
    const first = r.passes[0]!.points[0]!;
    expect(first.x).toBeCloseTo(50, 1);
    expect(first.y).toBeCloseTo(50, 1);
  });

  it('strategy reported per region', () => {
    const regions = [region('flat', 100, 50, 0), region('steep', 100, 50, 80)];
    const r = generateFinishingPasses(regions, { strategy: 'parallel-raster' });
    expect(r.strategyByRegion.size).toBe(2);
  });

  it('pencil-cleanup on flat region falls back to raster', () => {
    const r = generateFinishingPasses([region('flat', 100, 50, 5)], { strategy: 'pencil-cleanup' });
    expect(r.strategyByRegion.get('flat')).not.toBe('pencil-cleanup');
  });

  it('total length sums per-pass lengths', () => {
    const regions = [region('a'), region('b', 200, 100)];
    const r = generateFinishingPasses(regions, { stepoverMm: 5 });
    const expected = r.passes.reduce((s, p) => s + p.totalLengthMm, 0);
    expect(r.totalLengthMm).toBeCloseTo(expected, 3);
  });

  it('smaller stepover → more passes points', () => {
    const small = generateFinishingPasses([region('a')], { stepoverMm: 0.5 });
    const big = generateFinishingPasses([region('a')], { stepoverMm: 5 });
    expect(small.passes[0]!.points.length).toBeGreaterThan(big.passes[0]!.points.length);
  });

  it('constant-scallop uses smaller stepover than parallel raster', () => {
    const para = generateFinishingPasses([region('a')], { strategy: 'parallel-raster', stepoverMm: 2 });
    const sc = generateFinishingPasses([region('a')], { strategy: 'constant-scallop', scallopHeightMm: 0.005 });
    expect(sc.passes[0]!.points.length).toBeGreaterThan(para.passes[0]!.points.length);
  });

  it('pencil-cleanup closes polyline back to start', () => {
    const r = generateFinishingPasses([region('a', 100, 50, 50)], { strategy: 'pencil-cleanup' });
    const pts = r.passes[0]!.points;
    expect(pts[0]).toEqual(pts[pts.length - 1]);
  });

  it('total time scales inversely with feed', () => {
    const fast = generateFinishingPasses([region('a')], { strategy: 'parallel-raster' }, 5000);
    const slow = generateFinishingPasses([region('a')], { strategy: 'parallel-raster' }, 500);
    expect(slow.totalTimeSec).toBeGreaterThan(fast.totalTimeSec);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const s = summarize({ passes: [], strategyByRegion: new Map(), totalLengthMm: 0, totalTimeSec: 0 });
    expect(s.passCount).toBe(0);
  });

  it('reports longest pass id', () => {
    const regions = [region('small', 50, 30), region('big', 500, 500)];
    const r = generateFinishingPasses(regions);
    const s = summarize(r);
    expect(s.longestPassId).toContain('big');
  });

  it('time in minutes', () => {
    const r = generateFinishingPasses([region('a')]);
    const s = summarize(r);
    expect(s.totalTimeMin).toBeCloseTo(r.totalTimeSec / 60, 5);
  });
});
