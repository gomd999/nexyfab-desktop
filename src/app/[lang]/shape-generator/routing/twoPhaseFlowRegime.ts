/**
 * twoPhaseFlowRegime.ts — Classify the flow regime of gas-liquid
 * two-phase flow in a horizontal pipe using superficial-velocity-based
 * boundaries (a simplified Mandhane-style map).
 *
 * Superficial velocities:
 *   j_g = Q_g / A   (gas)
 *   j_l = Q_l / A   (liquid)
 *
 * Regimes (horizontal): stratified, wavy, slug/plug (intermittent),
 * annular, dispersed-bubble. We use threshold curves on (j_l, j_g):
 *
 *   - very low j_g + low j_l → stratified
 *   - rising j_g over stratified → wavy → annular
 *   - moderate j_l, moderate j_g → slug (intermittent)
 *   - high j_l → dispersed bubble
 *
 * Output: regime + the two superficial velocities + void fraction
 * (homogeneous estimate).
 */

export type FlowRegime = 'stratified' | 'wavy' | 'slug' | 'annular' | 'dispersed-bubble';

export interface TwoPhaseInput {
  pipeInnerDiameterMm: number;
  gasFlowM3PerS: number;
  liquidFlowM3PerS: number;
}

export interface TwoPhaseResult {
  superficialGasVelocityMS: number;
  superficialLiquidVelocityMS: number;
  mixtureVelocityMS: number;
  regime: FlowRegime;
  homogeneousVoidFraction: number;
  warnings: string[];
}

export function classify(input: TwoPhaseInput): TwoPhaseResult {
  const warnings: string[] = [];
  const D = input.pipeInnerDiameterMm / 1000;
  if (D <= 0) warnings.push('Pipe ID must be positive.');
  const A = (Math.PI / 4) * D * D;

  const jg = A > 0 ? input.gasFlowM3PerS / A : 0;
  const jl = A > 0 ? input.liquidFlowM3PerS / A : 0;
  const jm = jg + jl;
  const voidFrac = jm > 0 ? jg / jm : 0;

  const regime = regimeFromVelocities(jg, jl);

  return {
    superficialGasVelocityMS: jg,
    superficialLiquidVelocityMS: jl,
    mixtureVelocityMS: jm,
    regime,
    homogeneousVoidFraction: voidFrac,
    warnings,
  };
}

function regimeFromVelocities(jg: number, jl: number): FlowRegime {
  // Simplified Mandhane boundaries (m/s).
  if (jl > 3) return 'dispersed-bubble';      // high liquid → bubbles dispersed
  if (jg > 10) return 'annular';              // high gas → annular film
  if (jl > 0.5 && jg > 0.5 && jg <= 10) return 'slug'; // intermittent
  if (jg > 1.5) return 'wavy';                // moderate gas over a layer
  return 'stratified';                        // low both → gravity-separated
}

/** Lockhart-Martinelli parameter X (turbulent-turbulent) for pressure-drop work. */
export function lockhartMartinelliX(
  liquidPressureGradPaPerM: number,
  gasPressureGradPaPerM: number,
): number {
  if (gasPressureGradPaPerM <= 0) return Infinity;
  return Math.sqrt(liquidPressureGradPaPerM / gasPressureGradPaPerM);
}

/** Is the regime generally undesirable (slug causes vibration/water-hammer)? */
export function isProblematic(regime: FlowRegime): boolean {
  return regime === 'slug';
}

export function summarize(r: TwoPhaseResult): { regime: FlowRegime; homogeneousVoidFraction: number; mixtureVelocityMS: number } {
  return { regime: r.regime, homogeneousVoidFraction: r.homogeneousVoidFraction, mixtureVelocityMS: r.mixtureVelocityMS };
}
