/**
 * moldingPieceCost.ts — Estimate the per-part cost of an injection-molded
 * component from cycle time, machine rate, material, and amortised tool +
 * setup costs.
 *
 *   piece cost =
 *       (cycleTimeSec/3600)·machineRatePerHour / cavities      (machine)
 *     + shotMassG/1000 · materialPricePerKg / cavities          (material, per part)
 *     + (regrindLossFraction adjusts material)
 *     + toolCost / lifetimeParts                                (tool amortise)
 *     + setupCost / batchQty
 *
 * The shot mass = part mass × cavities + runner mass; per-part material is
 * the part mass plus its share of runner (minus regrind credit).
 */

export interface MoldingPieceCostInput {
  cycleTimeSec: number;
  cavities: number;
  machineRatePerHour: number;
  partMassG: number;
  runnerMassG: number;        // total runner for the shot
  materialPricePerKg: number;
  regrindFraction?: number;   // fraction of runner reused, default 0
  toolCost?: number;
  toolLifeParts?: number;
  setupCost?: number;
  batchQuantity?: number;
  scrapRatePercent?: number;  // rejected parts, default 2
}

export interface MoldingPieceCostResult {
  machineCostPerPart: number;
  materialCostPerPart: number;
  toolCostPerPart: number;
  setupCostPerPart: number;
  totalCostPerPart: number;
  effectiveYieldPercent: number;
  warnings: string[];
}

export function estimate(input: MoldingPieceCostInput): MoldingPieceCostResult {
  const warnings: string[] = [];
  const cav = Math.max(1, input.cavities);
  if (input.cavities <= 0) warnings.push('Cavities defaulted to 1.');
  if (input.cycleTimeSec <= 0) warnings.push('Cycle time must be positive.');

  // Machine cost is per SHOT, divided over cavities.
  const machinePerShot = (input.cycleTimeSec / 3600) * input.machineRatePerHour;
  const machinePerPart = machinePerShot / cav;

  // Material: each part's own mass + its share of the runner, minus regrind credit.
  const regrind = input.regrindFraction ?? 0;
  const runnerPerPart = input.runnerMassG / cav;
  const reusedRunner = runnerPerPart * regrind;
  const netMaterialG = input.partMassG + runnerPerPart - reusedRunner;
  const materialPerPart = (netMaterialG / 1000) * input.materialPricePerKg;

  const toolPerPart = (input.toolCost && input.toolLifeParts && input.toolLifeParts > 0)
    ? input.toolCost / input.toolLifeParts
    : 0;

  const setupPerPart = (input.setupCost && input.batchQuantity && input.batchQuantity > 0)
    ? input.setupCost / input.batchQuantity
    : 0;

  const scrap = (input.scrapRatePercent ?? 2) / 100;
  const yieldFactor = 1 - scrap;
  const subtotal = machinePerPart + materialPerPart + toolPerPart + setupPerPart;
  // scrap inflates cost of good parts.
  const total = yieldFactor > 0 ? subtotal / yieldFactor : subtotal;

  return {
    machineCostPerPart: machinePerPart,
    materialCostPerPart: materialPerPart,
    toolCostPerPart: toolPerPart,
    setupCostPerPart: setupPerPart,
    totalCostPerPart: total,
    effectiveYieldPercent: yieldFactor * 100,
    warnings,
  };
}

/** Cost benefit of adding cavities (machine + tool share vs extra tool cost). */
export function cavityBreakeven(input: MoldingPieceCostInput, candidateCavities: number[]): { cavities: number; costPerPart: number }[] {
  return candidateCavities.map(c => {
    const r = estimate({ ...input, cavities: c });
    return { cavities: c, costPerPart: r.totalCostPerPart };
  }).sort((a, b) => a.costPerPart - b.costPerPart);
}

export function summarize(r: MoldingPieceCostResult): { totalCostPerPart: number; machineCostPerPart: number; materialCostPerPart: number } {
  return { totalCostPerPart: r.totalCostPerPart, machineCostPerPart: r.machineCostPerPart, materialCostPerPart: r.materialCostPerPart };
}
