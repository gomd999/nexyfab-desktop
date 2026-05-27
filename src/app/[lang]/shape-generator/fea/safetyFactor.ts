/**
 * safetyFactor.ts — Yield-based safety factor analysis.
 *
 * Safety Factor (SF) = material yield strength / stress.
 *   SF > 1 = part is safe (yield stress not reached)
 *   SF = 1 = part is at yield (permanent deformation imminent)
 *   SF < 1 = part will plastically deform / fail
 *
 * Industry convention bands the SF for quick visual classification:
 *   - **red** (SF < 1)       : will fail / yield
 *   - **orange** (1 ≤ SF < 1.5): marginal — typically rejected in
 *     conservative design
 *   - **yellow** (1.5 ≤ SF < 2): acceptable for non-critical parts
 *   - **green** (SF ≥ 2)      : safe with margin
 *
 * Pairs with `stressField` for the analyser pipeline and with
 * `materials.ts` for the yield-strength lookup. NexyFab positions
 * itself as "preview only" (memory: `nexyfab-gtm`), so this module
 * delivers the visualisation but does NOT claim Ansys-grade
 * certification accuracy.
 */

import type { StressField } from './stressField';
import { getMaterialPreset } from '../materials';

export type SfBand = 'fail' | 'marginal' | 'acceptable' | 'safe';

export interface SafetyFactorBands {
  /** SF below this → fail (red). Default 1.0. */
  failBelow: number;
  /** SF below this but ≥ failBelow → marginal (orange). Default 1.5. */
  marginalBelow: number;
  /** SF below this but ≥ marginalBelow → acceptable (yellow). Default 2.0. */
  acceptableBelow: number;
}

export const DEFAULT_BANDS: SafetyFactorBands = {
  failBelow: 1.0,
  marginalBelow: 1.5,
  acceptableBelow: 2.0,
};

/** Compute SF for a single stress value. Returns Infinity when stress
 *  is zero (no load → infinite margin). Negative or NaN stress maps
 *  to NaN. */
export function safetyFactor(stressMPa: number, yieldStrengthMPa: number): number {
  if (!Number.isFinite(stressMPa) || stressMPa < 0) return NaN;
  if (stressMPa === 0) return Infinity;
  if (!Number.isFinite(yieldStrengthMPa) || yieldStrengthMPa <= 0) return NaN;
  return yieldStrengthMPa / stressMPa;
}

/** Classify a SF into one of four bands. */
export function classifySf(sf: number, bands: SafetyFactorBands = DEFAULT_BANDS): SfBand {
  if (!Number.isFinite(sf)) return sf === Infinity ? 'safe' : 'fail';
  if (sf < bands.failBelow) return 'fail';
  if (sf < bands.marginalBelow) return 'marginal';
  if (sf < bands.acceptableBelow) return 'acceptable';
  return 'safe';
}

/** Resolve yield strength from a material id via `materials.ts`. */
export function yieldStrengthOf(materialId: string): number | null {
  const m = getMaterialPreset(materialId);
  return typeof m?.yieldStrength === 'number' ? m.yieldStrength : null;
}

export interface SafetyFactorReport {
  /** Material used. */
  materialId: string;
  yieldStrengthMPa: number;
  /** Minimum SF across the field. */
  minSf: number;
  /** Vertex index of the minimum. */
  minSfVertex: number;
  /** Mean SF across vertices with finite stress. */
  meanSf: number;
  /** Counts per band. */
  bandCounts: Record<SfBand, number>;
  /** Decision: 'pass' iff no vertex falls in 'fail' band. */
  decision: 'pass' | 'fail';
}

/** Run the SF analysis across a whole stress field. */
export function analyseField(
  field: StressField,
  materialId: string,
  bands: SafetyFactorBands = DEFAULT_BANDS,
): SafetyFactorReport | null {
  const yield_ = yieldStrengthOf(materialId);
  if (yield_ === null) return null;

  let minSf = Infinity;
  let minSfVertex = -1;
  let sum = 0;
  let count = 0;
  const bandCounts: Record<SfBand, number> = {
    fail: 0, marginal: 0, acceptable: 0, safe: 0,
  };

  for (let i = 0; i < field.vonMises.length; i++) {
    const stress = field.vonMises[i];
    const sf = safetyFactor(stress, yield_);
    if (!Number.isFinite(sf)) {
      if (sf === Infinity) {
        bandCounts.safe++;
      }
      continue;
    }
    if (sf < minSf) { minSf = sf; minSfVertex = i; }
    sum += sf;
    count++;
    bandCounts[classifySf(sf, bands)]++;
  }

  return {
    materialId,
    yieldStrengthMPa: yield_,
    minSf: count > 0 ? minSf : Infinity,
    minSfVertex,
    meanSf: count > 0 ? sum / count : Infinity,
    bandCounts,
    decision: bandCounts.fail > 0 ? 'fail' : 'pass',
  };
}

/** Pick the RGB swatch colour for a given SF band — for legend / sidebar. */
export function bandColour(band: SfBand): string {
  switch (band) {
    case 'fail':       return '#e3322a';
    case 'marginal':   return '#f08a2a';
    case 'acceptable': return '#f5d22a';
    case 'safe':       return '#5dc15d';
  }
}
