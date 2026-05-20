/**
 * heatTreatCost.ts — Estimate the per-part cost of a heat-treatment
 * process (through-hardening, case-hardening, annealing, etc.) from
 * furnace cycle time, batch load, energy, and consumables.
 *
 *   batchMassKg   = partMassKg · partsPerBatch
 *   energyKWh     = batchMassKg · specificEnergyKWhPerKg · cycleFactor
 *   furnaceCost   = (cycleHours)·furnaceRatePerHour / partsPerBatch
 *   energyCost    = energyKWh · energyPricePerKWh / partsPerBatch
 *   per part      = furnaceCost + energyCost + quenchConsumable + labour
 */

export type HeatTreatProcess = 'through-harden' | 'case-harden' | 'anneal' | 'temper' | 'nitride' | 'stress-relieve';

interface ProcessDefaults {
  cycleHours: number;            // soak + ramp
  specificEnergyKWhPerKg: number;
  quenchConsumablePerKg: number;
}

const DEFAULTS: Record<HeatTreatProcess, ProcessDefaults> = {
  'through-harden': { cycleHours: 4, specificEnergyKWhPerKg: 0.6, quenchConsumablePerKg: 0.05 },
  'case-harden':    { cycleHours: 8, specificEnergyKWhPerKg: 1.0, quenchConsumablePerKg: 0.08 },
  'anneal':         { cycleHours: 6, specificEnergyKWhPerKg: 0.5, quenchConsumablePerKg: 0.0 },
  'temper':         { cycleHours: 3, specificEnergyKWhPerKg: 0.3, quenchConsumablePerKg: 0.0 },
  'nitride':        { cycleHours: 24, specificEnergyKWhPerKg: 1.5, quenchConsumablePerKg: 0.02 },
  'stress-relieve': { cycleHours: 5, specificEnergyKWhPerKg: 0.4, quenchConsumablePerKg: 0.0 },
};

export interface HeatTreatCostInput {
  process: HeatTreatProcess;
  partMassKg: number;
  partsPerBatch: number;
  furnaceRatePerHour: number;
  energyPricePerKWh: number;
  labourPerPart?: number;
  cycleHoursOverride?: number;
}

export interface HeatTreatCostResult {
  cycleHours: number;
  batchMassKg: number;
  energyKWh: number;
  furnaceCostPerPart: number;
  energyCostPerPart: number;
  quenchCostPerPart: number;
  totalCostPerPart: number;
  warnings: string[];
}

export function estimate(input: HeatTreatCostInput): HeatTreatCostResult {
  const warnings: string[] = [];
  const def = DEFAULTS[input.process];
  if (!def) warnings.push(`Unknown heat-treat process "${input.process}".`);
  const d = def ?? DEFAULTS['through-harden'];
  if (input.partsPerBatch <= 0) warnings.push('Parts per batch must be positive.');
  if (input.partMassKg <= 0) warnings.push('Part mass must be positive.');

  const cycleHours = input.cycleHoursOverride ?? d.cycleHours;
  const batchMass = input.partMassKg * Math.max(1, input.partsPerBatch);
  const energyKWh = batchMass * d.specificEnergyKWhPerKg;

  const n = Math.max(1, input.partsPerBatch);
  const furnaceCostPerPart = (cycleHours * input.furnaceRatePerHour) / n;
  const energyCostPerPart = (energyKWh * input.energyPricePerKWh) / n;
  const quenchCostPerPart = input.partMassKg * d.quenchConsumablePerKg;
  const labour = input.labourPerPart ?? 0;

  const total = furnaceCostPerPart + energyCostPerPart + quenchCostPerPart + labour;

  return {
    cycleHours,
    batchMassKg: batchMass,
    energyKWh,
    furnaceCostPerPart,
    energyCostPerPart,
    quenchCostPerPart,
    totalCostPerPart: total,
    warnings,
  };
}

/** Larger batches amortise furnace + energy fixed cycle better. */
export function batchEffect(input: HeatTreatCostInput, batchSizes: number[]): { partsPerBatch: number; costPerPart: number }[] {
  return batchSizes.map(n => ({ partsPerBatch: n, costPerPart: estimate({ ...input, partsPerBatch: n }).totalCostPerPart }))
    .sort((a, b) => a.costPerPart - b.costPerPart);
}

export function summarize(r: HeatTreatCostResult): { totalCostPerPart: number; cycleHours: number; energyKWh: number } {
  return { totalCostPerPart: r.totalCostPerPart, cycleHours: r.cycleHours, energyKWh: r.energyKWh };
}
