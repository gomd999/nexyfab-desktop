/**
 * timeSeriesRecorder.ts — Time-series buffer with downsampling.
 *
 * The existing `lib/telemetry.ts` collects discrete event records.
 * For things like FPS history, render time per frame, FEA solver
 * iterations vs. residual, we want a continuous **time-series** —
 * a stream of (timestamp, value) tuples, with bounded memory and a
 * cheap downsampling strategy for long sessions.
 *
 * Design:
 *
 *   - **Ring buffer** holds the most recent N raw samples.
 *   - **Bucketing** rolls older samples into fixed-width buckets
 *     (min / mean / max / count) for the long-term history without
 *     unbounded growth.
 *   - **Multi-channel** support (e.g. fps, drawCalls, memoryMb).
 *   - **Query helpers**: window slice, statistics, trend (delta over
 *     last N seconds).
 */

export interface Sample {
  /** Timestamp (ms epoch). */
  t: number;
  /** Value. */
  v: number;
}

export interface Bucket {
  /** Start time (ms). */
  startMs: number;
  /** End time (ms). */
  endMs: number;
  /** Sample count. */
  count: number;
  /** Min / mean / max. */
  min: number;
  max: number;
  mean: number;
}

export interface Channel {
  id: string;
  /** Recent raw samples (ring-buffer). */
  recent: Sample[];
  /** Cap on raw samples. */
  recentMax: number;
  /** Rolled-up buckets (older history). */
  buckets: Bucket[];
  /** Bucket size in ms. */
  bucketMs: number;
  /** Bucket cap (oldest evicted). */
  bucketMax: number;
}

export interface RecorderOptions {
  /** Default recent-sample cap per channel. */
  recentMax: number;
  /** Default bucket width (ms). */
  bucketMs: number;
  /** Default bucket cap per channel. */
  bucketMax: number;
}

export const DEFAULT_RECORDER_OPTIONS: RecorderOptions = {
  recentMax: 600, // 10 minutes at 1Hz
  bucketMs: 60_000, // 1-minute buckets
  bucketMax: 1440, // 24 hours of 1-min buckets
};

// ── Recorder ───────────────────────────────────────────────────

export class TimeSeriesRecorder {
  private channels = new Map<string, Channel>();
  private options: RecorderOptions;

  constructor(options: Partial<RecorderOptions> = {}) {
    this.options = { ...DEFAULT_RECORDER_OPTIONS, ...options };
  }

  // ── Channel management ────────────────────────────────────

  addChannel(id: string, options: Partial<Pick<Channel, 'recentMax' | 'bucketMs' | 'bucketMax'>> = {}): Channel {
    const channel: Channel = {
      id,
      recent: [],
      recentMax: options.recentMax ?? this.options.recentMax,
      buckets: [],
      bucketMs: options.bucketMs ?? this.options.bucketMs,
      bucketMax: options.bucketMax ?? this.options.bucketMax,
    };
    this.channels.set(id, channel);
    return channel;
  }

  getChannel(id: string): Channel | null {
    return this.channels.get(id) ?? null;
  }

  listChannels(): Channel[] {
    return [...this.channels.values()];
  }

  // ── Recording ────────────────────────────────────────────

  record(channelId: string, value: number, timestamp?: number): void {
    let channel = this.channels.get(channelId);
    if (!channel) channel = this.addChannel(channelId);
    const sample: Sample = { t: timestamp ?? Date.now(), v: value };
    channel.recent.push(sample);
    while (channel.recent.length > channel.recentMax) {
      const evicted = channel.recent.shift()!;
      this.rollIntoBucket(channel, evicted);
    }
  }

  private rollIntoBucket(channel: Channel, sample: Sample): void {
    const bucketStart = Math.floor(sample.t / channel.bucketMs) * channel.bucketMs;
    let bucket = channel.buckets[channel.buckets.length - 1];
    if (!bucket || bucket.startMs !== bucketStart) {
      bucket = {
        startMs: bucketStart,
        endMs: bucketStart + channel.bucketMs,
        count: 0,
        min: Infinity,
        max: -Infinity,
        mean: 0,
      };
      channel.buckets.push(bucket);
      while (channel.buckets.length > channel.bucketMax) channel.buckets.shift();
    }
    // Welford-like update for mean.
    const newCount = bucket.count + 1;
    bucket.mean = bucket.mean + (sample.v - bucket.mean) / newCount;
    bucket.count = newCount;
    if (sample.v < bucket.min) bucket.min = sample.v;
    if (sample.v > bucket.max) bucket.max = sample.v;
  }

