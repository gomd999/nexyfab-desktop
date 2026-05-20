/**
 * forgingCost.ts — Estimate the per-part cost of a closed-die (or open-
 * die) forging from billet mass, flash/scale losses, press time, die
 * amortisation, and trim/heat-treat.
 *
 *   billetMassG = (partMassG + flashMassG) / (1 − scaleLossFraction)
 *   materialCost = billetMassG/1000 · pricePerKg − flashScrapCredit
 *   forgeCost   = (strokeTimeSec/3600)·pressRatePerHour + heatingPerPart
 *   dieCost     = diePrice / dieLifeParts
 *   trimCost + heatTreatCost
 *
 * Flash is the material squeezed into the flash land — pure loss (sold as
 * scrap). Scale is oxidation loss in the furnace. Die life is much lower
 * than casting tools (hot-work die wear), so die amortisation matters.
 */

export type ForgingProcess = 'closed-die' | 'open-die' | 'upset' | 'cold-forge';

interface ForgeDefaults {
  flashFraction: number;     // flash mass / part mass
  scaleLossFraction: number; // furnace oxidation
  defaultDiePrice: number;
  defaultDieLife: number;
  heatingPerPart: number;
  trimPerPart: number;
}

const DEFAULTS: Record<ForgingProcess, ForgeDefaults> = {
  'closed-die': { flashFraction: 0.25, scaleLossFraction: 0.03, defaultDiePrice: 25000, defaultDieLife: 10000, heatingPerPart: 1.5, trimPerPart: 0.6 },
  'open-die':   { flashFraction: 0.05, scaleLossFraction: 0.05, defaultDiePrice: 3000,  defaultDieLife: 50000, heatingPerPart: 2.5, trimPerPart: 0.2 },
  'upset':      { flashFraction: 0.10, scaleLossFraction: 0.03, defaultDiePrice: 15000, defaultDieLife: 20000, heatingPerPart: 1.2, trimPerPart: 0.4 },
  'cold-forge': { flashFraction: 0.05, scaleLossFraction: 0.0,  defaultDiePrice: 40000, defaultDieLife: 100000, heatingPerPart: 0.0, trimPerPart: 0.3 },
};

export interface ForgingCostInput {
  process: ForgingProcess;
  partMassG: number;
  materialPricePerKg: number;
  strokeTimeSec: number;
  pressRatePerHour: number;
  scrapReturnPricePerKg?: number; // default 0.35×material
  diePrice?: number;
  dieLifeParts?: number;
  heatTreatPerPart?: number;
}

export interface ForgingCostResult {
  billetMassG: number;
  flashMassG: number;
  materialCost: number;
  forgeCost: number;
  dieCostPerPart: number;
  trimCost: number;
  heatTreatCost: number;
  totalCostPerPart: number;
  warnings: string[];
}

export function estimate(input: ForgingCostInput): ForgingCostResult {
  const warnings: string[] = [];
  const def = DEFAULTS[input.process];
  if (!def) warnings.push(`Unknown forging process "${input.process}".`);
  const d = def ?? DEFAULTS['closed-die'];
  if (input.partMassG <= 0) warnings.push('Part mass must be positive.');

  const flashMassG = input.partMassG * d.flashFraction;
  const billetMassG = (input.partMassG + flashMassG) / (1 - d.scaleLossFraction);

  const scrapPrice = input.scrapReturnPricePerKg ?? 0.35 * input.materialPricePerKg;
  const materialCost = (billetMassG / 1000) * input.materialPricePerKg
    - (flashMassG / 1000) * scrapPrice;

  const forgeCost = (input.strokeTimeSec / 3600) * input.pressRatePerHour + d.heatingPerPart;

  const diePrice = input.diePrice ?? d.defaultDiePrice;
  const dieLife = input.dieLifeParts ?? d.defaultDieLife;
  const dieCostPerPart = dieLife > 0 ? diePrice / dieLife : 0;

  const trimCost = d.trimPerPart;
  const heatTreatCost = input.heatTreatPerPart ?? 0;

  const total = materialCost + forgeCost + dieCostPerPart + trimCost + heatTreatCost;

  return {
    billetMassG,
    flashMassG,
    materialCost,
    forgeCost,
    dieCostPerPart,
    trimCost,
    heatTreatCost,
    totalCostPerPart: total,
    warnings,
  };
}

/** Material utilisation = part mass / billet mass. */
export function materialUtilisation(result: ForgingCostResult, partMassG: number): number {
  return result.billetMassG > 0 ? partMassG / result.billetMassG : 0;
}

/** Compare processes for the same part. */
export function compareProcesses(partMassG: number, materialPricePerKg: number, strokeTimeSec: number, pressRatePerHour: number, processes: ForgingProcess[]): { process: ForgingProcess; costPerPart: number }[] {
  return processes.map(p => ({
    process: p,
    costPerPart: estimate({ process: p, partMassG, materialPricePerKg, strokeTimeSec, pressRatePerHour }).totalCostPerPart,
  })).sort((a, b) => a.costPerPart - b.costPerPart);
}

export function summarize(r: ForgingCostResult): { totalCostPerPart: number; billetMassG: number; materialCost: number } {
  return { totalCostPerPart: r.totalCostPerPart, billetMassG: r.billetMassG, materialCost: r.materialCost };
}
