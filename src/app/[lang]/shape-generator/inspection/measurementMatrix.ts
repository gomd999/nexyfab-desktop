/**
 * measurementMatrix.ts — Build an inspection measurement plan matrix.
 *
 * For every feature that needs to be inspected, the matrix specifies:
 *
 *   - Feature (e.g., "Hole Ø6.5 H7", "Plate flatness", "Bolt M5 thread").
 *   - Tolerance class (e.g., H7 / IT8 / ±0.05 / FLT0.05).
 *   - Inspection method (CMM / vernier / micrometer / gauge / vision).
 *   - Sample size (per AQL or fixed N).
 *   - Inspection frequency (every part / first off / every 10 / sample).
 *
 * The matrix is consumed by the shop floor app and reported to
 * customers as part of FAI (First Article Inspection) packets.
 */

export type InspectionMethod = 'cmm' | 'vernier' | 'micrometer' | 'gauge-pin' | 'go-no-go' | 'thread-gauge' | 'vision' | 'optical-comparator' | 'profilometer';

export type ToleranceClass = 'IT5' | 'IT6' | 'IT7' | 'IT8' | 'IT9' | 'IT10' | 'IT11' | '±0.01' | '±0.05' | '±0.1' | 'FLT0.05' | 'POS0.1' | 'custom';

export type SampleFrequency = 'first-article' | '100%' | 'every-10' | 'aql-2.5' | 'aql-1.0' | 'aql-0.4';

export interface Feature {
  id: string;
  /** Free-form description. */
  description: string;
  /** Nominal dimension if numeric. */
  nominalMm?: number;
  /** Feature category. */
  category: 'dimension' | 'gd&t-form' | 'gd&t-position' | 'thread' | 'surface' | 'visual';
  /** Indicates the importance: critical features get tighter inspection. */
  criticality: 'critical' | 'major' | 'minor';
}

export interface MatrixRow {
  feature: Feature;
  tolerance: ToleranceClass;
  /** Suggested method (highest confidence first). */
  primaryMethod: InspectionMethod;
  /** Alternate methods. */
  alternateMethods: InspectionMethod[];
  sampleSize: number;
  frequency: SampleFrequency;
  estimatedTimePerInspectionSec: number;
}

export interface BuildOptions {
  /** Per-criticality default frequency. */
  frequencyByCriticality: Partial<Record<Feature['criticality'], SampleFrequency>>;
}

export const DEFAULT_OPTIONS: BuildOptions = {
  frequencyByCriticality: {
    critical: '100%',
    major: 'every-10',
    minor: 'aql-2.5',
  },
};

// ── Top-level entry ────────────────────────────────────────────

export function buildMeasurementMatrix(features: Feature[], options: Partial<BuildOptions> = {}): MatrixRow[] {
  const opts = { ...DEFAULT_OPTIONS, ...options, frequencyByCriticality: { ...DEFAULT_OPTIONS.frequencyByCriticality, ...options.frequencyByCriticality } };
  return features.map(f => buildRow(f, opts));
}

function buildRow(feature: Feature, opts: BuildOptions): MatrixRow {
  const tolerance = suggestTolerance(feature);
  const { primary, alternates } = suggestMethod(feature);
  const freq = opts.frequencyByCriticality[feature.criticality] ?? 'aql-2.5';
  const sampleSize = inferSampleSize(freq);
  const time = estimateTime(primary, feature);
  return {
    feature,
    tolerance,
    primaryMethod: primary,
    alternateMethods: alternates,
    sampleSize,
    frequency: freq,
    estimatedTimePerInspectionSec: time,
  };
}

// ── Heuristics ────────────────────────────────────────────────

function suggestTolerance(feature: Feature): ToleranceClass {
  if (feature.category === 'gd&t-form') return 'FLT0.05';
  if (feature.category === 'gd&t-position') return 'POS0.1';
  if (feature.category === 'thread') return '±0.05';
  if (feature.category === 'surface') return '±0.05';
  if (feature.category === 'visual') return 'custom';
  // Dimension: tighter for critical.
  if (feature.criticality === 'critical') return 'IT7';
  if (feature.criticality === 'major') return 'IT8';
  return 'IT9';
}

