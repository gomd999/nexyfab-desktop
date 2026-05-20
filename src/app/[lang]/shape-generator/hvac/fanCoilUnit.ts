/**
 * fanCoilUnit.ts — Size a fan-coil unit (FCU): airflow from sensible load,
 * water flow from total coil load, and select a nominal FCU size.
 *
 *   airflow   Q = Q_sensible / (ρ·cp·ΔT_air)            [m³/s]
 *   waterFlow = Q_total / (ρ_w·cp_w·ΔT_water)           [L/s]
 *
 * Then map the airflow to a catalogue FCU "size" (cfm bands) and check the
 * coil load is within the band's nominal capacity.
 */

export interface FanCoilInput {
  sensibleLoadKW: number;
  totalLoadKW: number;
  supplyAirDeltaTC: number;     // room − supply air ΔT (e.g. 10 K)
  waterDeltaTC: number;         // chilled-water ΔT (e.g. 5 K)
  airDensityKgM3?: number;      // default 1.2
}

export interface FanCoilResult {
  airflowM3PerS: number;
  airflowM3PerH: number;
  waterFlowLPerS: number;
  selectedSizeCfm: number;
  withinCapacity: boolean;
  sensibleHeatRatio: number;
  warnings: string[];
}

// Nominal FCU sizes by airflow (cfm) and nominal total capacity (kW).
const FCU_SIZES: { cfm: number; capacityKW: number }[] = [
  { cfm: 200, capacityKW: 1.5 },
  { cfm: 300, capacityKW: 2.5 },
  { cfm: 400, capacityKW: 3.5 },
  { cfm: 600, capacityKW: 5.0 },
  { cfm: 800, capacityKW: 7.0 },
  { cfm: 1200, capacityKW: 10.5 },
  { cfm: 1600, capacityKW: 14.0 },
];

const CFM_TO_M3S = 0.000471947;

export function size(input: FanCoilInput): FanCoilResult {
  const warnings: string[] = [];
  if (input.supplyAirDeltaTC <= 0) warnings.push('Supply ΔT must be positive.');
  if (input.waterDeltaTC <= 0) warnings.push('Water ΔT must be positive.');

  const rho = input.airDensityKgM3 ?? 1.2;
  const cpAir = 1.006; // kJ/kg·K
  const airflow = (rho * cpAir * input.supplyAirDeltaTC) > 0
    ? input.sensibleLoadKW / (rho * cpAir * input.supplyAirDeltaTC)
    : 0;

  const cpWater = 4.186;
  const waterFlow = (cpWater * input.waterDeltaTC) > 0
    ? input.totalLoadKW / (cpWater * input.waterDeltaTC)
    : 0; // kg/s ≈ L/s

  const airflowCfm = airflow / CFM_TO_M3S;
  const band = FCU_SIZES.find(s => s.cfm >= airflowCfm) ?? FCU_SIZES[FCU_SIZES.length - 1]!;
  const withinCapacity = input.totalLoadKW <= band.capacityKW;
  if (!withinCapacity) warnings.push(`Total load ${input.totalLoadKW} kW exceeds FCU ${band.cfm} cfm nominal ${band.capacityKW} kW.`);
  if (airflowCfm > FCU_SIZES[FCU_SIZES.length - 1]!.cfm) warnings.push('Airflow exceeds largest FCU; use an AHU or multiple units.');

  const shr = input.totalLoadKW > 0 ? input.sensibleLoadKW / input.totalLoadKW : 1;

  return {
    airflowM3PerS: airflow,
    airflowM3PerH: airflow * 3600,
    waterFlowLPerS: waterFlow,
    selectedSizeCfm: band.cfm,
    withinCapacity,
    sensibleHeatRatio: shr,
    warnings,
  };
}

/** Coil capacity (kW) of an FCU size band. */
export function capacityForSize(cfm: number): number | null {
  return FCU_SIZES.find(s => s.cfm === cfm)?.capacityKW ?? null;
}

export function summarize(r: FanCoilResult): { airflowM3PerH: number; waterFlowLPerS: number; selectedSizeCfm: number; withinCapacity: boolean } {
  return { airflowM3PerH: r.airflowM3PerH, waterFlowLPerS: r.waterFlowLPerS, selectedSizeCfm: r.selectedSizeCfm, withinCapacity: r.withinCapacity };
}
