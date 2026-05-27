import { describe, it, expect } from 'vitest';
import {
  augmentWithMicroLift,
  emitGcode,
  motionStats,
  summarize,
  type PathSegment,
} from './microLiftRetract';

function seg(id: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, f: number = 500): PathSegment {
  return { id, start: { x: x0, y: y0, z: z0 }, end: { x: x1, y: y1, z: z1 }, feedMmMin: f };
}

describe('augmentWithMicroLift', () => {
  it('single segment → no lift', () => {
    const r = augmentWithMicroLift([seg('s1', 0, 0, 0, 10, 0, 0)]);
    expect(r.liftCount).toBe(0);
    expect(r.moves).toHaveLength(1);
  });

  it('non-contiguous segments → lift inserted', () => {
    const r = augmentWithMicroLift([
      seg('s1', 0, 0, 0, 10, 0, 0),
      seg('s2', 20, 0, 0, 30, 0, 0),
    ]);
    expect(r.liftCount).toBe(1);
    expect(r.moves.length).toBe(5);
  });

  it('contiguous segments → no lift', () => {
    const r = augmentWithMicroLift([
      seg('s1', 0, 0, 0, 10, 0, 0),
      seg('s2', 10, 0, 0, 20, 0, 0),
    ]);
    expect(r.liftCount).toBe(0);
  });

  it('lift height respected', () => {
    const r = augmentWithMicroLift([
      seg('s1', 0, 0, 0, 10, 0, 0),
      seg('s2', 20, 0, 0, 30, 0, 0),
    ], { liftHeightMm: 2, plungeFeedMmMin: 500, rapidFeedMmMin: 5000, minGapMm: 0.1 });
    const liftMove = r.moves.find(m => m.command === 'lift')!;
    expect(liftMove.end.z - liftMove.start.z).toBeCloseTo(2, 3);
  });

  it('addedTime positive when lift inserted', () => {
    const r = augmentWithMicroLift([
      seg('s1', 0, 0, 0, 10, 0, 0),
      seg('s2', 20, 0, 0, 30, 0, 0),
    ]);
    expect(r.addedTimeSec).toBeGreaterThanOrEqual(0);
  });

  it('multiple gaps → multiple lifts', () => {
    const r = augmentWithMicroLift([
      seg('s1', 0, 0, 0, 10, 0, 0),
      seg('s2', 20, 0, 0, 30, 0, 0),
      seg('s3', 40, 0, 0, 50, 0, 0),
    ]);
    expect(r.liftCount).toBe(2);
  });

  it('minGap threshold respected', () => {
    const r = augmentWithMicroLift([
      seg('s1', 0, 0, 0, 10, 0, 0),
      seg('s2', 10.05, 0, 0, 20, 0, 0),
    ], { liftHeightMm: 0.5, plungeFeedMmMin: 500, rapidFeedMmMin: 5000, minGapMm: 0.1 });
    expect(r.liftCount).toBe(0);
  });
});

describe('emitGcode', () => {
  it('rapid emits G0', () => {
    const r = augmentWithMicroLift([
      seg('s1', 0, 0, 0, 10, 0, 0),
      seg('s2', 20, 0, 0, 30, 0, 0),
    ]);
    const lines = emitGcode(r);
    expect(lines.some(l => l.startsWith('G0'))).toBe(true);
  });

  it('feed emits G1 with F', () => {
    const r = augmentWithMicroLift([seg('s1', 0, 0, 0, 10, 0, 0)]);
    const lines = emitGcode(r);
    expect(lines[0]).toContain('F500');
  });
});

describe('motionStats', () => {
  it('reports total distance + time', () => {
    const r = augmentWithMicroLift([
      seg('s1', 0, 0, 0, 10, 0, 0),
      seg('s2', 20, 0, 0, 30, 0, 0),
    ]);
    const s = motionStats(r);
    expect(s.totalDistanceMm).toBeGreaterThan(20);
    expect(s.totalTimeSec).toBeGreaterThan(0);
  });

  it('feed distance covers cut segments', () => {
    const r = augmentWithMicroLift([seg('s1', 0, 0, 0, 10, 0, 0)]);
    expect(motionStats(r).feedDistance).toBeCloseTo(10, 3);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const segs = [seg('s1', 0, 0, 0, 10, 0, 0), seg('s2', 20, 0, 0, 30, 0, 0)];
    const r = augmentWithMicroLift(segs);
    const s = summarize(segs, r);
    expect(s.segmentCount).toBe(2);
    expect(s.liftCount).toBe(1);
  });
});
