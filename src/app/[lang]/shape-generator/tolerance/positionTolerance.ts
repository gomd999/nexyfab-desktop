/**
 * positionTolerance.ts — ASME Y14.5 / ISO 1101 position tolerance
 * with bonus tolerance, virtual condition, and datum shift.
 *
 * The position-tolerance callout `⌖ ⌀0.2 Ⓜ A Ⓜ B C` means:
 *   - Feature must lie within a Ø0.2 cylinder positioned by the
 *     datum reference frame.
 *   - **Bonus** Ⓜ on the feature: the tolerance zone *grows* as the
 *     feature departs from its Maximum Material Condition (MMC).
 *     A 10.00/10.20 hole at MMC=10.00 — when produced at 10.15, the
 *     bonus is 0.15, giving a Ø(0.2+0.15) = Ø0.35 tolerance zone.
 *   - **Datum shift** Ⓜ on a datum: the datum reference frame itself
 *     can shift / rotate by the datum feature's departure from MMC.
 *   - **Virtual condition (VC)** — the boundary that mating parts
 *     must clear. For external feature at MMC: VC = MMC + position.
 *     For internal feature at MMC: VC = MMC - position.
 *
 * This module provides the math used by:
 *   - drawing GD&T evaluator (does this measured feature pass?)
 *   - DFM checker (does this hole pattern have enough clearance after
 *     bonus depletion?)
 */

export type MaterialCondition = 'MMC' | 'LMC' | 'RFS';
export type FeatureType = 'external' | 'internal';

export interface FeatureSize {
  /** Maximum material condition diameter (mm). For a pin: largest; for a hole: smallest. */
  mmcDiameterMm: number;
  /** Least material condition diameter (mm). */
  lmcDiameterMm: number;
  /** Actual produced diameter (mm), if known. */
  actualDiameterMm?: number;
  /** External (pin/boss) vs internal (hole). */
  type: FeatureType;
}

export interface PositionToleranceCallout {
  /** Tolerance value at the stated material condition (mm). */
  toleranceMm: number;
  /** Material-condition modifier on the feature itself. */
  featureModifier: MaterialCondition;
}

export interface DatumModifier {
  /** Datum letter. */
  datum: string;
  /** Material-condition modifier on the datum feature. */
  modifier: MaterialCondition;
}

// ── Bonus tolerance ─────────────────────────────────────────────

/** Bonus tolerance: how much the position tolerance can grow as the
 *  feature departs from MMC.
 *
 *  - External feature (pin) at MMC: bonus = MMC - actual (≥ 0).
 *  - Internal feature (hole) at MMC: bonus = actual - MMC (≥ 0).
 *  - At LMC modifier: bonus formula is reversed (departs from LMC instead).
 *  - At RFS: no bonus (always 0). */
export function computeBonus(
  feature: FeatureSize,
  modifier: MaterialCondition,
): number {
  if (modifier === 'RFS') return 0;
  if (feature.actualDiameterMm === undefined) return 0;
  const actual = feature.actualDiameterMm;
  if (modifier === 'MMC') {
    if (feature.type === 'external') {
      // Pin: MMC is largest; bonus = MMC - actual.
      return Math.max(0, feature.mmcDiameterMm - actual);
    } else {
      // Hole: MMC is smallest; bonus = actual - MMC.
      return Math.max(0, actual - feature.mmcDiameterMm);
    }
  }
  // LMC: bonus = depart from LMC.
  if (feature.type === 'external') {
    return Math.max(0, actual - feature.lmcDiameterMm);
  } else {
    return Math.max(0, feature.lmcDiameterMm - actual);
  }
}

// ── Effective tolerance ─────────────────────────────────────────

export interface ToleranceResult {
  /** Stated tolerance from the callout. */
  statedToleranceMm: number;
  /** Bonus from feature departure. */
  bonusToleranceMm: number;
  /** Datum shift contribution. */
  datumShiftMm: number;
  /** Total available tolerance zone diameter (mm). */
  effectiveToleranceMm: number;
}

/** Sum the stated tolerance + bonus + datum shifts. */
export function effectiveTolerance(
  callout: PositionToleranceCallout,
  feature: FeatureSize,
  datumModifiers: DatumModifier[] = [],
  datumFeatures: Map<string, FeatureSize> = new Map(),
): ToleranceResult {
  const bonus = computeBonus(feature, callout.featureModifier);
  let datumShift = 0;
  for (const dm of datumModifiers) {
    if (dm.modifier === 'RFS') continue;
    const df = datumFeatures.get(dm.datum);
    if (!df) continue;
    datumShift += computeBonus(df, dm.modifier);
  }
  return {
    statedToleranceMm: callout.toleranceMm,
    bonusToleranceMm: bonus,
    datumShiftMm: datumShift,
    effectiveToleranceMm: callout.toleranceMm + bonus + datumShift,
  };
}

// ── Virtual condition ───────────────────────────────────────────

/** Virtual condition is the boundary the mating part must clear.
 *
 *  External feature (pin) at MMC: VC = MMC + position.tolerance
 *  Internal feature (hole) at MMC: VC = MMC - position.tolerance
 *
 *  At LMC: VC is computed off LMC instead. */
