/**
 * rainflowCycleCounter.ts — Rainflow algorithm for counting fatigue
 * cycles in a stress history.
 *
 * Rainflow counting (Matsuishi-Endo / ASTM E1049) is the standard
 * way to convert an irregular stress vs time history into a
 * discrete list of cycles + half-cycles, each with mean stress and
 * range. The output feeds into a Miner-rule fatigue damage sum:
 *
 *     D = Σ (nᵢ / Nᵢ)
 *
 * where nᵢ is the cycle count at amplitude i and Nᵢ is the
 * allowable count from the S-N curve.
 *
 * Module implements the 4-point peak-valley algorithm:
 *
 *   1. Extract peaks and valleys (turning points).
 *   2. Apply the rainflow rule: while window of 4 forms a closed
 *      cycle (|B-C| ≤ |A-B| and |B-C| ≤ |C-D|), extract that cycle.
 *   3. Repeat until no more cycles can be closed.
 *   4. Leftover residuals are half cycles.
 */

export interface CycleResult {
  /** Mean stress. */
  mean: number;
  /** Stress range (peak - valley). */
  range: number;
  /** 1.0 for full cycle, 0.5 for half cycle. */
  count: number;
}

export interface RainflowResult {
  cycles: CycleResult[];
  /** Number of full cycles. */
  fullCycleCount: number;
  /** Number of half cycles. */
  halfCycleCount: number;
  /** Total damage (caller-multiplied if S-N curve passed). */
  totalRange: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function countCycles(history: number[]): RainflowResult {
  if (history.length < 2) {
    return { cycles: [], fullCycleCount: 0, halfCycleCount: 0, totalRange: 0 };
  }
  const peaks = extractPeaksValleys(history);
  const cycles = extractRainflowCycles(peaks);

  let full = 0, half = 0, total = 0;
  for (const c of cycles) {
    if (c.count >= 1) full++;
    else half++;
    total += c.range;
  }
  return { cycles, fullCycleCount: full, halfCycleCount: half, totalRange: total };
}

// ── Peak/valley extraction ────────────────────────────────────

export function extractPeaksValleys(history: number[]): number[] {
  if (history.length === 0) return [];
  const peaks: number[] = [history[0]!];
  for (let i = 1; i < history.length - 1; i++) {
    const prev = history[i - 1]!;
    const cur = history[i]!;
    const next = history[i + 1]!;
    if ((cur > prev && cur > next) || (cur < prev && cur < next)) {
      peaks.push(cur);
    }
  }
  peaks.push(history[history.length - 1]!);
  return peaks;
}

// ── Rainflow cycle extraction ─────────────────────────────────

function extractRainflowCycles(peaks: number[]): CycleResult[] {
  const stack: number[] = [];
  const cycles: CycleResult[] = [];

  for (const p of peaks) {
    stack.push(p);
    while (stack.length >= 4) {
      const n = stack.length;
      const A = stack[n - 4]!;
      const B = stack[n - 3]!;
      const C = stack[n - 2]!;
      const D = stack[n - 1]!;
      const rangeBC = Math.abs(B - C);
      const rangeAB = Math.abs(A - B);
      const rangeCD = Math.abs(C - D);
      if (rangeBC <= rangeAB && rangeBC <= rangeCD) {
        // Extract cycle B-C.
        cycles.push({
          mean: (B + C) / 2,
          range: rangeBC,
          count: 1.0,
        });
        // Remove B and C.
        stack.splice(n - 3, 2);
      } else {
        break;
      }
    }
  }
  // Remaining peaks are half cycles.
  for (let i = 0; i < stack.length - 1; i++) {
    const a = stack[i]!;
    const b = stack[i + 1]!;
    cycles.push({
      mean: (a + b) / 2,
      range: Math.abs(a - b),
      count: 0.5,
    });
  }
  return cycles;
}

// ── Miner damage sum ──────────────────────────────────────────

export interface SNCurvePoint {
  /** Stress amplitude (MPa). */
  amplitudeMpa: number;
  /** Allowable cycles to failure. */
  N: number;
}

export interface MinerDamage {
  totalDamage: number;
  /** Per-cycle damage contribution. */
  contributions: Array<{ cycleIndex: number; damage: number }>;
}

export function minerDamage(cycles: CycleResult[], snCurve: SNCurvePoint[]): MinerDamage {
  const contributions: MinerDamage['contributions'] = [];
  let total = 0;
  for (let i = 0; i < cycles.length; i++) {
    const c = cycles[i]!;
    const amplitude = c.range / 2;
    const N = interpolateSN(amplitude, snCurve);
    if (N === Infinity || N === 0) continue;
    const damage = c.count / N;
    contributions.push({ cycleIndex: i, damage });
    total += damage;
  }
  return { totalDamage: total, contributions };
}

function interpolateSN(amplitude: number, snCurve: SNCurvePoint[]): number {
  if (snCurve.length === 0) return Infinity;
  const sorted = [...snCurve].sort((a, b) => a.amplitudeMpa - b.amplitudeMpa);
  if (amplitude <= sorted[0]!.amplitudeMpa) return sorted[0]!.N;
  if (amplitude >= sorted[sorted.length - 1]!.amplitudeMpa) return sorted[sorted.length - 1]!.N;
  for (let i = 1; i < sorted.length; i++) {
    if (amplitude <= sorted[i]!.amplitudeMpa) {
      const lo = sorted[i - 1]!;
      const hi = sorted[i]!;
      // Log-log interpolation.
      const tAmp = (Math.log(amplitude) - Math.log(lo.amplitudeMpa)) / (Math.log(hi.amplitudeMpa) - Math.log(lo.amplitudeMpa));
      const logN = Math.log(lo.N) + tAmp * (Math.log(hi.N) - Math.log(lo.N));
      return Math.exp(logN);
    }
  }
  return Infinity;
}

// ── Histogram ────────────────────────────────────────────────

export interface RangeHistogramBin {
  rangeLower: number;
  rangeUpper: number;
  count: number;
}

export function rangeHistogram(cycles: CycleResult[], binCount: number = 10): RangeHistogramBin[] {
  if (cycles.length === 0) return [];
  const ranges = cycles.map(c => c.range);
  const min = Math.min(...ranges);
  const max = Math.max(...ranges);
  const width = (max - min) / binCount || 1;
  const bins: RangeHistogramBin[] = [];
  for (let i = 0; i < binCount; i++) {
    const lower = min + i * width;
    const upper = i === binCount - 1 ? max : lower + width;
    const count = cycles.filter(c => c.range >= lower && (i === binCount - 1 ? c.range <= upper : c.range < upper))
      .reduce((s, c) => s + c.count, 0);
    bins.push({ rangeLower: lower, rangeUpper: upper, count });
  }
  return bins;
}

// ── Summary ────────────────────────────────────────────────────

export interface RainflowSummary {
  cycleCount: number;
  fullCycleCount: number;
  halfCycleCount: number;
  maxRange: number;
  meanRange: number;
}

export function summarize(result: RainflowResult): RainflowSummary {
  if (result.cycles.length === 0) {
    return { cycleCount: 0, fullCycleCount: 0, halfCycleCount: 0, maxRange: 0, meanRange: 0 };
  }
  const max = result.cycles.reduce((m, c) => Math.max(m, c.range), 0);
  const mean = result.cycles.reduce((s, c) => s + c.range, 0) / result.cycles.length;
  return {
    cycleCount: result.cycles.length,
    fullCycleCount: result.fullCycleCount,
    halfCycleCount: result.halfCycleCount,
    maxRange: max,
    meanRange: mean,
  };
}
