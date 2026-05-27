/**
 * steamTrapSizing.ts — Size a steam trap from the condensate load and the
 * differential pressure across the trap, applying a safety factor for
 * start-up loads, and pick a trap type by application.
 *
 *   condensate load (running) from heat duty:
 *     m_cond = Q / h_fg     [kg/h], Q in kW → kJ/s; h_fg latent at pressure
 *   sizing load = running load × safetyFactor (2–3 typical)
 *   required trap capacity ≥ sizing load at the available ΔP
 *
 * Trap capacity scales with √ΔP (orifice flow). We compute the running
 * + sizing condensate load and report the minimum orifice/Cv-like
 * capacity coefficient, plus a trap-type recommendation.
 */

export type TrapApplication = 'steam-main' | 'tracing' | 'process-heater' | 'unit-heater';
export type TrapType = 'thermodynamic' | 'float-thermostatic' | 'inverted-bucket' | 'thermostatic';

export interface SteamTrapInput {
  heatDutyKW: number;
  latentHeatKJkg: number;     // h_fg at operating pressure (e.g. ~2100 @ 5 bar)
  inletPressureBarG: number;
  backPressureBarG?: number;  // condensate return, default 0
  safetyFactor?: number;      // default 2.5
  application?: TrapApplication;
}

export interface SteamTrapResult {
  runningLoadKgH: number;
  sizingLoadKgH: number;
  differentialPressureBar: number;
  capacityCoefficient: number; // sizingLoad / √ΔP (orifice sizing proxy)
  recommendedType: TrapType;
  warnings: string[];
}

export function size(input: SteamTrapInput): SteamTrapResult {
  const warnings: string[] = [];
  if (input.heatDutyKW <= 0) warnings.push('Heat duty must be positive.');
  if (input.latentHeatKJkg <= 0) warnings.push('Latent heat must be positive.');

  // Q [kW = kJ/s] / h_fg [kJ/kg] = kg/s → ×3600 kg/h.
  const runningLoad = input.latentHeatKJkg > 0 ? (input.heatDutyKW / input.latentHeatKJkg) * 3600 : 0;
  const sf = input.safetyFactor ?? 2.5;
  const sizingLoad = runningLoad * sf;

  const dP = Math.max(0.01, input.inletPressureBarG - (input.backPressureBarG ?? 0));
  const capacityCoeff = sizingLoad / Math.sqrt(dP);

  const recommendedType = recommendType(input.application ?? 'process-heater', sizingLoad);

  if ((input.backPressureBarG ?? 0) >= input.inletPressureBarG) {
    warnings.push('Back-pressure ≥ inlet: trap cannot discharge. Reduce return pressure or add a pump-trap.');
  }

  return {
    runningLoadKgH: runningLoad,
    sizingLoadKgH: sizingLoad,
    differentialPressureBar: dP,
    capacityCoefficient: capacityCoeff,
    recommendedType,
    warnings,
  };
}

function recommendType(app: TrapApplication, sizingLoadKgH: number): TrapType {
  switch (app) {
    case 'steam-main': return 'thermodynamic';     // small intermittent drip
    case 'tracing': return 'thermostatic';         // sub-cooled, low load
    case 'unit-heater': return 'inverted-bucket';  // robust, dirt-tolerant
    case 'process-heater':
      return sizingLoadKgH > 500 ? 'float-thermostatic' : 'inverted-bucket';
  }
}

/** Required trap capacity at a different ΔP (capacity ∝ √ΔP). */
export function capacityAtDp(result: SteamTrapResult, newDpBar: number): number {
  if (newDpBar <= 0) return 0;
  return result.capacityCoefficient * Math.sqrt(newDpBar);
}

export function summarize(r: SteamTrapResult): { sizingLoadKgH: number; recommendedType: TrapType; capacityCoefficient: number } {
  return { sizingLoadKgH: r.sizingLoadKgH, recommendedType: r.recommendedType, capacityCoefficient: r.capacityCoefficient };
}