export function virtualCondition(
  feature: FeatureSize,
  toleranceMm: number,
  modifier: MaterialCondition,
): number {
  if (modifier === 'MMC') {
    return feature.type === 'external'
      ? feature.mmcDiameterMm + toleranceMm
      : feature.mmcDiameterMm - toleranceMm;
  }
  if (modifier === 'LMC') {
    return feature.type === 'external'
      ? feature.lmcDiameterMm - toleranceMm
      : feature.lmcDiameterMm + toleranceMm;
  }
  // RFS: VC = actual ± tolerance, but here we return MMC as a conservative bound.
  return feature.type === 'external'
    ? feature.mmcDiameterMm + toleranceMm
    : feature.mmcDiameterMm - toleranceMm;
}

// ── Pass / fail evaluation ──────────────────────────────────────

export interface ActualFeature {
  /** Center coordinates in the datum reference frame (mm). */
  centerInDrfMm: [number, number, number];
  /** Nominal (designed) position in DRF (mm). */
  nominalInDrfMm: [number, number, number];
  /** Actual feature diameter (mm). */
  actualDiameterMm: number;
}

export interface PositionEvaluation {
  /** Distance from nominal (mm) — diameter of the actual position cylinder. */
  actualDeviationDiameterMm: number;
  /** Effective allowable zone diameter (mm). */
  effectiveToleranceMm: number;
  /** Pass / fail. */
  withinTolerance: boolean;
  /** Headroom (mm); positive = pass, negative = fail. */
  marginMm: number;
}

export function evaluatePosition(
  actual: ActualFeature,
  feature: FeatureSize,
  callout: PositionToleranceCallout,
  datumModifiers: DatumModifier[] = [],
  datumFeatures: Map<string, FeatureSize> = new Map(),
): PositionEvaluation {
  // The position cylinder diameter is 2× the radial distance from nominal.
  const dx = actual.centerInDrfMm[0] - actual.nominalInDrfMm[0];
  const dy = actual.centerInDrfMm[1] - actual.nominalInDrfMm[1];
  const dz = actual.centerInDrfMm[2] - actual.nominalInDrfMm[2];
  const radialDist = Math.hypot(dx, dy, dz);
  const actualDeviationDiameter = 2 * radialDist;

  const featWithActual: FeatureSize = { ...feature, actualDiameterMm: actual.actualDiameterMm };
  const tol = effectiveTolerance(callout, featWithActual, datumModifiers, datumFeatures);

  return {
    actualDeviationDiameterMm: actualDeviationDiameter,
    effectiveToleranceMm: tol.effectiveToleranceMm,
    withinTolerance: actualDeviationDiameter <= tol.effectiveToleranceMm,
    marginMm: tol.effectiveToleranceMm - actualDeviationDiameter,
  };
}

// ── Pattern position with bonus depletion ───────────────────────

export interface HoleInstance {
  id: string;
  feature: FeatureSize;
  actual: ActualFeature;
}

export interface PatternEvaluation {
  /** Per-hole evaluation results. */
  results: Array<{ id: string; evaluation: PositionEvaluation }>;
  /** All holes pass? */
  patternPasses: boolean;
  /** Hole that uses the most bonus tolerance (the "tightest"). */
  worstHoleId: string | null;
  /** Hole with most headroom (the "loosest"). */
  bestHoleId: string | null;
}

export function evaluatePattern(
  holes: HoleInstance[],
  callout: PositionToleranceCallout,
  datumModifiers: DatumModifier[] = [],
  datumFeatures: Map<string, FeatureSize> = new Map(),
): PatternEvaluation {
  const results = holes.map(h => ({
    id: h.id,
    evaluation: evaluatePosition(h.actual, h.feature, callout, datumModifiers, datumFeatures),
  }));
  const patternPasses = results.every(r => r.evaluation.withinTolerance);
  let worst: typeof results[number] | null = null;
  let best: typeof results[number] | null = null;
  for (const r of results) {
    if (!worst || r.evaluation.marginMm < worst.evaluation.marginMm) worst = r;
    if (!best || r.evaluation.marginMm > best.evaluation.marginMm) best = r;
  }
  return { results, patternPasses, worstHoleId: worst?.id ?? null, bestHoleId: best?.id ?? null };
}

// ── Mating clearance check ──────────────────────────────────────

export interface MatingClearance {
  pinVc: number;
  holeVc: number;
  clearanceMm: number;
  mates: boolean;
}

/** Two parts mate if the hole's VC is large enough to clear the pin's VC. */
export function checkMatingClearance(
  pin: FeatureSize,
  pinTolerance: number,
  pinModifier: MaterialCondition,
  hole: FeatureSize,
  holeTolerance: number,
  holeModifier: MaterialCondition,
): MatingClearance {
  const pinVc = virtualCondition(pin, pinTolerance, pinModifier);
  const holeVc = virtualCondition(hole, holeTolerance, holeModifier);
  const clearance = holeVc - pinVc;
  return { pinVc, holeVc, clearanceMm: clearance, mates: clearance >= 0 };
}
