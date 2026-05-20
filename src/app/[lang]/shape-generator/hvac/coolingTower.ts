/**
 * coolingTower.ts — Compute cooling-tower thermal performance: range,
 * approach, heat rejection, evaporation + makeup water, and L/G ratio.
 *
 *   range    = T_water_in − T_water_out          (water cooled)
 *   approach = T_water_out − T_wetbulb           (closeness to limit)
 *   heatRejectkW = ṁ_water · cp · range
 *   evaporation ≈ 0.00085 · 1.8 · waterFlow · range   (rule of thumb, %)
 *   makeup = evaporation + drift + blowdown
 *   L/G    = water mass flow / air mass flow
 *
 * Approach can't be ≤ 0 (can't cool below wet bulb); small approach =
 * large/efficient tower.
 */

export interface CoolingTowerInput {
  waterInletC: number;
  waterOutletC: number;
  wetBulbC: number;
  waterFlowM3H: number;
  airMassFlowKgS?: number;     // for L/G
  cyclesOfConcentration?: number; // for blowdown, default 3
  driftFraction?: number;      // default 0.0002 (0.02%)
}

export interface CoolingTowerResult {
  rangeC: number;
  approachC: number;
  heatRejectionKW: number;
  evaporationM3H: number;
  blowdownM3H: number;
  driftM3H: number;
  makeupM3H: number;
  lgRatio: number | null;
  feasible: boolean;
  warnings: string[];
}

export function compute(input: CoolingTowerInput): CoolingTowerResult {
  const warnings: string[] = [];
  const range = input.waterInletC - input.waterOutletC;
  const approach = input.waterOutletC - input.wetBulbC;
  if (range <= 0) warnings.push('Water inlet must be warmer than outlet.');
  const feasible = approach > 0;
  if (!feasible) warnings.push('Outlet temp ≤ wet bulb: impossible (can\'t cool below wet bulb).');

  // Heat rejection: ṁ = waterFlow(m³/h)·1000 kg/m³ /3600 → kg/s; cp 4.186.
  const mWater = (input.waterFlowM3H * 1000) / 3600; // kg/s
  const heatRejection = mWater * 4.186 * Math.max(0, range); // kW

  // Evaporation rule of thumb: ~1.8% of circulation per 10°C range... use
  // E ≈ 0.00085 · waterFlow · range·1.8 (in m³/h, range in °C).
  const evaporation = 0.00085 * input.waterFlowM3H * range * 1.8;

  const cycles = input.cyclesOfConcentration ?? 3;
  const drift = (input.driftFraction ?? 0.0002) * input.waterFlowM3H;
  // Blowdown from cycles balance: B = E/(cycles − 1) − D.
  const blowdown = cycles > 1 ? Math.max(0, evaporation / (cycles - 1) - drift) : 0;
  const makeup = evaporation + drift + blowdown;

  let lg: number | null = null;
  if (input.airMassFlowKgS != null && input.airMassFlowKgS > 0) {
    lg = mWater / input.airMassFlowKgS;
  }

  return {
    rangeC: range,
    approachC: approach,
    heatRejectionKW: heatRejection,
    evaporationM3H: evaporation,
    blowdownM3H: blowdown,
    driftM3H: drift,
    makeupM3H: makeup,
    lgRatio: lg,
    feasible,
    warnings,
  };
}

/** Tower effectiveness = range / (range + approach). */
export function effectiveness(result: CoolingTowerResult): number {
  const denom = result.rangeC + result.approachC;
  return denom > 0 ? result.rangeC / denom : 0;
}

export function summarize(r: CoolingTowerResult): { rangeC: number; approachC: number; makeupM3H: number; heatRejectionKW: number } {
  return { rangeC: r.rangeC, approachC: r.approachC, makeupM3H: r.makeupM3H, heatRejectionKW: r.heatRejectionKW };
}