  // ── Queries ──────────────────────────────────────────────

  queryWindow(channelId: string, startMs: number, endMs: number): Sample[] {
    const channel = this.channels.get(channelId);
    if (!channel) return [];
    return channel.recent.filter(s => s.t >= startMs && s.t <= endMs);
  }

  latest(channelId: string, count: number = 1): Sample[] {
    const channel = this.channels.get(channelId);
    if (!channel) return [];
    return channel.recent.slice(-count);
  }

  statistics(channelId: string): { count: number; min: number; max: number; mean: number; lastValue: number | null } {
    const channel = this.channels.get(channelId);
    if (!channel || channel.recent.length === 0) {
      return { count: 0, min: 0, max: 0, mean: 0, lastValue: null };
    }
    let min = Infinity, max = -Infinity, sum = 0;
    for (const s of channel.recent) {
      if (s.v < min) min = s.v;
      if (s.v > max) max = s.v;
      sum += s.v;
    }
    return {
      count: channel.recent.length,
      min,
      max,
      mean: sum / channel.recent.length,
      lastValue: channel.recent[channel.recent.length - 1]!.v,
    };
  }

  /** Trend = (latest - earliest) over the last `windowMs` ms. */
  trend(channelId: string, windowMs: number): number {
    const channel = this.channels.get(channelId);
    if (!channel || channel.recent.length < 2) return 0;
    const cutoff = Date.now() - windowMs;
    const inWindow = channel.recent.filter(s => s.t >= cutoff);
    if (inWindow.length < 2) return 0;
    return inWindow[inWindow.length - 1]!.v - inWindow[0]!.v;
  }

  // ── Aggregated history ───────────────────────────────────

  /** Returns recent samples + bucketed history sorted by time. */
  fullHistory(channelId: string): Array<Sample | Bucket> {
    const channel = this.channels.get(channelId);
    if (!channel) return [];
    return [...channel.buckets, ...channel.recent];
  }

  // ── Persistence ──────────────────────────────────────────

  serialize(): SerializedRecorder {
    return {
      version: 1,
      channels: [...this.channels.values()].map(c => ({
        id: c.id,
        recentMax: c.recentMax,
        bucketMs: c.bucketMs,
        bucketMax: c.bucketMax,
        recent: c.recent.slice(),
        buckets: c.buckets.map(b => ({ ...b })),
      })),
    };
  }

  load(data: SerializedRecorder): void {
    if (data.version !== 1) throw new Error(`Unsupported version ${data.version}`);
    this.channels.clear();
    for (const c of data.channels) {
      this.channels.set(c.id, {
        id: c.id,
        recentMax: c.recentMax,
        bucketMs: c.bucketMs,
        bucketMax: c.bucketMax,
        recent: c.recent.slice(),
        buckets: c.buckets.map(b => ({ ...b })),
      });
    }
  }

  clear(channelId?: string): void {
    if (channelId) {
      const c = this.channels.get(channelId);
      if (c) {
        c.recent = [];
        c.buckets = [];
      }
    } else {
      for (const c of this.channels.values()) {
        c.recent = [];
        c.buckets = [];
      }
    }
  }
}

export interface SerializedRecorder {
  version: number;
  channels: Array<{
    id: string;
    recentMax: number;
    bucketMs: number;
    bucketMax: number;
    recent: Sample[];
    buckets: Bucket[];
  }>;
}

// ── Helpers ────────────────────────────────────────────────────

/** Percentile of `values` (0..100). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx]!;
}

/** Simple exponential smoothing of a value stream. */
export function exponentialSmooth(samples: Sample[], alpha: number): Sample[] {
  if (samples.length === 0) return [];
  const out: Sample[] = [{ ...samples[0]! }];
  for (let i = 1; i < samples.length; i++) {
    const prev = out[out.length - 1]!.v;
    const cur = samples[i]!.v;
    out.push({ t: samples[i]!.t, v: alpha * cur + (1 - alpha) * prev });
  }
  return out;
}
