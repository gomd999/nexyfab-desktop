/**
 * feaResultDiff.ts — Compare two FEA result fields (stress /
 * displacement / temperature) before and after a design change.
 *
 * Workflow:
 *
 *   1. Run baseline FEA.
 *   2. Modify the part (e.g., add a fillet, add ribs).
 *   3. Run modified FEA.
 *   4. Diff the two result fields and highlight where the change
 *      *helped* (peak stress dropped) vs *hurt* (new hot spot).
 *
 * Module:
 *
 *   - Per-vertex difference Δ = after - before.
 *   - Top-K most-improved / worsened locations.
 *   - Overall verdict: improved / no-change / worse.
 */

export interface ResultField {
  /** Field id. */
  fieldName: string;
  /** Per-vertex (or per-element) scalar value. */
  values: number[];
}

export interface DiffPoint {
  /** Vertex / element index. */
  index: number;
  before: number;
  after: number;
  delta: number;
}

export type Verdict = 'improved' | 'no-change' | 'mixed' | 'worse';

export interface DiffResult {
  /** Per-vertex deltas. */
  deltas: number[];
  /** Top-K most-improved (largest negative delta). */
  topImproved: DiffPoint[];
  /** Top-K most-worsened (largest positive delta). */
  topWorsened: DiffPoint[];
  /** Statistics. */
  beforePeak: number;
  afterPeak: number;
  beforeMean: number;
  afterMean: number;
  rmsDelta: number;
  verdict: Verdict;
}

export interface DiffOptions {
  /** N entries to show in top-improved/worsened. */
  topK: number;
  /** Threshold below which delta is "no change". */
  noChangeThreshold: number;
  /** Sign convention: "lower-is-better" for stress; "higher" for safety factor. */
  goalDirection: 'lower-is-better' | 'higher-is-better';
}

export const DEFAULT_OPTIONS: DiffOptions = {
  topK: 10,
  noChangeThreshold: 0.01,
  goalDirection: 'lower-is-better',
};

// ── Top-level entry ────────────────────────────────────────────

export function diffResults(before: ResultField, after: ResultField, options: Partial<DiffOptions> = {}): DiffResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const n = Math.min(before.values.length, after.values.length);
  if (n === 0) {
    return {
      deltas: [], topImproved: [], topWorsened: [],
      beforePeak: 0, afterPeak: 0, beforeMean: 0, afterMean: 0, rmsDelta: 0,
      verdict: 'no-change',
    };
  }

  const deltas = new Array(n);
  let beforePeak = -Infinity;
  let afterPeak = -Infinity;
  let beforeSum = 0;
  let afterSum = 0;
  for (let i = 0; i < n; i++) {
    deltas[i] = after.values[i]! - before.values[i]!;
    if (Math.abs(before.values[i]!) > beforePeak) beforePeak = Math.abs(before.values[i]!);
    if (Math.abs(after.values[i]!) > afterPeak) afterPeak = Math.abs(after.values[i]!);
    beforeSum += before.values[i]!;
    afterSum += after.values[i]!;
  }
  const beforeMean = beforeSum / n;
  const afterMean = afterSum / n;
  const rms = Math.sqrt(deltas.reduce((s, d) => s + d * d, 0) / n);

  // Top improved / worsened.
  const points: DiffPoint[] = deltas.map((d, i) => ({
    index: i,
    before: before.values[i]!,
    after: after.values[i]!,
    delta: d,
  }));
  const sorted = [...points].sort((a, b) => a.delta - b.delta);
  const topImproved = (opts.goalDirection === 'lower-is-better' ? sorted : sorted.slice().reverse()).slice(0, opts.topK).filter(p => Math.abs(p.delta) > opts.noChangeThreshold);
  const topWorsened = (opts.goalDirection === 'lower-is-better' ? sorted.slice().reverse() : sorted).slice(0, opts.topK).filter(p => Math.abs(p.delta) > opts.noChangeThreshold);

  // Verdict.
  const verdict = classifyVerdict(beforePeak, afterPeak, opts);

  return {
    deltas,
    topImproved,
    topWorsened,
    beforePeak,
    afterPeak,
    beforeMean,
    afterMean,
    rmsDelta: rms,
    verdict,
  };
}

function classifyVerdict(beforePeak: number, afterPeak: number, opts: DiffOptions): Verdict {
  const delta = afterPeak - beforePeak;
  const relativeChange = beforePeak > 0 ? delta / beforePeak : 0;
  if (Math.abs(relativeChange) < 0.02) return 'no-change';
  if (opts.goalDirection === 'lower-is-better') {
    if (relativeChange < -0.05) return 'improved';
    if (relativeChange > 0.05) return 'worse';
    return 'mixed';
  } else {
    if (relativeChange > 0.05) return 'improved';
    if (relativeChange < -0.05) return 'worse';
    return 'mixed';
  }
}

// ── Per-region rollup ─────────────────────────────────────────

export interface RegionStats {
  regionId: string;
  beforeMean: number;
  afterMean: number;
  delta: number;
  verdict: Verdict;
}

export function rollupByRegion(
  before: ResultField,
  after: ResultField,
  regionAssignments: Map<number, string>,
  options: Partial<DiffOptions> = {},
): RegionStats[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const regions = new Map<string, { before: number[]; after: number[] }>();
  for (const [index, region] of regionAssignments) {
    const entry = regions.get(region) ?? { before: [], after: [] };
    if (before.values[index] !== undefined) entry.before.push(before.values[index]);
    if (after.values[index] !== undefined) entry.after.push(after.values[index]);
    regions.set(region, entry);
  }
  const out: RegionStats[] = [];
  for (const [regionId, data] of regions) {
    const bm = mean(data.before);
    const am = mean(data.after);
    out.push({
      regionId,
      beforeMean: bm,
      afterMean: am,
      delta: am - bm,
      verdict: classifyVerdict(Math.abs(bm), Math.abs(am), opts),
    });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ── Summary ────────────────────────────────────────────────────

export interface DiffSummary {
  pointCount: number;
  peakReductionPercent: number;
  meanReductionPercent: number;
  verdict: Verdict;
  improvedCount: number;
  worsenedCount: number;
}

export function summarize(result: DiffResult): DiffSummary {
  const peakReduction = result.beforePeak > 0 ? (result.beforePeak - result.afterPeak) / result.beforePeak * 100 : 0;
  const meanReduction = result.beforeMean !== 0 ? (result.beforeMean - result.afterMean) / Math.abs(result.beforeMean) * 100 : 0;
  return {
    pointCount: result.deltas.length,
    peakReductionPercent: peakReduction,
    meanReductionPercent: meanReduction,
    verdict: result.verdict,
    improvedCount: result.topImproved.length,
    worsenedCount: result.topWorsened.length,
  };
}
