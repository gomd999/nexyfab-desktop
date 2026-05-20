/**
 * fitClassLookup.ts — Look up ISO 286 hole/shaft fit class details.
 *
 * Standard fits are denoted as Hole/Shaft combinations:
 *
 *   - Clearance fits (looser shaft):
 *     H7/g6  precision sliding
 *     H7/f7  running
 *     H7/e8  loose running
 *     H8/c11 large clearance
 *
 *   - Transition fits (tight tolerance, may interfere):
 *     H7/k6  press fit (locating)
 *     H7/n6  driving fit
 *
 *   - Interference fits (always tight):
 *     H7/p6  light press
 *     H7/s6  shrink
 *     H7/u6  forced
 *
 * Module:
 *   - Returns the named fit's hole+shaft deviations for a nominal
 *     diameter range.
 *   - Computes resulting clearance/interference min/max.
 *   - Recommends fit based on application (sliding/locating/press).
 */

export type FitName = 'H7/g6' | 'H7/f7' | 'H7/e8' | 'H7/h6' | 'H7/k6' | 'H7/n6' | 'H7/p6' | 'H7/s6' | 'H7/u6' | 'H8/c11';
export type FitCategory = 'clearance' | 'transition' | 'interference';

/** Deviation values (μm) — illustrative ISO 286 figures for size range 18-30 mm. */
export interface DeviationTable {
  /** Upper deviation, μm. */
  upper: number;
  /** Lower deviation, μm. */
  lower: number;
}

export const FIT_TABLE: Record<FitName, { hole: DeviationTable; shaft: DeviationTable; category: FitCategory; application: string }> = {
  'H7/g6': { hole: { upper: 21, lower: 0 }, shaft: { upper: -7, lower: -20 }, category: 'clearance', application: 'Precision sliding (spindle bearings).' },
  'H7/f7': { hole: { upper: 21, lower: 0 }, shaft: { upper: -20, lower: -41 }, category: 'clearance', application: 'Running fit, oil-lubricated.' },
  'H7/e8': { hole: { upper: 21, lower: 0 }, shaft: { upper: -40, lower: -73 }, category: 'clearance', application: 'Loose running, high temp.' },
  'H7/h6': { hole: { upper: 21, lower: 0 }, shaft: { upper: 0, lower: -13 }, category: 'clearance', application: 'Slide / locational fit.' },
  'H7/k6': { hole: { upper: 21, lower: 0 }, shaft: { upper: 15, lower: 2 }, category: 'transition', application: 'Press / locating fit (assemble with mallet).' },
  'H7/n6': { hole: { upper: 21, lower: 0 }, shaft: { upper: 28, lower: 15 }, category: 'transition', application: 'Driving / press fit.' },
  'H7/p6': { hole: { upper: 21, lower: 0 }, shaft: { upper: 35, lower: 22 }, category: 'interference', application: 'Light press fit.' },
  'H7/s6': { hole: { upper: 21, lower: 0 }, shaft: { upper: 48, lower: 35 }, category: 'interference', application: 'Shrink fit.' },
  'H7/u6': { hole: { upper: 21, lower: 0 }, shaft: { upper: 60, lower: 47 }, category: 'interference', application: 'Forced fit (heavy press, perm.).' },
  'H8/c11': { hole: { upper: 33, lower: 0 }, shaft: { upper: -110, lower: -240 }, category: 'clearance', application: 'Large clearance (gas/coarse).' },
};

export interface FitResult {
  fitName: FitName;
  category: FitCategory;
  /** Hole min/max diameter (mm). */
  holeDiameter: { min: number; max: number };
  /** Shaft min/max diameter (mm). */
  shaftDiameter: { min: number; max: number };
  /** Min clearance (negative = interference). */
  minClearance: number;
  /** Max clearance. */
  maxClearance: number;
  application: string;
}

// ── Top-level entry ────────────────────────────────────────────

export function evaluateFit(nominalMm: number, fit: FitName): FitResult {
  const entry = FIT_TABLE[fit];
  const holeMin = nominalMm + entry.hole.lower / 1000;
  const holeMax = nominalMm + entry.hole.upper / 1000;
  const shaftMin = nominalMm + entry.shaft.lower / 1000;
  const shaftMax = nominalMm + entry.shaft.upper / 1000;
  return {
    fitName: fit,
    category: entry.category,
    holeDiameter: { min: holeMin, max: holeMax },
    shaftDiameter: { min: shaftMin, max: shaftMax },
    minClearance: holeMin - shaftMax,
    maxClearance: holeMax - shaftMin,
    application: entry.application,
  };
}

// ── Recommend fit ─────────────────────────────────────────────

export type Application = 'spindle' | 'bushing' | 'press-fit' | 'locating' | 'shrink' | 'sliding';

export function recommendFit(app: Application): FitName {
  switch (app) {
    case 'spindle': return 'H7/g6';
    case 'bushing': return 'H7/f7';
    case 'sliding': return 'H7/h6';
    case 'locating': return 'H7/k6';
    case 'press-fit': return 'H7/p6';
    case 'shrink': return 'H7/s6';
  }
}

// ── Tolerance budget (sum of upper-lower) ─────────────────────

export interface ToleranceBudget {
  hole: number;
  shaft: number;
  total: number;
}

export function toleranceBudget(fit: FitName): ToleranceBudget {
  const entry = FIT_TABLE[fit];
  const hole = entry.hole.upper - entry.hole.lower;
  const shaft = entry.shaft.upper - entry.shaft.lower;
  return { hole, shaft, total: hole + shaft };
}

// ── Summary ────────────────────────────────────────────────────

export interface FitSummary {
  fitName: FitName;
  category: FitCategory;
  minClearance: number;
  maxClearance: number;
}

export function summarize(result: FitResult): FitSummary {
  return {
    fitName: result.fitName,
    category: result.category,
    minClearance: result.minClearance,
    maxClearance: result.maxClearance,
  };
}
