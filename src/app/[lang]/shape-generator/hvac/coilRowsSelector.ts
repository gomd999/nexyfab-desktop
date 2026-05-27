/**
 * coilRowsSelector.ts — Select the number of rows (depth) of a finned
 * chilled/hot-water coil to meet a required air-side temperature change,
 * using the ε-NTU effectiveness method.
 *
 * Each row adds heat-transfer area → more NTU → more effectiveness, with
 * diminishing returns. For a cross-flow coil (both fluids unmixed), an
 * approximation of effectiveness:
 *
 *   ε ≈ 1 − exp{ (NTU^0.22 / Cr)·[exp(−Cr·NTU^0.78) − 1] }
 *
 * NTU = UA / C_min. UA scales roughly linearly with rows. We increase
 * rows until the achievable leaving-air temperature meets the target,
 * report effectiveness + the resulting capacity.
 */

export interface CoilRowsInput {
  airFlowM3PerS: number;
  enteringAirC: number;
  targetLeavingAirC: number;
  enteringWaterC: number;
  waterFlowKgS: number;
  uaPerRowWperK: number;       // UA contributed per row
  maxRows?: number;            // search ceiling, default 8
  airDensityKgM3?: number;     // default 1.2
}

export interface CoilRowsResult {
  selectedRows: number | null;
  effectiveness: number;
  ntu: number;
  capacityKW: number;
  achievableLeavingAirC: number;
  capacityRatioCr: number;
  warnings: string[];
}

export function select(input: CoilRowsInput): CoilRowsResult {
  const warnings: string[] = [];
  if (input.airFlowM3PerS <= 0) warnings.push('Air flow must be positive.');
  if (input.waterFlowKgS <= 0) warnings.push('Water flow must be positive.');

  const rho = input.airDensityKgM3 ?? 1.2;
  const cpAir = 1006;   // J/kg·K
  const cpWater = 4186; // J/kg·K

  const mAir = input.airFlowM3PerS * rho;       // kg/s
  const Cair = mAir * cpAir;                     // W/K
  const Cwater = input.waterFlowKgS * cpWater;   // W/K
  const Cmin = Math.min(Cair, Cwater);
  const Cmax = Math.max(Cair, Cwater);
  const Cr = Cmax > 0 ? Cmin / Cmax : 0;

  const maxRows = input.maxRows ?? 8;
  const maxDeltaT = input.enteringAirC - input.enteringWaterC; // available driving ΔT

  let selected: number | null = null;
  let effAt = 0, ntuAt = 0, capAt = 0, leavingAt = input.enteringAirC;

  for (let rows = 1; rows <= maxRows; rows++) {
    const UA = input.uaPerRowWperK * rows;
    const ntu = Cmin > 0 ? UA / Cmin : 0;
    const eff = crossFlowEffectiveness(ntu, Cr);
    const qW = eff * Cmin * maxDeltaT; // W
    const leavingAir = input.enteringAirC - qW / Math.max(1e-6, Cair);
    effAt = eff; ntuAt = ntu; capAt = qW / 1000; leavingAt = leavingAir;
    if (leavingAir <= input.targetLeavingAirC + 1e-6) { selected = rows; break; }
  }

  if (selected == null) warnings.push(`Target leaving air ${input.targetLeavingAirC}°C not reached within ${maxRows} rows; increase rows, water flow, or lower water temp.`);

  return {
    selectedRows: selected,
    effectiveness: effAt,
    ntu: ntuAt,
    capacityKW: capAt,
    achievableLeavingAirC: leavingAt,
    capacityRatioCr: Cr,
    warnings,
  };
}

/** Cross-flow (both unmixed) ε-NTU effectiveness. */
export function crossFlowEffectiveness(ntu: number, Cr: number): number {
  if (ntu <= 0) return 0;
  if (Cr <= 1e-6) return 1 - Math.exp(-ntu); // Cr→0 (phase change-like)
  const expo = (Math.pow(ntu, 0.22) / Cr) * (Math.exp(-Cr * Math.pow(ntu, 0.78)) - 1);
  return 1 - Math.exp(expo);
}

/** Capacity of a coil with a fixed number of rows. */
export function capacityForRows(input: CoilRowsInput, rows: number): number {
  const r = select({ ...input, maxRows: rows, targetLeavingAirC: -273 }); // force full search to `rows`
  return r.capacityKW;
}

export function summarize(r: CoilRowsResult): { selectedRows: number | null; effectiveness: number; capacityKW: number } {
  return { selectedRows: r.selectedRows, effectiveness: r.effectiveness, capacityKW: r.capacityKW };
}