function suggestMethod(feature: Feature): { primary: InspectionMethod; alternates: InspectionMethod[] } {
  switch (feature.category) {
    case 'dimension': {
      if (feature.criticality === 'critical') return { primary: 'cmm', alternates: ['micrometer', 'gauge-pin'] };
      if (feature.criticality === 'major') return { primary: 'micrometer', alternates: ['cmm', 'vernier'] };
      return { primary: 'vernier', alternates: ['micrometer', 'go-no-go'] };
    }
    case 'gd&t-form':
      return { primary: 'cmm', alternates: ['profilometer'] };
    case 'gd&t-position':
      return { primary: 'cmm', alternates: ['optical-comparator'] };
    case 'thread':
      return { primary: 'thread-gauge', alternates: ['go-no-go'] };
    case 'surface':
      return { primary: 'profilometer', alternates: ['vision'] };
    case 'visual':
      return { primary: 'vision', alternates: ['optical-comparator'] };
  }
}

function inferSampleSize(freq: SampleFrequency): number {
  switch (freq) {
    case '100%': return -1; // -1 = every part
    case 'first-article': return 1;
    case 'every-10': return 1; // 1 in 10
    case 'aql-2.5': return 8;
    case 'aql-1.0': return 13;
    case 'aql-0.4': return 20;
  }
}

function estimateTime(method: InspectionMethod, feature: Feature): number {
  const baseTimes: Record<InspectionMethod, number> = {
    cmm: 60, vernier: 10, micrometer: 15, 'gauge-pin': 5, 'go-no-go': 5,
    'thread-gauge': 10, vision: 30, 'optical-comparator': 45, profilometer: 90,
  };
  let t = baseTimes[method];
  if (feature.category === 'gd&t-form' || feature.category === 'gd&t-position') t *= 1.5;
  if (feature.criticality === 'critical') t *= 1.2;
  return t;
}

// ── Cost / time rollup ────────────────────────────────────────

export interface MatrixCostSummary {
  totalRows: number;
  criticalCount: number;
  estimatedTotalSecPerPart: number;
  /** Top methods used. */
  methodUsage: Record<InspectionMethod, number>;
}

export function rollupCost(matrix: MatrixRow[], partsCount: number = 1): MatrixCostSummary {
  const methodUsage: Record<InspectionMethod, number> = {
    cmm: 0, vernier: 0, micrometer: 0, 'gauge-pin': 0, 'go-no-go': 0,
    'thread-gauge': 0, vision: 0, 'optical-comparator': 0, profilometer: 0,
  };
  let totalTime = 0;
  let critical = 0;
  for (const row of matrix) {
    methodUsage[row.primaryMethod]++;
    if (row.feature.criticality === 'critical') critical++;
    const effectiveSamples = row.frequency === '100%' ? partsCount : row.sampleSize;
    totalTime += row.estimatedTimePerInspectionSec * effectiveSamples;
  }
  return {
    totalRows: matrix.length,
    criticalCount: critical,
    estimatedTotalSecPerPart: matrix.length > 0 ? totalTime / Math.max(1, partsCount) : 0,
    methodUsage,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface MatrixSummary {
  rowCount: number;
  criticalCount: number;
  primaryMethodCount: number;
  averageSampleSize: number;
  totalTimePerPartSec: number;
}

export function summarize(matrix: MatrixRow[]): MatrixSummary {
  if (matrix.length === 0) {
    return { rowCount: 0, criticalCount: 0, primaryMethodCount: 0, averageSampleSize: 0, totalTimePerPartSec: 0 };
  }
  const methods = new Set(matrix.map(r => r.primaryMethod));
  const critical = matrix.filter(r => r.feature.criticality === 'critical').length;
  const avgSample = matrix.reduce((s, r) => s + Math.max(0, r.sampleSize), 0) / matrix.length;
  const time = matrix.reduce((s, r) => s + r.estimatedTimePerInspectionSec, 0);
  return {
    rowCount: matrix.length,
    criticalCount: critical,
    primaryMethodCount: methods.size,
    averageSampleSize: avgSample,
    totalTimePerPartSec: time,
  };
}
