/**
 * gageRR.ts — Compute Gage R&R (Repeatability & Reproducibility) per
 * AIAG MSA 4th ed.
 *
 * Gage R&R partitions measurement variation into:
 *
 *   - Repeatability (EV): same operator + same gage variability.
 *   - Reproducibility (AV): operator-to-operator variability.
 *   - Part variation (PV): between-part variability.
 *   - Total variation (TV): combined.
 *
 * % GR&R = GR&R / TV × 100.
 *
 * Acceptance thresholds:
 *   - < 10% → acceptable
 *   - 10-30% → marginal (may accept depending on cost/importance)
 *   - > 30% → unacceptable
 *
 * Module supports the average-range method (ARM, AIAG).
 */

export interface MeasurementSample {
  partId: string;
  operatorId: string;
  trial: number;
  value: number;
}

export interface GageRROptions {
  /** Trial count per part-operator pair. */
  trialCount: number;
  /** AIAG d2* table key (≈ 1.128 for n=2). */
  d2Star: number;
}

export const DEFAULT_OPTIONS: GageRROptions = {
  trialCount: 2,
  d2Star: 1.128,
};

export interface GageRRResult {
  /** Equipment Variation (Repeatability). */
  evSigma: number;
  /** Appraiser Variation (Reproducibility). */
  avSigma: number;
  /** Combined GRR. */
  grrSigma: number;
  /** Part Variation. */
  pvSigma: number;
  /** Total Variation. */
  tvSigma: number;
  /** Percent metrics. */
  percentEv: number;
  percentAv: number;
  percentGrr: number;
  percentPv: number;
  classification: 'acceptable' | 'marginal' | 'unacceptable';
}

// ── Top-level entry ────────────────────────────────────────────

export function computeGageRR(samples: MeasurementSample[], options: Partial<GageRROptions> = {}): GageRRResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Group samples by (part, operator).
  const groups = new Map<string, number[]>();
  const parts = new Set<string>();
  const operators = new Set<string>();
  for (const s of samples) {
    parts.add(s.partId);
    operators.add(s.operatorId);
    const key = `${s.partId}::${s.operatorId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s.value);
  }

  // R-bar: mean range across all (part, operator) pairs.
  let totalRange = 0;
  let rangeCount = 0;
  for (const vals of groups.values()) {
    if (vals.length < 2) continue;
    totalRange += Math.max(...vals) - Math.min(...vals);
    rangeCount++;
  }
  const rBar = rangeCount === 0 ? 0 : totalRange / rangeCount;
  const ev = rBar / opts.d2Star;

  // X-bar diff per operator (R0 = max X̄ − min X̄).
  const operatorMeans = new Map<string, number[]>();
  for (const s of samples) {
    if (!operatorMeans.has(s.operatorId)) operatorMeans.set(s.operatorId, []);
    operatorMeans.get(s.operatorId)!.push(s.value);
  }
  const operatorMeanValues = Array.from(operatorMeans.values()).map(arr => arr.reduce((a, b) => a + b, 0) / arr.length);
  const xDiff = operatorMeanValues.length < 2 ? 0 : Math.max(...operatorMeanValues) - Math.min(...operatorMeanValues);
  const operatorCount = operators.size;
  const partCount = parts.size;
  const trialCount = opts.trialCount;
  // AV = sqrt((X̄ / d2*)² - EV² / (parts × trials))
  const d2OperatorStar = operatorCount === 2 ? 1.41 : operatorCount === 3 ? 1.91 : 2.24;
  const avSquared = Math.pow(xDiff / d2OperatorStar, 2) - (ev * ev) / Math.max(1, partCount * trialCount);
  const av = avSquared > 0 ? Math.sqrt(avSquared) : 0;

  const grr = Math.sqrt(ev * ev + av * av);

  // Part variation: range of part averages divided by d2*.
  const partMeans = new Map<string, number[]>();
  for (const s of samples) {
    if (!partMeans.has(s.partId)) partMeans.set(s.partId, []);
    partMeans.get(s.partId)!.push(s.value);
  }
  const partMeanValues = Array.from(partMeans.values()).map(arr => arr.reduce((a, b) => a + b, 0) / arr.length);
  const rp = partMeanValues.length < 2 ? 0 : Math.max(...partMeanValues) - Math.min(...partMeanValues);
  const d2PartStar = partCount === 2 ? 1.41 : partCount === 3 ? 1.91 : partCount === 4 ? 2.24 : 2.48;
  const pv = rp / d2PartStar;

  const tv = Math.sqrt(grr * grr + pv * pv);
  const percent = (x: number) => tv === 0 ? 0 : (x / tv) * 100;
  const percentGrr = percent(grr);

  let classification: GageRRResult['classification'];
  if (percentGrr < 10) classification = 'acceptable';
  else if (percentGrr <= 30) classification = 'marginal';
  else classification = 'unacceptable';

  return {
    evSigma: ev, avSigma: av, grrSigma: grr, pvSigma: pv, tvSigma: tv,
    percentEv: percent(ev),
    percentAv: percent(av),
    percentGrr,
    percentPv: percent(pv),
    classification,
  };
}

// ── Number of distinct categories ────────────────────────────

export function numberOfDistinctCategories(result: GageRRResult): number {
  if (result.grrSigma === 0) return Infinity;
  return Math.floor(1.41 * result.pvSigma / result.grrSigma);
}

// ── Operator bias ────────────────────────────────────────────

export interface OperatorBias {
  operatorId: string;
  meanDeviation: number;
}

export function operatorBias(samples: MeasurementSample[]): OperatorBias[] {
  const grouped = new Map<string, number[]>();
  let grandMean = 0;
  for (const s of samples) {
    if (!grouped.has(s.operatorId)) grouped.set(s.operatorId, []);
    grouped.get(s.operatorId)!.push(s.value);
    grandMean += s.value;
  }
  grandMean /= Math.max(1, samples.length);
  return Array.from(grouped.entries()).map(([id, vals]) => ({
    operatorId: id,
    meanDeviation: vals.reduce((a, b) => a + b, 0) / vals.length - grandMean,
  }));
}

// ── Summary ────────────────────────────────────────────────────

export interface GageRRSummary {
  percentGrr: number;
  classification: GageRRResult['classification'];
  ndc: number;
  partCount: number;
  operatorCount: number;
}

export function summarize(samples: MeasurementSample[], result: GageRRResult): GageRRSummary {
  const parts = new Set(samples.map(s => s.partId));
  const ops = new Set(samples.map(s => s.operatorId));
  return {
    percentGrr: result.percentGrr,
    classification: result.classification,
    ndc: numberOfDistinctCategories(result),
    partCount: parts.size,
    operatorCount: ops.size,
  };
}
