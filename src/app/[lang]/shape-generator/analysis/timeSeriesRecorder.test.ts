import { describe, it, expect } from 'vitest';
import {
  TimeSeriesRecorder,
  percentile,
  exponentialSmooth,
} from './timeSeriesRecorder';

describe('TimeSeriesRecorder — channels', () => {
  it('addChannel creates one', () => {
    const r = new TimeSeriesRecorder();
    r.addChannel('fps');
    expect(r.getChannel('fps')).not.toBeNull();
  });

  it('record auto-creates channel', () => {
    const r = new TimeSeriesRecorder();
    r.record('drawCalls', 100);
    expect(r.getChannel('drawCalls')?.recent).toHaveLength(1);
  });

  it('listChannels enumerates', () => {
    const r = new TimeSeriesRecorder();
    r.record('a', 1);
    r.record('b', 2);
    expect(r.listChannels()).toHaveLength(2);
  });
});

describe('TimeSeriesRecorder — recording + ring buffer', () => {
  it('records sample with timestamp', () => {
    const r = new TimeSeriesRecorder();
    r.record('fps', 60, 1000);
    expect(r.getChannel('fps')!.recent[0]).toEqual({ t: 1000, v: 60 });
  });

  it('ring buffer caps at recentMax', () => {
    const r = new TimeSeriesRecorder({ recentMax: 3 });
    for (let i = 0; i < 10; i++) r.record('fps', i, i);
    expect(r.getChannel('fps')!.recent).toHaveLength(3);
  });

  it('evicted samples roll into buckets', () => {
    const r = new TimeSeriesRecorder({ recentMax: 2, bucketMs: 1000 });
    r.record('fps', 30, 0);
    r.record('fps', 60, 500);
    r.record('fps', 90, 800);
    expect(r.getChannel('fps')!.buckets.length).toBeGreaterThan(0);
  });
});

describe('TimeSeriesRecorder — queries', () => {
  it('queryWindow returns samples in range', () => {
    const r = new TimeSeriesRecorder();
    r.record('fps', 60, 1000);
    r.record('fps', 50, 2000);
    r.record('fps', 40, 3000);
    expect(r.queryWindow('fps', 1500, 2500)).toHaveLength(1);
  });

  it('latest returns N most recent', () => {
    const r = new TimeSeriesRecorder();
    for (let i = 0; i < 5; i++) r.record('fps', i, i);
    const last2 = r.latest('fps', 2);
    expect(last2).toHaveLength(2);
    expect(last2[1]!.v).toBe(4);
  });

  it('statistics reports min/max/mean', () => {
    const r = new TimeSeriesRecorder();
    r.record('fps', 30);
    r.record('fps', 60);
    r.record('fps', 90);
    const stats = r.statistics('fps');
    expect(stats.min).toBe(30);
    expect(stats.max).toBe(90);
    expect(stats.mean).toBe(60);
    expect(stats.lastValue).toBe(90);
  });

  it('empty channel statistics → zeros', () => {
    const r = new TimeSeriesRecorder();
    r.addChannel('empty');
    expect(r.statistics('empty').lastValue).toBeNull();
  });

  it('trend returns 0 for too-few samples', () => {
    const r = new TimeSeriesRecorder();
    r.record('fps', 60);
    expect(r.trend('fps', 1000)).toBe(0);
  });
});

describe('TimeSeriesRecorder — bucket rollup', () => {
  it('bucket has correct count after eviction', () => {
    const r = new TimeSeriesRecorder({ recentMax: 1, bucketMs: 1000 });
    r.record('fps', 30, 100);
    r.record('fps', 60, 200);
    r.record('fps', 90, 300);
    const buckets = r.getChannel('fps')!.buckets;
    expect(buckets[0]!.count).toBeGreaterThan(0);
  });

  it('bucket min/max correct', () => {
    const r = new TimeSeriesRecorder({ recentMax: 1, bucketMs: 1000 });
    r.record('fps', 30, 100);
    r.record('fps', 90, 200);
    r.record('fps', 60, 300);
    r.record('fps', 0, 400);
    const buckets = r.getChannel('fps')!.buckets;
    expect(buckets[0]!.max).toBeGreaterThanOrEqual(60);
    expect(buckets[0]!.min).toBeLessThanOrEqual(60);
  });
});

describe('TimeSeriesRecorder — serialization', () => {
  it('round-trips channels + buckets', () => {
    const r = new TimeSeriesRecorder({ recentMax: 2, bucketMs: 1000 });
    r.record('fps', 30, 0);
    r.record('fps', 60, 500);
    r.record('fps', 90, 800);
    const json = r.serialize();
    const r2 = new TimeSeriesRecorder();
    r2.load(json);
    expect(r2.getChannel('fps')!.recent.length).toBe(r.getChannel('fps')!.recent.length);
  });

  it('load rejects bad version', () => {
    const r = new TimeSeriesRecorder();
    expect(() => r.load({ version: 99, channels: [] })).toThrow();
  });
});

describe('TimeSeriesRecorder — clear', () => {
  it('clear(channelId) clears one channel', () => {
    const r = new TimeSeriesRecorder();
    r.record('a', 1);
    r.record('b', 2);
    r.clear('a');
    expect(r.getChannel('a')!.recent).toHaveLength(0);
    expect(r.getChannel('b')!.recent).toHaveLength(1);
  });

  it('clear() clears all channels', () => {
    const r = new TimeSeriesRecorder();
    r.record('a', 1);
    r.record('b', 2);
    r.clear();
    expect(r.getChannel('a')!.recent).toHaveLength(0);
    expect(r.getChannel('b')!.recent).toHaveLength(0);
  });
});

describe('percentile', () => {
  it('50th percentile = median', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBeGreaterThanOrEqual(2);
    expect(percentile([1, 2, 3, 4, 5], 50)).toBeLessThanOrEqual(4);
  });

  it('100th percentile = max', () => {
    expect(percentile([1, 5, 3], 100)).toBe(5);
  });

  it('empty input → 0', () => {
    expect(percentile([], 50)).toBe(0);
  });
});

describe('exponentialSmooth', () => {
  it('alpha=1 preserves input', () => {
    const samples = [{ t: 0, v: 10 }, { t: 1, v: 20 }];
    const r = exponentialSmooth(samples, 1);
    expect(r[1]!.v).toBe(20);
  });

  it('alpha=0 keeps the first value', () => {
    const samples = [{ t: 0, v: 10 }, { t: 1, v: 20 }];
    const r = exponentialSmooth(samples, 0);
    expect(r[1]!.v).toBe(10);
  });

  it('empty input → empty', () => {
    expect(exponentialSmooth([], 0.5)).toEqual([]);
  });
});
