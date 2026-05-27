import { describe, it, expect } from 'vitest';
import {
  analyzeCycle,
  compareCycles,
  summarize,
  type MotionSegment,
} from './cutVsAirTimeRatio';

function seg(op: string, kind: MotionSegment['kind'], time: number, distance: number = 0): MotionSegment {
  return { opId: op, kind, timeSec: time, distanceMm: distance };
}

describe('analyzeCycle', () => {
  it('empty input → zeros', () => {
    const r = analyzeCycle([]);
    expect(r.totalSec).toBe(0);
    expect(r.cuttingFraction).toBe(0);
  });

  it('aggregates time by kind', () => {
    const segs = [seg('OP1', 'cutting', 30), seg('OP1', 'rapid', 10)];
    const r = analyzeCycle(segs);
    expect(r.cuttingSec).toBe(30);
    expect(r.rapidSec).toBe(10);
    expect(r.totalSec).toBe(40);
  });

  it('cutting fraction = cutting / total', () => {
    const segs = [seg('OP1', 'cutting', 30), seg('OP1', 'rapid', 10)];
    const r = analyzeCycle(segs);
    expect(r.cuttingFraction).toBeCloseTo(0.75, 5);
  });

  it('per-operation breakdown', () => {
    const segs = [
      seg('OP1', 'cutting', 10),
      seg('OP1', 'rapid', 2),
      seg('OP2', 'cutting', 5),
    ];
    const r = analyzeCycle(segs);
    expect(r.perOperation).toHaveLength(2);
    const op1 = r.perOperation.find(o => o.opId === 'OP1')!;
    expect(op1.cuttingFraction).toBeCloseTo(10 / 12, 5);
  });

  it('low cutting fraction triggers recommendation', () => {
    const segs = [seg('OP1', 'cutting', 5), seg('OP1', 'rapid', 100)];
    const r = analyzeCycle(segs);
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  it('frequent tool changes triggers recommendation', () => {
    const segs = [
      seg('OP1', 'cutting', 10),
      seg('OP1', 'tool-change', 5),
      seg('OP1', 'tool-change', 5),
    ];
    const r = analyzeCycle(segs);
    expect(r.recommendations.some(x => x.includes('Tool changes'))).toBe(true);
  });

  it('rapid > cutting triggers recommendation', () => {
    const segs = [seg('OP1', 'cutting', 10), seg('OP1', 'rapid', 30)];
    const r = analyzeCycle(segs);
    expect(r.recommendations.some(x => x.toLowerCase().includes('rapid'))).toBe(true);
  });

  it('high dwell triggers recommendation', () => {
    const segs = [seg('OP1', 'cutting', 50), seg('OP1', 'dwell', 10)];
    const r = analyzeCycle(segs);
    expect(r.recommendations.some(x => x.includes('Dwell'))).toBe(true);
  });

  it('per-operation sorted by total time desc', () => {
    const segs = [
      seg('SHORT', 'cutting', 1),
      seg('LONG', 'cutting', 100),
    ];
    const r = analyzeCycle(segs);
    expect(r.perOperation[0]!.opId).toBe('LONG');
  });
});

describe('compareCycles', () => {
  it('positive timeSaved when after is shorter', () => {
    const before = analyzeCycle([seg('OP1', 'cutting', 10), seg('OP1', 'rapid', 10)]);
    const after = analyzeCycle([seg('OP1', 'cutting', 10), seg('OP1', 'rapid', 5)]);
    const c = compareCycles(before, after);
    expect(c.timeSavedSec).toBe(5);
  });

  it('fraction delta positive when after is more efficient', () => {
    const before = analyzeCycle([seg('OP1', 'cutting', 10), seg('OP1', 'rapid', 90)]);
    const after = analyzeCycle([seg('OP1', 'cutting', 50), seg('OP1', 'rapid', 50)]);
    const c = compareCycles(before, after);
    expect(c.fractionDelta).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const s = summarize(analyzeCycle([]));
    expect(s.totalMinutes).toBe(0);
    expect(s.isEfficient).toBe(false);
  });

  it('efficient when ≥ 70% cutting', () => {
    const segs = [seg('OP1', 'cutting', 80), seg('OP1', 'rapid', 20)];
    const s = summarize(analyzeCycle(segs));
    expect(s.isEfficient).toBe(true);
  });

  it('reports operation count', () => {
    const segs = [seg('OP1', 'cutting', 1), seg('OP2', 'cutting', 1)];
    const s = summarize(analyzeCycle(segs));
    expect(s.operationCount).toBe(2);
  });
});
