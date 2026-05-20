/**
 * stressRatioPlot.ts — Compute stress ratio = applied stress /
 * allowable stress for each FEA element, ready for contour plotting.
 *
 * Stress ratio (SR) is a normalised quantity:
 *
 *   SR = von Mises / yield × safety factor
 *
 * SR > 1.0 → yielding.
 * SR > 0.67 (typical) → conservative design (66% utilisation).
 *
 * Module:
 *   - Per-element SR.
 *   - Histogram of SR distribution.
 *   - Find peak SR element + recommend safety factor.
 *   - Output ready for colour map / contour plot.
 */

export interface FeaElementStress {
  id: string;
  vonMisesMpa: number;
  /** Material yield (MPa). */
  yieldMpa: number;
}

export interface PlotOptions {
  /** Safety factor applied to yield. */
  safetyFactor: number;
  /** Histogram bin count. */
  bins: number;
  /** SR threshold above which to flag. */
  warnThreshold: number;
  /** SR threshold above which the element is failed. */
  failThreshold: number;
}

export const DEFAULT_OPTIONS: PlotOptions = {
  safetyFactor: 1.5,
  bins: 10,
  warnThreshold: 0.67,
  failThreshold: 1.0,
};

export type Status = 'safe' | 'warn' | 'fail';

export interface ElementRatio {
  id: string;
  vonMisesMpa: number;
  allowableMpa: number;
  stressRatio: number;
  status: Status;
}

export interface PlotResult {
  ratios: ElementRatio[];
  histogram: { binCenter: number; count: number }[];
  peakElementId: string | null;
  peakStressRatio: number;
  /** Recommended safety factor for safe operation. */
  recommendedSafetyFactor: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function computeStressRatios(elements: FeaElementStress[], options: Partial<PlotOptions> = {}): PlotResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (elements.length === 0) {
    return { ratios: [], histogram: [], peakElementId: null, peakStressRatio: 0, recommendedSafetyFactor: opts.safetyFactor };
  }

  const ratios: ElementRatio[] = elements.map(e => {
    const allowable = e.yieldMpa / Math.max(0.001, opts.safetyFactor);
    const sr = e.vonMisesMpa / Math.max(0.001, allowable);
    const status: Status = sr >= opts.failThreshold ? 'fail' : sr >= opts.warnThreshold ? 'warn' : 'safe';
    return { id: e.id, vonMisesMpa: e.vonMisesMpa, allowableMpa: allowable, stressRatio: sr, status };
  });

  // Histogram.
  let maxSr = 0;
  for (const r of ratios) if (r.stressRatio > maxSr) maxSr = r.stressRatio;
  const binWidth = maxSr / opts.bins;
  const histogram = Array.from({ length: opts.bins }, (_, i) => ({
    binCenter: binWidth * (i + 0.5),
    count: 0,
  }));
  for (const r of ratios) {
    const bin = Math.min(opts.bins - 1, Math.floor(r.stressRatio / Math.max(1e-9, binWidth)));
    histogram[bin]!.count++;
  }

  // Peak.
  let peakId = ratios[0]!.id;
  let peakSr = ratios[0]!.stressRatio;
  for (const r of ratios) {
    if (r.stressRatio > peakSr) { peakSr = r.stressRatio; peakId = r.id; }
  }

  // Recommended SF: peak vM / target allowable (use yield × 0.67 as target).
  const peakVm = ratios.find(r => r.id === peakId)!.vonMisesMpa;
  const targetAllowable = elements.find(e => e.id === peakId)!.yieldMpa * 0.67;
  const recommended = peakVm > 0 ? Math.max(opts.safetyFactor, peakVm / Math.max(0.001, targetAllowable) * opts.safetyFactor) : opts.safetyFactor;

  return {
    ratios,
    histogram,
    peakElementId: peakId,
    peakStressRatio: peakSr,
    recommendedSafetyFactor: recommended,
  };
}

// ── Colour map ───────────────────────────────────────────────

export interface ColourBand {
  minSr: number;
  maxSr: number;
  rgb: [number, number, number];
  label: string;
}

export function defaultColourMap(): ColourBand[] {
  return [
    { minSr: 0, maxSr: 0.5, rgb: [0, 200, 0], label: 'safe' },
    { minSr: 0.5, maxSr: 0.67, rgb: [150, 200, 0], label: 'low-utilisation' },
    { minSr: 0.67, maxSr: 0.85, rgb: [255, 200, 0], label: 'moderate' },
    { minSr: 0.85, maxSr: 1.0, rgb: [255, 100, 0], label: 'high' },
    { minSr: 1.0, maxSr: Infinity, rgb: [255, 0, 0], label: 'fail' },
  ];
}

export function colourFor(sr: number, map: ColourBand[] = defaultColourMap()): [number, number, number] {
  for (const band of map) {
    if (sr >= band.minSr && sr < band.maxSr) return band.rgb;
  }
  return [128, 128, 128];
}

// ── Aggregate stats ──────────────────────────────────────────

export interface RatioStats {
  total: number;
  safeCount: number;
  warnCount: number;
  failCount: number;
  meanRatio: number;
  utilisationPct: number;
}

export function aggregate(result: PlotResult): RatioStats {
  let safe = 0, warn = 0, fail = 0;
  let sum = 0;
  for (const r of result.ratios) {
    if (r.status === 'safe') safe++;
    else if (r.status === 'warn') warn++;
    else fail++;
    sum += r.stressRatio;
  }
  return {
    total: result.ratios.length,
    safeCount: safe,
    warnCount: warn,
    failCount: fail,
    meanRatio: result.ratios.length === 0 ? 0 : sum / result.ratios.length,
    utilisationPct: result.peakStressRatio * 100,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface PlotSummary {
  elementCount: number;
  peakStressRatio: number;
  failCount: number;
  recommendedSafetyFactor: number;
}

export function summarize(result: PlotResult): PlotSummary {
  const stats = aggregate(result);
  return {
    elementCount: result.ratios.length,
    peakStressRatio: result.peakStressRatio,
    failCount: stats.failCount,
    recommendedSafetyFactor: result.recommendedSafetyFactor,
  };
}
