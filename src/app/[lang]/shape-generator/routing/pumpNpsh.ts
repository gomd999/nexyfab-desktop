/**
 * pumpNpsh.ts — Compute the Net Positive Suction Head available (NPSHa)
 * for a pump installation and compare it to the pump's required NPSHr to
 * flag cavitation risk.
 *
 *   NPSHa = (P_atm + P_gauge − P_vapour)/(ρ·g) + H_static − H_friction
 *
 * (heads in metres of fluid). Static head is positive when the source
 * level is ABOVE the pump centreline (flooded suction), negative on a
 * lift. Friction is the suction-line loss at design flow.
 *
 * Cavitation margin = NPSHa − NPSHr; a margin ≥ 0.5–1 m (or ≥ 1.3×NPSHr)
 * is good practice.
 */

export interface PumpNpshInput {
  atmosphericPressurePa?: number;  // default 101325
  gaugePressurePa?: number;        // tank pressurisation, default 0
  vapourPressurePa: number;        // of the fluid at temperature
  fluidDensityKgM3: number;
  staticHeadM: number;             // + flooded, − lift
  frictionHeadM: number;           // suction-line loss at flow
  npshRequiredM?: number;          // from the pump curve
}

export interface PumpNpshResult {
  npshAvailableM: number;
  pressureHeadM: number;
  cavitationMarginM: number | null;
  cavitationRisk: 'safe' | 'marginal' | 'risk' | null;
  warnings: string[];
}

const G = 9.80665;

export function compute(input: PumpNpshInput): PumpNpshResult {
  const warnings: string[] = [];
  const rho = input.fluidDensityKgM3;
  if (rho <= 0) warnings.push('Fluid density must be positive.');

  const Patm = input.atmosphericPressurePa ?? 101325;
  const Pgauge = input.gaugePressurePa ?? 0;
  const Pv = input.vapourPressurePa;

  const pressureHead = rho > 0 ? (Patm + Pgauge - Pv) / (rho * G) : 0;
  const npsha = pressureHead + input.staticHeadM - input.frictionHeadM;

  let margin: number | null = null;
  let risk: 'safe' | 'marginal' | 'risk' | null = null;
  if (input.npshRequiredM != null) {
    margin = npsha - input.npshRequiredM;
    if (margin >= Math.max(0.5, 0.3 * input.npshRequiredM)) risk = 'safe';
    else if (margin >= 0) risk = 'marginal';
    else risk = 'risk';
    if (risk === 'risk') warnings.push('NPSHa < NPSHr: cavitation expected. Lower the pump, reduce suction friction, or cool the fluid.');
  }

  return {
    npshAvailableM: npsha,
    pressureHeadM: pressureHead,
    cavitationMarginM: margin,
    cavitationRisk: risk,
    warnings,
  };
}

/** Maximum suction lift (negative static head) before NPSHa hits NPSHr. */
export function maxSuctionLiftM(input: PumpNpshInput): number {
  if (input.npshRequiredM == null) return Infinity;
  const rho = input.fluidDensityKgM3;
  const Patm = input.atmosphericPressurePa ?? 101325;
  const Pgauge = input.gaugePressurePa ?? 0;
  const pressureHead = rho > 0 ? (Patm + Pgauge - input.vapourPressurePa) / (rho * G) : 0;
  // NPSHr = pressureHead + (−lift) − friction → lift = pressureHead − friction − NPSHr
  return pressureHead - input.frictionHeadM - input.npshRequiredM;
}

export function summarize(r: PumpNpshResult): { npshAvailableM: number; cavitationMarginM: number | null; cavitationRisk: string | null } {
  return { npshAvailableM: r.npshAvailableM, cavitationMarginM: r.cavitationMarginM, cavitationRisk: r.cavitationRisk };
}
