/**
 * castingCost.ts — Estimate the per-part cost of a cast metal component
 * (sand, gravity-die, or high-pressure die casting) from part mass,
 * material price, yield (gating losses), process labour/energy, and tool
 * amortisation.
 *
 *   pouredMassG = partMassG / castingYield     (yield < 1: runners/risers)
 *   materialCost = pouredMassG/1000 · pricePerKg − returnedScrapCredit
 *   processCost  = (partMassG/1000)·processRatePerKg + perPartLabour
 *   toolCost     = toolPrice / toolLifeParts
 *   finishingCost (fettling/machining allowance)
 *
 * Each process carries default yield + rate; HPDC has high tooling but
 * low per-part labour, sand casting the opposite.
 */

export type CastingProcess = 'sand' | 'gravity-die' | 'high-pressure-die' | 'investment';

interface ProcessDefaults {
  castingYield: number;       // part mass / poured mass
  processRatePerKg: number;   // melt + pour + energy per kg of part
  perPartLabour: number;
  defaultToolPrice: number;
  defaultToolLife: number;
  finishingPerPart: number;
}

const DEFAULTS: Record<CastingProcess, ProcessDefaults> = {
  'sand':              { castingYield: 0.55, processRatePerKg: 2.5, perPartLabour: 4.0, defaultToolPrice: 1500, defaultToolLife: 500, finishingPerPart: 3.0 },
  'gravity-die':       { castingYield: 0.65, processRatePerKg: 2.2, perPartLabour: 2.0, defaultToolPrice: 12000, defaultToolLife: 30000, finishingPerPart: 1.5 },
  'high-pressure-die': { castingYield: 0.75, processRatePerKg: 2.0, perPartLabour: 0.5, defaultToolPrice: 60000, defaultToolLife: 150000, finishingPerPart: 0.8 },
  'investment':        { castingYield: 0.60, processRatePerKg: 4.0, perPartLabour: 6.0, defaultToolPrice: 8000, defaultToolLife: 5000, finishingPerPart: 2.0 },
};

export interface CastingCostInput {
  process: CastingProcess;
  partMassG: number;
  materialPricePerKg: number;
  scrapReturnPricePerKg?: number; // credit for returned runners, default 0.4×material
  toolPrice?: number;
  toolLifeParts?: number;
  batchQuantity?: number;
  yieldOverride?: number;
}

export interface CastingCostResult {
  pouredMassG: number;
  materialCost: number;
  processCost: number;
  toolCostPerPart: number;
  finishingCost: number;
  totalCostPerPart: number;
  warnings: string[];
}

export function estimate(input: CastingCostInput): CastingCostResult {
  const warnings: string[] = [];
  const def = DEFAULTS[input.process];
  if (!def) warnings.push(`Unknown casting process "${input.process}".`);
  const d = def ?? DEFAULTS['sand'];
  if (input.partMassG <= 0) warnings.push('Part mass must be positive.');

  const yieldFrac = input.yieldOverride ?? d.castingYield;
  const pouredMassG = yieldFrac > 0 ? input.partMassG / yieldFrac : input.partMassG;
  const runnerMassG = pouredMassG - input.partMassG;

  const scrapPrice = input.scrapReturnPricePerKg ?? 0.4 * input.materialPricePerKg;
  const materialCost = (pouredMassG / 1000) * input.materialPricePerKg
    - (runnerMassG / 1000) * scrapPrice;

  const processCost = (input.partMassG / 1000) * d.processRatePerKg + d.perPartLabour;

  const toolPrice = input.toolPrice ?? d.defaultToolPrice;
  const toolLife = input.toolLifeParts ?? d.defaultToolLife;
  const toolCostPerPart = toolLife > 0 ? toolPrice / toolLife : 0;

  const finishing = d.finishingPerPart;

  const total = materialCost + processCost + toolCostPerPart + finishing;

  return {
    pouredMassG,
    materialCost,
    processCost,
    toolCostPerPart,
    finishingCost: finishing,
    totalCostPerPart: total,
    warnings,
  };
}

/** Compare casting processes for the same part. */
export function compareProcesses(partMassG: number, materialPricePerKg: number, processes: CastingProcess[], batchQuantity?: number): { process: CastingProcess; costPerPart: number }[] {
  return processes.map(p => ({
    process: p,
    costPerPart: estimate({ process: p, partMassG, materialPricePerKg, ...(batchQuantity !== undefined ? { batchQuantity } : {}) }).totalCostPerPart,
  })).sort((a, b) => a.costPerPart - b.costPerPart);
}

/** Break-even quantity where HPDC tooling beats sand casting. */
export function dieCastBreakeven(partMassG: number, materialPricePerKg: number): number {
  const sand = estimate({ process: 'sand', partMassG, materialPricePerKg });
  const hpdcDef = DEFAULTS['high-pressure-die'];
  // sand variable ≈ sand.total (no big tool); HPDC variable = total minus tool/life share.
  const hpdcVariable = estimate({ process: 'high-pressure-die', partMassG, materialPricePerKg }).totalCostPerPart
    - hpdcDef.defaultToolPrice / hpdcDef.defaultToolLife;
  const perPartSaving = sand.totalCostPerPart - hpdcVariable;
  if (perPartSaving <= 0) return Infinity;
  return Math.ceil(hpdcDef.defaultToolPrice / perPartSaving);
}

export function summarize(r: CastingCostResult): { totalCostPerPart: number; materialCost: number; pouredMassG: number } {
  return { totalCostPerPart: r.totalCostPerPart, materialCost: r.materialCost, pouredMassG: r.pouredMassG };
}
