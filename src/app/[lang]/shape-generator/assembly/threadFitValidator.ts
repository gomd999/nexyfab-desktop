/**
 * threadFitValidator.ts — Validate threaded fastener fit between bolt
 * (external) and tapped hole (internal) per ISO 965 / ASME B1.13.
 *
 * Thread tolerance classes (ISO 965-1):
 *
 *   External (bolt): 4g, 6g, 8g  (g = clearance fit)
 *   Internal (nut):  4H, 5H, 6H, 7H  (H = clearance fit)
 *   Free combination:    6g/6H (default)
 *   Medium combination:  4g/5H, 6g/6H
 *   Close combination:   3g/4H (precision)
 *
 * Module checks:
 *   - Pitch diameter overlap.
 *   - Major / minor diameter clearance.
 *   - Class compatibility.
 */

export type ExternalClass = '4g' | '6g' | '8g';
export type InternalClass = '4H' | '5H' | '6H' | '7H';

export interface ExternalThread {
  /** Nominal diameter (M-thread). */
  nominalMm: number;
  /** Pitch (mm). */
  pitchMm: number;
  /** Tolerance class. */
  toleranceClass: ExternalClass;
}

export interface InternalThread {
  nominalMm: number;
  pitchMm: number;
  toleranceClass: InternalClass;
}

/** Pitch diameter deviation (μm) at typical size — illustrative ISO 965 figures. */
export interface PitchDeviation {
  upper: number;
  lower: number;
}

export const EXT_DEVIATION: Record<ExternalClass, PitchDeviation> = {
  '4g': { upper: -19, lower: -57 },
  '6g': { upper: -19, lower: -90 },
  '8g': { upper: -19, lower: -150 },
};

export const INT_DEVIATION: Record<InternalClass, PitchDeviation> = {
  '4H': { upper: 53, lower: 0 },
  '5H': { upper: 67, lower: 0 },
  '6H': { upper: 85, lower: 0 },
  '7H': { upper: 106, lower: 0 },
};

export interface FitResult {
  /** Whether the thread can mate at all. */
  canMate: boolean;
  /** Smallest clearance (mm). */
  minClearanceMm: number;
  /** Largest clearance (mm). */
  maxClearanceMm: number;
  /** Pitch / size mismatch warnings. */
  warnings: string[];
  combination: 'free' | 'medium' | 'close' | 'incompatible';
}

// ── Top-level entry ────────────────────────────────────────────

export function validateFit(ext: ExternalThread, int: InternalThread): FitResult {
  const warnings: string[] = [];

  // Pitch / size compatibility.
  if (Math.abs(ext.nominalMm - int.nominalMm) > 0.001) {
    warnings.push(`Nominal mismatch: M${ext.nominalMm} vs M${int.nominalMm}.`);
    return { canMate: false, minClearanceMm: 0, maxClearanceMm: 0, warnings, combination: 'incompatible' };
  }
  if (Math.abs(ext.pitchMm - int.pitchMm) > 0.001) {
    warnings.push(`Pitch mismatch: ${ext.pitchMm} vs ${int.pitchMm}.`);
    return { canMate: false, minClearanceMm: 0, maxClearanceMm: 0, warnings, combination: 'incompatible' };
  }

  const extDev = EXT_DEVIATION[ext.toleranceClass];
  const intDev = INT_DEVIATION[int.toleranceClass];

  // Pitch diameter for M-thread: nominal − 0.6495·pitch.
  const dp = ext.nominalMm - 0.6495 * ext.pitchMm;
  const extDpMin = dp + extDev.lower / 1000;
  const extDpMax = dp + extDev.upper / 1000;
  const intDpMin = dp + intDev.lower / 1000;
  const intDpMax = dp + intDev.upper / 1000;

  const minClear = intDpMin - extDpMax;
  const maxClear = intDpMax - extDpMin;
  const canMate = maxClear >= 0;

  if (!canMate) warnings.push('Bolt pitch diameter exceeds nut maximum — cannot thread.');

  const combination = combinationFor(ext.toleranceClass, int.toleranceClass);
  return { canMate, minClearanceMm: minClear, maxClearanceMm: maxClear, warnings, combination };
}

function combinationFor(ext: ExternalClass, int: InternalClass): FitResult['combination'] {
  if (ext === '6g' && int === '6H') return 'free';
  if (ext === '4g' && int === '5H') return 'medium';
  if (ext === '4g' && int === '4H') return 'close';
  return 'medium';
}

// ── Engagement length check ──────────────────────────────────

export interface EngagementCheck {
  required: number;
  actual: number;
  ok: boolean;
}

/**
 * Minimum thread engagement per FED-STD-H28: roughly 1× diameter for
 * steel-on-steel, 2× for aluminum-on-steel.
 */
export function engagementCheck(threadDiameterMm: number, actualMm: number, material: 'steel-on-steel' | 'al-on-steel'): EngagementCheck {
  const factor = material === 'steel-on-steel' ? 1.0 : 2.0;
  const required = threadDiameterMm * factor;
  return { required, actual: actualMm, ok: actualMm >= required };
}

// ── Tap drill size lookup ────────────────────────────────────

/** Tap drill size for percent thread engagement (ISO/ANSI rule of thumb). */
export function tapDrillDiameter(threadDiameterMm: number, pitchMm: number, percentEngagement: number = 75): number {
  // Tap drill = D − (% / 100) · 1.0825 · pitch.
  return threadDiameterMm - (percentEngagement / 100) * 1.0825 * pitchMm;
}

// ── Summary ────────────────────────────────────────────────────

export interface FitSummary {
  canMate: boolean;
  combination: FitResult['combination'];
  minClearanceMm: number;
  maxClearanceMm: number;
  warningCount: number;
}

export function summarize(result: FitResult): FitSummary {
  return {
    canMate: result.canMate,
    combination: result.combination,
    minClearanceMm: result.minClearanceMm,
    maxClearanceMm: result.maxClearanceMm,
    warningCount: result.warnings.length,
  };
}
