/**
 * machiningCycleCost.ts — Estimate the per-part machining cost from cut
 * time, setup amortisation, tooling wear, and machine + labour rate.
 *
 * Cut time per feature comes from material removal:
 *   t_cut = removedVolumeMm3 / MRR(mm³/min)
 *
 * Per-part cost:
 *   C = (t_cycle/60)·(machineRate + labourRate)
 *     + setupCost / batchQty
 *     + toolingCostPerPart
 *
 * where t_cycle = Σ t_cut + toolChangeTime + handlingTime, all in min.
 * Tooling cost per part = (toolPrice / toolLifeParts) summed over tools.
 */

export interface MachiningFeature {
  name: string;
  removedVolumeMm3: number;
  mrrMm3PerMin: number;        // material removal rate
  toolChangeSec?: number;      // tool change for this feature
}

export interface ToolWear {
  toolPrice: number;
  toolLifeParts: number;       // parts before regrind/replace
}

export interface MachiningCostInput {
  features: MachiningFeature[];
  handlingTimeSec: number;     // load/unload per part
  machineRatePerHour: number;
  labourRatePerHour: number;
  setupCost: number;
  batchQuantity: number;
  tools?: ToolWear[];
  marginPercent?: number;      // markup on cost
}

export interface MachiningCostResult {
  cutTimeMin: number;
  cycleTimeMin: number;
  machineLabourCost: number;
  setupCostPerPart: number;
  toolingCostPerPart: number;
  totalCostPerPart: number;
  priceWithMargin: number;
  warnings: string[];
}

export function estimate(input: MachiningCostInput): MachiningCostResult {
  const warnings: string[] = [];
  if (input.batchQuantity <= 0) warnings.push('Batch quantity must be positive.');
  if (input.machineRatePerHour < 0 || input.labourRatePerHour < 0) warnings.push('Rates must be non-negative.');

  let cutTimeMin = 0;
  let toolChangeMin = 0;
  for (const f of input.features) {
    if (f.mrrMm3PerMin <= 0) {
      warnings.push(`Feature "${f.name}" has non-positive MRR.`);
      continue;
    }
    cutTimeMin += f.removedVolumeMm3 / f.mrrMm3PerMin;
    toolChangeMin += (f.toolChangeSec ?? 0) / 60;
  }

  const handlingMin = input.handlingTimeSec / 60;
  const cycleTimeMin = cutTimeMin + toolChangeMin + handlingMin;

  const rate = input.machineRatePerHour + input.labourRatePerHour;
  const machineLabourCost = (cycleTimeMin / 60) * rate;

  const setupPerPart = input.batchQuantity > 0 ? input.setupCost / input.batchQuantity : input.setupCost;

  let toolingPerPart = 0;
  for (const t of input.tools ?? []) {
    if (t.toolLifeParts > 0) toolingPerPart += t.toolPrice / t.toolLifeParts;
  }

  const totalCost = machineLabourCost + setupPerPart + toolingPerPart;
  const margin = (input.marginPercent ?? 0) / 100;
  const price = totalCost * (1 + margin);

  return {
    cutTimeMin,
    cycleTimeMin,
    machineLabourCost,
    setupCostPerPart: setupPerPart,
    toolingCostPerPart: toolingPerPart,
    totalCostPerPart: totalCost,
    priceWithMargin: price,
    warnings,
  };
}

/** Break-even batch size where setup amortises below a target fraction of cost. */
export function breakEvenBatch(input: MachiningCostInput, setupFractionTarget: number = 0.1): number {
  // setup/qty ≤ fraction × (machineLabour + tooling + setup/qty) → solve qty.
  const base = estimate({ ...input, batchQuantity: 1_000_000 }); // setup ~0
  const variableCost = base.machineLabourCost + base.toolingCostPerPart;
  if (setupFractionTarget <= 0 || variableCost <= 0) return Infinity;
  // setup/q = f·(variable + setup/q) → setup/q·(1−f) = f·variable → q = setup·(1−f)/(f·variable)
  return Math.ceil((input.setupCost * (1 - setupFractionTarget)) / (setupFractionTarget * variableCost));
}

export function summarize(r: MachiningCostResult): { cycleTimeMin: number; totalCostPerPart: number; priceWithMargin: number } {
  return { cycleTimeMin: r.cycleTimeMin, totalCostPerPart: r.totalCostPerPart, priceWithMargin: r.priceWithMargin };
}
