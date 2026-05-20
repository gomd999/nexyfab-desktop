/**
 * formingLimitDiagram.ts — Forming Limit Diagram (FLD) analysis for
 * sheet metal stamping operations.
 *
 * When you press-form a metal sheet, every point on the sheet
 * experiences a (major, minor) strain pair. Plot all those pairs
 * on a graph and compare against the material's *forming limit
 * curve* (FLC) — points above the curve will tear, points well
 * below are safe, points near it are "marginal". The FLD is the
 * single most important sheet-metal quality chart.
 *
 * FLC model used here: Keeler-Goodwin (right side, plane strain
 * minimum) + LDH (Limiting Dome Height) approximation for the
 * left side. Adjustable n-value (strain hardening) + thickness.
 *
 *   FLC0 (plane strain, minor strain = 0):
 *     FLC0 = (23.3 + 14.13 · t) · (n / 0.21)        [% major strain]
 *
 *   Right side (minor strain > 0): rises by ~14 percentage points
 *   per +0.5 minor strain.
 *
 *   Left side (minor strain < 0): drops to FLC0 - 0.2 · |minor| × 100.
 */

export interface StrainPoint {
  /** Optional location id (vertex / element). */
  id?: string;
  /** Major (larger) principal strain. */
  major: number;
  /** Minor (smaller) principal strain. */
  minor: number;
}

export type FLDZone = 'safe' | 'marginal' | 'fail';

export interface FLDClassifiedPoint extends StrainPoint {
  zone: FLDZone;
  /** Limit strain at this minor-strain value (% major). */
  limitMajorPercent: number;
  /** Margin (limit - measured) in major strain percentage points. */
  marginPoints: number;
}

export interface FLDResult {
  points: FLDClassifiedPoint[];
  /** Count per zone. */
  zoneCounts: { safe: number; marginal: number; fail: number };
  /** FLC0 used for analysis. */
  flc0Percent: number;
}

export interface FLDOptions {
  /** Sheet thickness in mm. */
  thicknessMm: number;
  /** Strain hardening exponent n (typical 0.18..0.25 for steel). */
  hardeningExponent: number;
  /** Marginal-zone band width (percentage points below the FLC). */
  marginBandPoints: number;
}

export const DEFAULT_OPTIONS: FLDOptions = {
  thicknessMm: 1.0,
  hardeningExponent: 0.22,
  marginBandPoints: 5,
};

// ── Top-level entry ────────────────────────────────────────────

export function analyzeFLD(strains: StrainPoint[], options: Partial<FLDOptions> = {}): FLDResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const flc0 = computeFLC0(opts.thicknessMm, opts.hardeningExponent);

  const classified: FLDClassifiedPoint[] = strains.map(s => {
    const measured = Math.max(Math.abs(s.major), Math.abs(s.minor));
    const limit = flcAt(s.minor, flc0);
    const margin = limit - measured * 100;
    let zone: FLDZone;
    if (margin >= opts.marginBandPoints) zone = 'safe';
    else if (margin >= 0) zone = 'marginal';
    else zone = 'fail';
    return { ...s, zone, limitMajorPercent: limit, marginPoints: margin };
  });

  const counts = { safe: 0, marginal: 0, fail: 0 };
  for (const c of classified) counts[c.zone]++;
  return { points: classified, zoneCounts: counts, flc0Percent: flc0 };
}

// ── FLC computation ────────────────────────────────────────────

export function computeFLC0(thicknessMm: number, nValue: number): number {
  // Clamp thickness to where Keeler-Goodwin is valid (0.3..3 mm).
  const t = Math.max(0.3, Math.min(3.0, thicknessMm));
  return (23.3 + 14.13 * t) * (nValue / 0.21);
}

export function flcAt(minorStrain: number, flc0Percent: number): number {
  // Right side: rises with positive minor strain.
  if (minorStrain >= 0) {
    return flc0Percent + 14 * (minorStrain / 0.5);
  }
  // Left side: linear drop, floor at 60% of FLC0.
  const drop = Math.abs(minorStrain) * 20;
  return Math.max(flc0Percent * 0.6, flc0Percent - drop);
}

// ── FLD curve sampling ─────────────────────────────────────────

export interface FLDCurvePoint {
  minorStrain: number;
  /** Major strain at the FLC, as fraction (not %). */
  majorAtLimit: number;
}

export function sampleFLDCurve(
  flc0Percent: number,
  minorRange: { min: number; max: number },
  samples: number,
): FLDCurvePoint[] {
  const out: FLDCurvePoint[] = [];
  for (let i = 0; i < samples; i++) {
    const t = samples === 1 ? 0 : i / (samples - 1);
    const minor = minorRange.min + (minorRange.max - minorRange.min) * t;
    out.push({ minorStrain: minor, majorAtLimit: flcAt(minor, flc0Percent) / 100 });
  }
  return out;
}

// ── Thinning estimate ──────────────────────────────────────────

/** Plastic incompressibility gives thinning = -(major + minor). */
export function estimateThinning(point: StrainPoint, originalThicknessMm: number): number {
  const thicknessStrain = -(point.major + point.minor);
  return originalThicknessMm * Math.exp(thicknessStrain);
}

// ── Summary ────────────────────────────────────────────────────

export interface FLDSummary {
  totalPoints: number;
  failFraction: number;
  marginalFraction: number;
  worstMarginPoints: number;
  hasFailure: boolean;
}

export function summarize(result: FLDResult): FLDSummary {
  const total = result.points.length;
  if (total === 0) {
    return { totalPoints: 0, failFraction: 0, marginalFraction: 0, worstMarginPoints: 0, hasFailure: false };
  }
  const worst = result.points.reduce((m, p) => Math.min(m, p.marginPoints), Infinity);
  return {
    totalPoints: total,
    failFraction: result.zoneCounts.fail / total,
    marginalFraction: result.zoneCounts.marginal / total,
    worstMarginPoints: worst,
    hasFailure: result.zoneCounts.fail > 0,
  };
}
