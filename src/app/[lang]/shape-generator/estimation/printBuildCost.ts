/**
 * printBuildCost.ts — Estimate the build cost of an additive-manufactured
 * part (FDM / SLA / SLS) from build time, material (part + support), and
 * machine rate.
 *
 *   layers      = heightMm / layerHeightMm
 *   buildTimeH  = layers · timePerLayerSec/3600 + volumeMm3·volRateFactor
 *   materialG   = (partVolumeMm3 + supportVolumeMm3) · density · 1e-3
 *   cost = buildTimeH·machineRate + materialG/1000·materialPricePerKg
 *        + postProcessing + setup/batchQty
 *
 * Each process carries default layer time, density, and a support factor.
 */

export type PrintProcess = 'FDM' | 'SLA' | 'SLS' | 'MJF' | 'DMLS';

interface ProcessDefaults {
  densityGcm3: number;
  timePerLayerSec: number;
  supportFraction: number;     // support volume as fraction of part
  postProcessPerPart: number;
}

const DEFAULTS: Record<PrintProcess, ProcessDefaults> = {
  FDM:  { densityGcm3: 1.04, timePerLayerSec: 12, supportFraction: 0.2, postProcessPerPart: 2 },
  SLA:  { densityGcm3: 1.15, timePerLayerSec: 8,  supportFraction: 0.15, postProcessPerPart: 5 },
  SLS:  { densityGcm3: 0.95, timePerLayerSec: 20, supportFraction: 0.0, postProcessPerPart: 3 },
  MJF:  { densityGcm3: 1.01, timePerLayerSec: 10, supportFraction: 0.0, postProcessPerPart: 3 },
  DMLS: { densityGcm3: 7.9,  timePerLayerSec: 45, supportFraction: 0.3, postProcessPerPart: 30 },
};

export interface PrintBuildCostInput {
  process: PrintProcess;
  partVolumeMm3: number;
  buildHeightMm: number;
  layerHeightMm: number;
  machineRatePerHour: number;
  materialPricePerKg: number;
  setupCost?: number;
  batchQuantity?: number;
  supportFractionOverride?: number;
}

export interface PrintBuildCostResult {
  layers: number;
  buildTimeHours: number;
  materialMassG: number;
  machineCost: number;
  materialCost: number;
  postProcessCost: number;
  setupCostPerPart: number;
  totalCostPerPart: number;
  warnings: string[];
}

export function estimate(input: PrintBuildCostInput): PrintBuildCostResult {
  const warnings: string[] = [];
  const def = DEFAULTS[input.process];
  if (!def) warnings.push(`Unknown print process "${input.process}".`);
  const d = def ?? DEFAULTS.FDM;
  if (input.layerHeightMm <= 0) warnings.push('Layer height must be positive.');

  const layers = input.layerHeightMm > 0 ? input.buildHeightMm / input.layerHeightMm : 0;
  const buildTimeHours = (layers * d.timePerLayerSec) / 3600;

  const supportFrac = input.supportFractionOverride ?? d.supportFraction;
  const totalVolMm3 = input.partVolumeMm3 * (1 + supportFrac);
  const materialMassG = totalVolMm3 * 1e-3 * d.densityGcm3;

  const machineCost = buildTimeHours * input.machineRatePerHour;
  const materialCost = (materialMassG / 1000) * input.materialPricePerKg;
  const postProcessCost = d.postProcessPerPart;
  const setupPerPart = (input.setupCost && input.batchQuantity && input.batchQuantity > 0)
    ? input.setupCost / input.batchQuantity
    : 0;

  const total = machineCost + materialCost + postProcessCost + setupPerPart;

  return {
    layers,
    buildTimeHours,
    materialMassG,
    machineCost,
    materialCost,
    postProcessCost,
    setupCostPerPart: setupPerPart,
    totalCostPerPart: total,
    warnings,
  };
}

/** Nesting more parts per build amortises time/setup — cost at a given nest count. */
export function nestCostPerPart(input: PrintBuildCostInput, partsPerBuild: number): number {
  if (partsPerBuild <= 0) return Infinity;
  const single = estimate(input);
  // Build time grows mostly with height (shared across nested parts) → machine cost / n.
  const sharedMachine = single.machineCost / partsPerBuild;
  return sharedMachine + single.materialCost + single.postProcessCost + single.setupCostPerPart / partsPerBuild;
}

export function summarize(r: PrintBuildCostResult): { totalCostPerPart: number; buildTimeHours: number; materialMassG: number } {
  return { totalCostPerPart: r.totalCostPerPart, buildTimeHours: r.buildTimeHours, materialMassG: r.materialMassG };
}
