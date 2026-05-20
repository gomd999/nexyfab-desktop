/**
 * hazenWilliams.ts — Water pipe head loss + velocity by the Hazen-Williams
 * empirical equation (common for water distribution, fire protection).
 *
 *   SI form (head loss per metre):
 *     h_f/L = 10.67 · Q^1.852 / (C^1.852 · D^4.871)     [m/m]
 *   with Q in m³/s, D in m, C the Hazen-Williams roughness coefficient.
 *
 *   velocity v = Q / A.
 *
 * We compute head loss over a length, velocity (flag self-scouring vs
 * erosion limits), and can solve the diameter for a target head loss.
 */

export interface HazenWilliamsInput {
  flowM3S: number;
  innerDiameterMm: number;
  lengthM: number;
  cFactor: number;             // ~150 PVC, 130 new steel, 100 old cast iron
}

export interface HazenWilliamsResult {
  velocityMS: number;
  headLossPerMm: number;       // m per m
  headLossM: number;           // over length
  pressureDropBar: number;
  velocityOk: boolean;         // within 0.6–3 m/s typical
  warnings: string[];
}

export function compute(input: HazenWilliamsInput): HazenWilliamsResult {
  const warnings: string[] = [];
  const D = input.innerDiameterMm / 1000; // m
  if (D <= 0) warnings.push('Diameter must be positive.');
  if (input.cFactor <= 0) warnings.push('C-factor must be positive.');

  const area = (Math.PI / 4) * D * D;
  const v = area > 0 ? input.flowM3S / area : 0;

  const hfPerM = (input.cFactor > 0 && D > 0)
    ? 10.67 * Math.pow(Math.max(0, input.flowM3S), 1.852) / (Math.pow(input.cFactor, 1.852) * Math.pow(D, 4.871))
    : 0;
  const headLoss = hfPerM * input.lengthM;
  const pressureDropBar = headLoss * 9806.65 / 1e5; // m water → Pa → bar (ρg·h)

  const velocityOk = v >= 0.6 && v <= 3.0;
  if (v > 3.0) warnings.push(`Velocity ${v.toFixed(2)} m/s > 3 m/s — erosion/noise risk; upsize pipe.`);
  if (v > 0 && v < 0.6) warnings.push(`Velocity ${v.toFixed(2)} m/s < 0.6 m/s — sediment risk.`);

  return {
    velocityMS: v,
    headLossPerMm: hfPerM,
    headLossM: headLoss,
    pressureDropBar,
    velocityOk,
    warnings,
  };
}

/** Solve inner diameter (mm) for a target head loss per metre. */
export function diameterForHeadLoss(flowM3S: number, targetHfPerM: number, cFactor: number): number {
  if (targetHfPerM <= 0 || cFactor <= 0) return Infinity;
  // D^4.871 = 10.67·Q^1.852 / (C^1.852·(hf/L)) → D = (...)^(1/4.871)
  const Dpow = (10.67 * Math.pow(flowM3S, 1.852)) / (Math.pow(cFactor, 1.852) * targetHfPerM);
  return Math.pow(Dpow, 1 / 4.871) * 1000;
}

/** Equivalent C-factor degradation over time (aging) — rough multiplier. */
export function agedCFactor(newC: number, ageYears: number): number {
  // ~0.5%/year decline, floored at 60% of new.
  return Math.max(newC * 0.6, newC * (1 - 0.005 * ageYears));
}

export function summarize(r: HazenWilliamsResult): { velocityMS: number; headLossM: number; pressureDropBar: number } {
  return { velocityMS: r.velocityMS, headLossM: r.headLossM, pressureDropBar: r.pressureDropBar };
}
