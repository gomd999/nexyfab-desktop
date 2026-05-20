/**
 * sinkMarkPredictor.ts — Predict sink-mark risk on injection-molded
 * parts where a thick feature (rib, boss) meets a nominal wall.
 *
 * Sink marks form when the thicker section cools/shrinks after the
 * surface skin has frozen, pulling the surface inward. The dominant
 * driver is the thickness ratio of the feature base to the wall:
 *
 *   ratio = featureThickness / wallThickness
 *
 * Design guideline (most thermoplastics): keep rib base ≤ 0.5–0.6 × wall
 * to avoid visible sinks. Above that the risk climbs. We grade the risk
 * and estimate sink depth from an empirical relation:
 *
 *   sinkDepth ≈ k · wall · (ratio − ratioThreshold)   (clamped ≥ 0)
 *
 * with k a polymer/visibility factor. Texture and lower gloss hide sinks.
 */

export type SinkPolymer = 'PP' | 'PE' | 'ABS' | 'PS' | 'PC' | 'PA' | 'POM' | 'PMMA';

// Recommended max rib/wall ratio before sink risk + sink sensitivity k.
const SINK_PARAMS: Record<SinkPolymer, { maxRatio: number; k: number }> = {
  PP: { maxRatio: 0.6, k: 0.04 },
  PE: { maxRatio: 0.6, k: 0.04 },
  ABS: { maxRatio: 0.5, k: 0.03 },
  PS: { maxRatio: 0.5, k: 0.03 },
  PC: { maxRatio: 0.5, k: 0.025 },
  PA: { maxRatio: 0.5, k: 0.05 },   // semicrystalline, shrinks more
  POM: { maxRatio: 0.5, k: 0.05 },
  PMMA: { maxRatio: 0.4, k: 0.03 },
};

export type SinkRisk = 'none' | 'low' | 'moderate' | 'high';

export interface SinkMarkInput {
  wallThicknessMm: number;
  featureThicknessMm: number; // rib/boss base thickness
  polymer: SinkPolymer;
  surfaceTextured?: boolean;  // texture hides sinks
  highGloss?: boolean;        // gloss reveals sinks
}

export interface SinkMarkResult {
  thicknessRatio: number;
  recommendedMaxRatio: number;
  estimatedSinkDepthMm: number;
  risk: SinkRisk;
  withinGuideline: boolean;
  suggestedFeatureThicknessMm: number; // to hit the guideline
  warnings: string[];
}

export function predict(input: SinkMarkInput): SinkMarkResult {
  const warnings: string[] = [];
  if (input.wallThicknessMm <= 0) warnings.push('Wall thickness must be positive.');
  const params = SINK_PARAMS[input.polymer];
  if (!params) warnings.push(`Unknown polymer "${input.polymer}"; defaulting to ABS.`);
  const p = params ?? SINK_PARAMS.ABS;

  const ratio = input.wallThicknessMm > 0 ? input.featureThicknessMm / input.wallThicknessMm : 0;

  let k = p.k;
  if (input.surfaceTextured) k *= 0.5; // texture hides ~half the visible sink
  if (input.highGloss) k *= 1.4;

  const excess = Math.max(0, ratio - p.maxRatio);
  const sinkDepth = k * input.wallThicknessMm * excess * 10; // empirical scale

  let risk: SinkRisk;
  if (ratio <= p.maxRatio) risk = 'none';
  else if (ratio <= p.maxRatio + 0.2) risk = 'low';
  else if (ratio <= p.maxRatio + 0.5) risk = 'moderate';
  else risk = 'high';

  const suggested = p.maxRatio * input.wallThicknessMm;

  return {
    thicknessRatio: ratio,
    recommendedMaxRatio: p.maxRatio,
    estimatedSinkDepthMm: sinkDepth,
    risk,
    withinGuideline: ratio <= p.maxRatio + 1e-9,
    suggestedFeatureThicknessMm: suggested,
    warnings,
  };
}

/** Suggested fixes ranked. */
export function suggestFixes(result: SinkMarkResult): string[] {
  if (result.risk === 'none') return [];
  const fixes: string[] = [];
  fixes.push(`Reduce feature base to ≤ ${result.suggestedFeatureThicknessMm.toFixed(2)} mm (ratio ${result.recommendedMaxRatio}).`);
  fixes.push('Add a gas-assist channel or core out the thick section.');
  if (result.risk !== 'low') fixes.push('Apply surface texture on the show face to mask residual sink.');
  fixes.push('Move the gate nearer the thick section for better packing.');
  return fixes;
}

export function summarize(r: SinkMarkResult): { risk: SinkRisk; thicknessRatio: number; estimatedSinkDepthMm: number } {
  return { risk: r.risk, thicknessRatio: r.thicknessRatio, estimatedSinkDepthMm: r.estimatedSinkDepthMm };
}
