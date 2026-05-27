/**
 * freightCost.ts — Estimate logistics/freight cost for a shipment, picking
 * the billable weight (max of actual vs dimensional/volumetric weight) and
 * applying mode rates + accessorials.
 *
 *   dimWeightKg = volumeCm3 / dimFactor    (air ≈ 5000, road ≈ 3000–4000)
 *   billableKg  = max(actualKg, dimWeightKg)
 *   freight     = billableKg · ratePerKg + fuelSurcharge + handling
 *
 * For full containers we compare LCL (per-kg) vs FCL (flat container) to
 * find the break-even fill.
 */

export type ShipMode = 'air' | 'road' | 'sea-lcl' | 'courier';

interface ModeDefaults {
  dimFactor: number;        // cm³ per kg for dim weight
  ratePerKg: number;
  fuelSurchargePct: number;
}

const MODES: Record<ShipMode, ModeDefaults> = {
  air:     { dimFactor: 5000, ratePerKg: 4.5, fuelSurchargePct: 0.18 },
  courier: { dimFactor: 5000, ratePerKg: 6.0, fuelSurchargePct: 0.15 },
  road:    { dimFactor: 3500, ratePerKg: 0.8, fuelSurchargePct: 0.10 },
  'sea-lcl': { dimFactor: 1000, ratePerKg: 0.25, fuelSurchargePct: 0.05 },
};

export interface FreightCostInput {
  mode: ShipMode;
  actualWeightKg: number;
  volumeCm3: number;
  handlingFee?: number;
  insuranceValueAmount?: number;
  insuranceRate?: number;     // fraction of value, default 0.003
  rateOverridePerKg?: number;
}

export interface FreightCostResult {
  dimWeightKg: number;
  billableWeightKg: number;
  baseFreight: number;
  fuelSurcharge: number;
  insurance: number;
  handling: number;
  totalCost: number;
  dimWeighted: boolean;       // true if dim weight governs
  warnings: string[];
}

export function estimate(input: FreightCostInput): FreightCostResult {
  const warnings: string[] = [];
  const def = MODES[input.mode];
  if (!def) warnings.push(`Unknown ship mode "${input.mode}".`);
  const d = def ?? MODES.road;
  if (input.actualWeightKg <= 0) warnings.push('Actual weight must be positive.');

  const dimWeight = input.volumeCm3 / d.dimFactor;
  const billable = Math.max(input.actualWeightKg, dimWeight);
  const dimWeighted = dimWeight > input.actualWeightKg;

  const rate = input.rateOverridePerKg ?? d.ratePerKg;
  const baseFreight = billable * rate;
  const fuel = baseFreight * d.fuelSurchargePct;

  const insurance = (input.insuranceValueAmount && input.insuranceValueAmount > 0)
    ? input.insuranceValueAmount * (input.insuranceRate ?? 0.003)
    : 0;
  const handling = input.handlingFee ?? 0;

  const total = baseFreight + fuel + insurance + handling;

  return {
    dimWeightKg: dimWeight,
    billableWeightKg: billable,
    baseFreight,
    fuelSurcharge: fuel,
    insurance,
    handling,
    totalCost: total,
    dimWeighted,
    warnings,
  };
}

/** Cost per unit when N units share a shipment. */
export function costPerUnit(result: FreightCostResult, units: number): number {
  return units > 0 ? result.totalCost / units : Infinity;
}

/** Compare modes for the same shipment. */
export function compareModes(actualWeightKg: number, volumeCm3: number, modes: ShipMode[]): { mode: ShipMode; totalCost: number }[] {
  return modes.map(m => ({ mode: m, totalCost: estimate({ mode: m, actualWeightKg, volumeCm3 }).totalCost }))
    .sort((a, b) => a.totalCost - b.totalCost);
}

export function summarize(r: FreightCostResult): { billableWeightKg: number; totalCost: number; dimWeighted: boolean } {
  return { billableWeightKg: r.billableWeightKg, totalCost: r.totalCost, dimWeighted: r.dimWeighted };
}
