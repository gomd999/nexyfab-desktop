/**
 * cycleTimeDistribution.ts — Statistical distribution analysis of
 * CAM cycle times across a job batch.
 *
 * When running many parts, the cycle time varies due to tool wear,
 * material variation, operator differences. Statistical analysis
 * helps:
 *
 *   - Identify outliers (a 60-second part among 40-second parts =
 *     check tool/jam).
 *   - Predict completion time (mean ± std deviation).
 *   - Establish cpk-like process capability for cycle time.
 *
 * Module computes:
 *
 *   - Histogram with configurable bins.
 *   - Mean, median, std dev.
 *   - Percentiles (p50, p75, p95, p99).
 *   - Outlier list (> mean + 2σ).
 *   - Process-capability proxy (target ± tolerance).
 */

export interface CycleRecord {
  /** Cycle id (e.g., serial number). */
  cycleId: string;
  /** Duration in seconds. */
  durationSec: number;
  /** Optional outcome flag. */
  outcome?: 'ok' | 'rework' | 'scrap';
}

export interface HistogramBin {
  lowerSec: number;
  upperSec: number;
  count: number;
}

export interface DistributionResult {
  count: number;
  meanSec: number;
  medianSec: number;
  stdDevSec: number;
  minSec: number;
  maxSec: number;
  p75Sec: number;
  p95Sec: number;
  p99Sec: number;
  histogram: HistogramBin[];
  outliers: CycleRecord[];
}

export interface AnalysisOptions {
  /** Number of histogram bins. */
  binCount: number;
  /** Outlier threshold: mean + N·stddev. */
  outlierSigma: number;
}

export const DEFAULT_OPTIONS: AnalysisOptions = {
  binCount: 10,
  outlierSigma: 2,
};

// ── Top-level entry ────────────────────────────────────────────

export function analyzeDistribution(records: CycleRecord[], options: Partial<AnalysisOptions> = {}): DistributionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (records.length === 0) {
    return {
      count: 0, meanSec: 0, medianSec: 0, stdDevSec: 0,
      minSec: 0, maxSec: 0, p75Sec: 0, p95Sec: 0, p99Sec: 0,
      histogram: [], outliers: [],
    };
  }

  const sorted = [...records].sort((a, b) => a.durationSec - b.durationSec);
  const durations = sorted.map(r => r.durationSec);
  const min = durations[0]!;
  const max = durations[durations.length - 1]!;
  const mean = durations.reduce((s, d) => s + d, 0) / durations.length;
  const variance = durations.reduce((s, d) => s + (d - mean) ** 2, 0) / durations.length;
  const stdDev = Math.sqrt(variance);
  const median = percentile(durations, 0.5);
  const p75 = percentile(durations, 0.75);
  const p95 = percentile(durations, 0.95);
  const p99 = percentile(durations, 0.99);

  // Histogram.
  const histogram: HistogramBin[] = [];
  const range = max - min || 1;
  const binWidth = range / opts.binCount;
  for (let i = 0; i < opts.binCount; i++) {
    const lower = min + i * binWidth;
    const upper = i === opts.binCount - 1 ? max : lower + binWidth;
    const count = durations.filter(d => d >= lower && (i === opts.binCount - 1 ? d <= upper : d < upper)).length;
    histogram.push({ lowerSec: lower, upperSec: upper, count });
  }

  // Outliers.
  const threshold = mean + opts.outlierSigma * stdDev;
  const outliers = records.filter(r => r.durationSec > threshold);

  return {
    count: records.length,
    meanSec: mean,
    medianSec: median,
    stdDevSec: stdDev,
    minSec: min,
    maxSec: max,
    p75Sec: p75,
    p95Sec: p95,
    p99Sec: p99,
    histogram,
    outliers,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

// ── Process capability (Cpk-like) ─────────────────────────────

export interface CapabilityCheck {
  /** Cpk-style index. */
  cpk: number;
  /** Within-spec count. */
  withinSpecCount: number;
  /** Within-spec fraction. */
  withinSpecFraction: number;
  /** Yield (fraction of "ok" records). */
  yieldFraction: number;
}

export function computeCapability(records: CycleRecord[], targetSec: number, toleranceSec: number): CapabilityCheck {
  if (records.length === 0) {
    return { cpk: 0, withinSpecCount: 0, withinSpecFraction: 0, yieldFraction: 0 };
  }
  const upper = targetSec + toleranceSec;
  const lower = targetSec - toleranceSec;
  const within = records.filter(r => r.durationSec >= lower && r.durationSec <= upper).length;
  const okCount = records.filter(r => r.outcome === 'ok' || r.outcome === undefined).length;
  const stats = analyzeDistribution(records);
  const cpkUpper = stats.stdDevSec > 0 ? (upper - stats.meanSec) / (3 * stats.stdDevSec) : Infinity;
  const cpkLower = stats.stdDevSec > 0 ? (stats.meanSec - lower) / (3 * stats.stdDevSec) : Infinity;
  return {
    cpk: Math.min(cpkUpper, cpkLower),
    withinSpecCount: within,
    withinSpecFraction: within / records.length,
    yieldFraction: okCount / records.length,
  };
}

// ── Comparison ────────────────────────────────────────────────

export interface BatchComparison {
  meanDelta: number;
  stdDevDelta: number;
  improvedYield: boolean;
}

export function compareBatches(a: DistributionResult, b: DistributionResult): BatchComparison {
  return {
    meanDelta: b.meanSec - a.meanSec,
    stdDevDelta: b.stdDevSec - a.stdDevSec,
    improvedYield: b.meanSec < a.meanSec && b.stdDevSec <= a.stdDevSec,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface DistributionSummary {
  count: number;
  meanMinutes: number;
  variabilityCoeff: number;
  outlierFraction: number;
  isConsistent: boolean;
}

export function summarize(result: DistributionResult): DistributionSummary {
  const cv = result.meanSec > 0 ? result.stdDevSec / result.meanSec : 0;
  return {
    count: result.count,
    meanMinutes: result.meanSec / 60,
    variabilityCoeff: cv,
    outlierFraction: result.count > 0 ? result.outliers.length / result.count : 0,
    isConsistent: cv < 0.1,
  };
}
