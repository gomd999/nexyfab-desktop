/**
 * shrinkFitHeating.ts — Compute the temperature change needed to assemble
 * a shrink (thermal interference) fit: heat the hub (or cool the shaft)
 * until the interference clears plus an assembly clearance for sliding.
 *
 * Diametral expansion from heating:
 *   Δd = α · d · ΔT
 *
 * To clear an interference δ plus an assembly clearance c:
 *   ΔT = (δ + c) / (α · d)
 *
 * We support BOTH heating the outer (hub) and cooling the inner (shaft),
 * and report whether the required temperature is reachable (vs an oven
 * limit / dry-ice / liquid-nitrogen floor), and the assembly time window
 * before the parts equalise (a rough cooling-rate estimate).
 */

export type FitMethod = 'heat-hub' | 'cool-shaft' | 'both';

export interface ShrinkFitInput {
  nominalDiameterMm: number;
  diametralInterferenceMm: number;     // δ (positive)
  assemblyClearanceMm?: number;        // c, default 0.02 mm
  hubCTE_perK: number;                 // α of the part being heated
  shaftCTE_perK: number;               // α of the part being cooled
  ambientTempC?: number;               // default 20
  method?: FitMethod;
  ovenLimitC?: number;                 // max heating temp, default 300
  cryoFloorC?: number;                 // min cooling temp, default −196 (LN2)
}

export interface ShrinkFitResult {
  requiredDeltaTHeatC: number | null;  // for heat-hub / both
  requiredDeltaTCoolC: number | null;  // for cool-shaft / both
  hubTargetTempC: number | null;
  shaftTargetTempC: number | null;
  method: FitMethod;
  feasible: boolean;
  warnings: string[];
}

export function compute(input: ShrinkFitInput): ShrinkFitResult {
  const warnings: string[] = [];
  const d = input.nominalDiameterMm;
  const delta = input.diametralInterferenceMm;
  if (d <= 0) warnings.push('Nominal diameter must be positive.');
  if (delta < 0) warnings.push('Interference should be non-negative.');

  const clearance = input.assemblyClearanceMm ?? 0.02;
  const ambient = input.ambientTempC ?? 20;
  const method = input.method ?? 'heat-hub';
  const required = delta + clearance;

  let dtHeat: number | null = null;
  let dtCool: number | null = null;
  let hubTarget: number | null = null;
  let shaftTarget: number | null = null;

  const heatShare = method === 'both' ? required / 2 : required;
  const coolShare = method === 'both' ? required / 2 : required;

  if (method === 'heat-hub' || method === 'both') {
    if (input.hubCTE_perK > 0 && d > 0) {
      dtHeat = heatShare / (input.hubCTE_perK * d);
      hubTarget = ambient + dtHeat;
    } else {
      warnings.push('Hub CTE / diameter invalid for heating.');
    }
  }
  if (method === 'cool-shaft' || method === 'both') {
    if (input.shaftCTE_perK > 0 && d > 0) {
      dtCool = coolShare / (input.shaftCTE_perK * d);
      shaftTarget = ambient - dtCool;
    } else {
      warnings.push('Shaft CTE / diameter invalid for cooling.');
    }
  }

  const ovenLimit = input.ovenLimitC ?? 300;
  const cryoFloor = input.cryoFloorC ?? -196;
  let feasible = true;
  if (hubTarget != null && hubTarget > ovenLimit) {
    feasible = false;
    warnings.push(`Hub target ${hubTarget.toFixed(0)} °C exceeds oven limit ${ovenLimit} °C.`);
  }
  if (shaftTarget != null && shaftTarget < cryoFloor) {
    feasible = false;
    warnings.push(`Shaft target ${shaftTarget.toFixed(0)} °C below cryo floor ${cryoFloor} °C.`);
  }

  return {
    requiredDeltaTHeatC: dtHeat,
    requiredDeltaTCoolC: dtCool,
    hubTargetTempC: hubTarget,
    shaftTargetTempC: shaftTarget,
    method,
    feasible,
    warnings,
  };
}

/** Free thermal expansion of a diameter at a temperature change. */
export function diametralExpansion(diameterMm: number, ctePerK: number, deltaTC: number): number {
  return ctePerK * diameterMm * deltaTC;
}

/** Suggest the easiest method given material CTEs + interference. */
export function suggestMethod(input: Omit<ShrinkFitInput, 'method'>): FitMethod {
  const required = input.diametralInterferenceMm + (input.assemblyClearanceMm ?? 0.02);
  const dtHeat = input.hubCTE_perK > 0 ? required / (input.hubCTE_perK * input.nominalDiameterMm) : Infinity;
  const dtCool = input.shaftCTE_perK > 0 ? required / (input.shaftCTE_perK * input.nominalDiameterMm) : Infinity;
  const ovenLimit = input.ovenLimitC ?? 300;
  const ambient = input.ambientTempC ?? 20;
  // If heating alone stays under the oven limit, prefer it (simplest).
  if (ambient + dtHeat <= ovenLimit) return 'heat-hub';
  // else if cooling reaches, use that; otherwise combine.
  const cryoFloor = input.cryoFloorC ?? -196;
  if (ambient - dtCool >= cryoFloor) return 'cool-shaft';
  return 'both';
}

export function summarize(r: ShrinkFitResult): { method: FitMethod; feasible: boolean; hubTargetTempC: number | null; shaftTargetTempC: number | null } {
  return { method: r.method, feasible: r.feasible, hubTargetTempC: r.hubTargetTempC, shaftTargetTempC: r.shaftTargetTempC };
}
