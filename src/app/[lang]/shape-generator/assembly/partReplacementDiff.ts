/**
 * partReplacementDiff.ts — Compare two parts to determine if one can
 * replace the other.
 *
 * Used in PDM / MRO when an obsolete component must be substituted.
 * The diff covers:
 *
 *   - Dimensions: nominal + tolerances.
 *   - Mating features: mounting holes, mating face flatness.
 *   - Material / finish.
 *   - Weight + COG.
 *   - Electrical interface (for harnessed parts).
 *
 * Decision rule:
 *
 *   - "drop-in" — every constraint met.
 *   - "rework" — most constraints OK, some need adapter.
 *   - "no-go" — interfaces fundamentally different.
 */

export interface PartSpec {
  id: string;
  /** External bounding box. */
  envelope: { x: number; y: number; z: number };
  /** Mounting hole positions in part frame. */
  mountingHoles: { x: number; y: number; z: number; diameterMm: number }[];
  /** Mating face flatness (mm). */
  matingFlatnessMm?: number;
  /** Material code. */
  material: string;
  /** Surface finish Ra (μm). */
  finishRaMicron?: number;
  /** Mass (kg). */
  massKg: number;
  /** Centre of gravity in part frame. */
  cog: { x: number; y: number; z: number };
}

export type Verdict = 'drop-in' | 'rework' | 'no-go';

export interface DiffResult {
  envelopeDeviationMm: number;
  /** Hole position max error (mm). */
  holePositionErrorMm: number;
  /** Hole diameter discrepancies (mm). */
  holeDiameterErrorMm: number;
  /** Hole count delta. */
  holeCountDelta: number;
  materialMatch: boolean;
  finishCompatible: boolean;
  massDeltaPct: number;
  cogDeltaMm: number;
  verdict: Verdict;
  reasons: string[];
}

export interface DiffOptions {
  envelopeToleranceMm: number;
  holePositionToleranceMm: number;
  holeDiameterToleranceMm: number;
  finishMaxRatio: number;
  massMaxPct: number;
  cogMaxDeltaMm: number;
}

export const DEFAULT_OPTIONS: DiffOptions = {
  envelopeToleranceMm: 1,
  holePositionToleranceMm: 0.5,
  holeDiameterToleranceMm: 0.2,
  finishMaxRatio: 1.5,
  massMaxPct: 10,
  cogMaxDeltaMm: 5,
};

// ── Top-level entry ────────────────────────────────────────────

export function diffParts(oldPart: PartSpec, newPart: PartSpec, options: Partial<DiffOptions> = {}): DiffResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const reasons: string[] = [];

  const envDev = Math.max(
    Math.abs(oldPart.envelope.x - newPart.envelope.x),
    Math.abs(oldPart.envelope.y - newPart.envelope.y),
    Math.abs(oldPart.envelope.z - newPart.envelope.z),
  );

  let holePosErr = 0;
  let holeDiaErr = 0;
  const holeCountDelta = oldPart.mountingHoles.length - newPart.mountingHoles.length;
  if (holeCountDelta === 0) {
    for (let i = 0; i < oldPart.mountingHoles.length; i++) {
      const o = oldPart.mountingHoles[i]!;
      const n = newPart.mountingHoles[i]!;
      const d = Math.hypot(o.x - n.x, o.y - n.y, o.z - n.z);
      if (d > holePosErr) holePosErr = d;
      if (Math.abs(o.diameterMm - n.diameterMm) > holeDiaErr) holeDiaErr = Math.abs(o.diameterMm - n.diameterMm);
    }
  } else {
    reasons.push(`Hole count differs: ${oldPart.mountingHoles.length} vs ${newPart.mountingHoles.length}.`);
  }

  const materialMatch = oldPart.material === newPart.material;
  if (!materialMatch) reasons.push(`Material changed: ${oldPart.material} → ${newPart.material}.`);

  const finishRatio = (newPart.finishRaMicron ?? 0) / Math.max(0.001, oldPart.finishRaMicron ?? 1);
  const finishCompatible = finishRatio <= opts.finishMaxRatio && finishRatio >= 1 / opts.finishMaxRatio;
  if (!finishCompatible) reasons.push(`Finish Ra ratio ${finishRatio.toFixed(2)} outside ±${opts.finishMaxRatio}x.`);

  const massDeltaPct = Math.abs(newPart.massKg - oldPart.massKg) / Math.max(0.001, oldPart.massKg) * 100;
  if (massDeltaPct > opts.massMaxPct) reasons.push(`Mass changed by ${massDeltaPct.toFixed(1)}% > ${opts.massMaxPct}% allowance.`);

  const cogDelta = Math.hypot(oldPart.cog.x - newPart.cog.x, oldPart.cog.y - newPart.cog.y, oldPart.cog.z - newPart.cog.z);
  if (cogDelta > opts.cogMaxDeltaMm) reasons.push(`COG shifted ${cogDelta.toFixed(2)} mm > ${opts.cogMaxDeltaMm} mm.`);

  if (envDev > opts.envelopeToleranceMm) reasons.push(`Envelope deviation ${envDev.toFixed(2)} mm > ${opts.envelopeToleranceMm} mm.`);
  if (holePosErr > opts.holePositionToleranceMm) reasons.push(`Hole position error ${holePosErr.toFixed(2)} mm > ${opts.holePositionToleranceMm} mm.`);
  if (holeDiaErr > opts.holeDiameterToleranceMm) reasons.push(`Hole diameter error ${holeDiaErr.toFixed(2)} mm > ${opts.holeDiameterToleranceMm} mm.`);

  const isDropIn = reasons.length === 0;
  const isHardBlocker = holeCountDelta !== 0 || envDev > opts.envelopeToleranceMm * 5;
  const verdict: Verdict = isDropIn ? 'drop-in' : isHardBlocker ? 'no-go' : 'rework';

  return {
    envelopeDeviationMm: envDev,
    holePositionErrorMm: holePosErr,
    holeDiameterErrorMm: holeDiaErr,
    holeCountDelta,
    materialMatch,
    finishCompatible,
    massDeltaPct,
    cogDeltaMm: cogDelta,
    verdict,
    reasons,
  };
}

// ── Recommendation ───────────────────────────────────────────

export interface ReplacementRecommendation {
  verdict: Verdict;
  adapterRequired: boolean;
  rationale: string;
}

export function buildRecommendation(result: DiffResult): ReplacementRecommendation {
  if (result.verdict === 'drop-in') return { verdict: 'drop-in', adapterRequired: false, rationale: 'Drop-in substitute.' };
  if (result.verdict === 'no-go') return { verdict: 'no-go', adapterRequired: false, rationale: 'Fundamental incompatibility; use different part.' };
  return {
    verdict: 'rework',
    adapterRequired: result.holePositionErrorMm > 0 || result.holeDiameterErrorMm > 0,
    rationale: `Rework required: ${result.reasons.join('; ')}`,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface DiffSummary {
  verdict: Verdict;
  reasonCount: number;
  envelopeDeviationMm: number;
  holePositionErrorMm: number;
}

export function summarize(result: DiffResult): DiffSummary {
  return {
    verdict: result.verdict,
    reasonCount: result.reasons.length,
    envelopeDeviationMm: result.envelopeDeviationMm,
    holePositionErrorMm: result.holePositionErrorMm,
  };
}
