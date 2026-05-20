/**
 * pipeInsulationThickness.ts — Size pipe insulation for either condensation
 * control (surface temp ≥ dew point) or heat-loss limiting, via the
 * cylindrical (radial) conduction resistance.
 *
 * Radial heat loss per unit length through insulation + film:
 *   q = 2π·(T_pipe − T_amb) / ( ln(r2/r1)/k_ins + 1/(r2·h) )
 *
 * Surface temperature:
 *   T_surf = T_amb + q / (2π·r2·h)
 *
 * For condensation control we increase thickness until T_surf ≥ dew
 * point. For heat-loss control we increase until q ≤ allowable. We sweep
 * standard thicknesses and pick the smallest that satisfies the target.
 */

export type InsulationGoal = 'condensation' | 'heat-loss';

export interface PipeInsulationInput {
  pipeOuterDiameterMm: number;
  pipeSurfaceTempC: number;     // process temp at pipe wall
  ambientTempC: number;
  conductivityWmK: number;      // k of insulation
  surfaceFilmCoeffWm2K: number; // h (still air ≈ 8–10)
  goal: InsulationGoal;
  dewPointC?: number;           // for condensation goal
  allowableLossWperM?: number;  // for heat-loss goal
  candidateThicknessesMm?: number[];
}

export interface PipeInsulationResult {
  selectedThicknessMm: number | null;
  heatLossWperM: number;
  surfaceTempC: number;
  goalMet: boolean;
  bareLossWperM: number;
  warnings: string[];
}

const STD_THICKNESSES = [13, 19, 25, 32, 38, 50, 64, 75, 100];

export function size(input: PipeInsulationInput): PipeInsulationResult {
  const warnings: string[] = [];
  if (input.conductivityWmK <= 0) warnings.push('Conductivity must be positive.');
  if (input.surfaceFilmCoeffWm2K <= 0) warnings.push('Film coefficient must be positive.');

  const r1 = input.pipeOuterDiameterMm / 2 / 1000; // m
  const dT = input.pipeSurfaceTempC - input.ambientTempC;
  const k = input.conductivityWmK;
  const h = input.surfaceFilmCoeffWm2K;

  const bareLoss = 2 * Math.PI * r1 * h * Math.abs(dT); // approx bare convective loss/m

  const candidates = input.candidateThicknessesMm ?? STD_THICKNESSES;
  let selected: number | null = null;
  let qAt = bareLoss, tSurfAt = input.pipeSurfaceTempC;

  for (const tMm of candidates) {
    const r2 = r1 + tMm / 1000;
    const R = Math.log(r2 / r1) / k + 1 / (r2 * h); // per 2π·L
    const q = (2 * Math.PI * Math.abs(dT)) / R; // W/m
    const tSurf = input.ambientTempC + Math.sign(dT) * q / (2 * Math.PI * r2 * h);
    qAt = q; tSurfAt = tSurf;

    const met = input.goal === 'condensation'
      ? (input.dewPointC != null ? tSurf >= input.dewPointC : false)
      : (input.allowableLossWperM != null ? q <= input.allowableLossWperM : false);

    if (met) { selected = tMm; break; }
  }

  if (selected == null) {
    warnings.push(input.goal === 'condensation'
      ? 'No standard thickness keeps surface above dew point; use higher-k film or vapor barrier.'
      : 'No standard thickness meets the heat-loss target; increase max thickness.');
  }

  return {
    selectedThicknessMm: selected,
    heatLossWperM: qAt,
    surfaceTempC: tSurfAt,
    goalMet: selected != null,
    bareLossWperM: bareLoss,
    warnings,
  };
}

/** Heat loss (W/m) for a specific insulation thickness. */
export function heatLossWperM(input: Omit<PipeInsulationInput, 'goal' | 'candidateThicknessesMm'>, thicknessMm: number): number {
  const r1 = input.pipeOuterDiameterMm / 2 / 1000;
  const r2 = r1 + thicknessMm / 1000;
  const R = Math.log(r2 / r1) / input.conductivityWmK + 1 / (r2 * input.surfaceFilmCoeffWm2K);
  return (2 * Math.PI * Math.abs(input.pipeSurfaceTempC - input.ambientTempC)) / R;
}

export function summarize(r: PipeInsulationResult): { selectedThicknessMm: number | null; heatLossWperM: number; goalMet: boolean } {
  return { selectedThicknessMm: r.selectedThicknessMm, heatLossWperM: r.heatLossWperM, goalMet: r.goalMet };
}
