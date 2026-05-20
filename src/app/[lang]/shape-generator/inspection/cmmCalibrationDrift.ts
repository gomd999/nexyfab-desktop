/**
 * cmmCalibrationDrift.ts — Track CMM calibration drift over time.
 *
 * Coordinate Measuring Machines (CMMs) drift over time due to:
 *   - Probe wear.
 *   - Thermal expansion of scales.
 *   - Mechanical wear of guides.
 *
 * Calibration with a master sphere (or ring gauge) reports
 * measured-vs-nominal each calibration cycle. Drift = deviation
 * trend. Module:
 *
 *   - Linear regression of measured vs date for drift rate.
 *   - Identifies anomalous calibration events (Grubbs-style).
 *   - Predicts next calibration date based on tolerance budget.
 */

export interface CalibrationEvent {
  /** ISO date of calibration. */
  date: string;
  /** Measured value (mm). */
  measured: number;
  /** Nominal value (mm). */
  nominal: number;
  /** Optional ambient temperature (°C). */
  temperatureC?: number;
}

export interface DriftAnalysisOptions {
  /** Maximum allowable drift (mm). */
  toleranceMm: number;
  /** Grubbs outlier threshold (sigma). */
  outlierSigma: number;
}

export const DEFAULT_OPTIONS: DriftAnalysisOptions = {
  toleranceMm: 0.01,
  outlierSigma: 2.5,
};

export interface DriftResult {
  /** Slope of deviation per day (mm/day). */
  driftRateMmPerDay: number;
  /** Intercept (mm). */
  baselineDeviationMm: number;
  /** R² value. */
  rSquared: number;
  /** Predicted days until tolerance reached (from latest event). */
  daysUntilOutOfTolerance: number;
  /** Outlier event indices. */
  outlierIndices: number[];
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function analyzeDrift(events: CalibrationEvent[], options: Partial<DriftAnalysisOptions> = {}): DriftResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (events.length < 2) {
    return {
      driftRateMmPerDay: 0, baselineDeviationMm: 0, rSquared: 0,
      daysUntilOutOfTolerance: Infinity, outlierIndices: [],
      warnings: events.length === 0 ? ['No calibration events.'] : ['Only one event; need ≥2 for trend.'],
    };
  }
  const sorted = events.slice().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const baseDate = new Date(sorted[0]!.date).getTime();
  const points = sorted.map(e => ({
    t: (new Date(e.date).getTime() - baseDate) / (24 * 3600 * 1000),
    d: e.measured - e.nominal,
  }));

  // Linear regression: d = a + b·t
  const n = points.length;
  let sumT = 0, sumD = 0, sumTT = 0, sumTD = 0;
  for (const p of points) {
    sumT += p.t;
    sumD += p.d;
    sumTT += p.t * p.t;
    sumTD += p.t * p.d;
  }
  const denom = n * sumTT - sumT * sumT;
  const slope = denom === 0 ? 0 : (n * sumTD - sumT * sumD) / denom;
  const intercept = (sumD - slope * sumT) / n;

  // R²
  let ssTot = 0, ssRes = 0;
  const meanD = sumD / n;
  for (const p of points) {
    const pred = intercept + slope * p.t;
    ssRes += (p.d - pred) ** 2;
    ssTot += (p.d - meanD) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  // Outliers via Grubbs-style: deviation from regression line / stddev.
  const residuals = points.map(p => p.d - (intercept + slope * p.t));
  const sigma = Math.sqrt(ssRes / Math.max(1, n - 2));
  const outlierIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (sigma > 0 && Math.abs(residuals[i]!) > opts.outlierSigma * sigma) {
      outlierIndices.push(i);
    }
  }

  // Days until out of tolerance.
  const latest = points[n - 1]!;
  const latestPred = intercept + slope * latest.t;
  let daysUntil = Infinity;
  if (slope > 0) {
    daysUntil = (opts.toleranceMm - latestPred) / slope;
  } else if (slope < 0) {
    daysUntil = (-opts.toleranceMm - latestPred) / slope;
  }
  if (daysUntil < 0) daysUntil = 0;

  const warnings: string[] = [];
  if (outlierIndices.length > 0) warnings.push(`${outlierIndices.length} outlier event(s) detected.`);
  if (Math.abs(latestPred) > opts.toleranceMm) warnings.push(`Latest deviation already out of tolerance.`);
  if (r2 < 0.5) warnings.push(`Low R² ${r2.toFixed(2)}; drift trend is noisy.`);

  return {
    driftRateMmPerDay: slope,
    baselineDeviationMm: intercept,
    rSquared: r2,
    daysUntilOutOfTolerance: daysUntil,
    outlierIndices,
    warnings,
  };
}

// ── Predict next calibration date ─────────────────────────────

export function nextCalibrationDate(latestEvent: CalibrationEvent, days: number): string {
  const t = new Date(latestEvent.date).getTime() + days * 24 * 3600 * 1000;
  const d = new Date(t);
  return d.toISOString().slice(0, 10);
}

// ── Temperature correlation ───────────────────────────────────

export interface TemperatureCorrelation {
  correlation: number;
  /** True if deviation correlates with temperature > 0.6 |r|. */
  thermallyDriven: boolean;
}

export function temperatureCorrelation(events: CalibrationEvent[]): TemperatureCorrelation {
  const filtered = events.filter(e => e.temperatureC !== undefined);
  if (filtered.length < 3) return { correlation: 0, thermallyDriven: false };
  const xs = filtered.map(e => e.temperatureC!);
  const ys = filtered.map(e => e.measured - e.nominal);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const r = dx2 === 0 || dy2 === 0 ? 0 : num / Math.sqrt(dx2 * dy2);
  return { correlation: r, thermallyDriven: Math.abs(r) > 0.6 };
}

// ── Summary ────────────────────────────────────────────────────

export interface DriftSummary {
  eventCount: number;
  driftRateMmPerDay: number;
  daysUntilOutOfTolerance: number;
  outlierCount: number;
  warningCount: number;
}

export function summarize(events: CalibrationEvent[], result: DriftResult): DriftSummary {
  return {
    eventCount: events.length,
    driftRateMmPerDay: result.driftRateMmPerDay,
    daysUntilOutOfTolerance: result.daysUntilOutOfTolerance,
    outlierCount: result.outlierIndices.length,
    warningCount: result.warnings.length,
  };
}
