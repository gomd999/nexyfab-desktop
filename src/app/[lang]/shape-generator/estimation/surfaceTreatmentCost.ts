/**
 * surfaceTreatmentCost.ts — Estimate the per-part cost of a surface
 * treatment (plating, anodising, painting, powder coat, passivation)
 * from treated area, process rate, consumable, masking, and batch setup.
 *
 *   cost = area(m²)·processRatePerM2          (line/labour + energy)
 *        + area(m²)·consumablePerM2           (paint, plating salts…)
 *        + maskingCost                         (per part)
 *        + setupCost / batchQty                (rack/bath setup)
 *        + (rejectRate inflation)
 *
 * Different processes carry different default rates; the caller can
 * override. Thickness scales consumable for plating/coating.
 */

export type TreatmentProcess = 'zinc-plate' | 'anodize' | 'powder-coat' | 'wet-paint' | 'passivate' | 'e-coat' | 'hard-chrome';

interface ProcessDefaults {
  processRatePerM2: number;     // currency / m²
  consumablePerM2PerMicron: number; // currency / (m²·µm) for thickness-scaled consumable
  baseThicknessMicron: number;
}

const DEFAULTS: Record<TreatmentProcess, ProcessDefaults> = {
  'zinc-plate':   { processRatePerM2: 18, consumablePerM2PerMicron: 0.12, baseThicknessMicron: 8 },
  'anodize':      { processRatePerM2: 25, consumablePerM2PerMicron: 0.10, baseThicknessMicron: 15 },
  'powder-coat':  { processRatePerM2: 15, consumablePerM2PerMicron: 0.05, baseThicknessMicron: 70 },
  'wet-paint':    { processRatePerM2: 20, consumablePerM2PerMicron: 0.06, baseThicknessMicron: 50 },
  'passivate':    { processRatePerM2: 10, consumablePerM2PerMicron: 0.02, baseThicknessMicron: 1 },
  'e-coat':       { processRatePerM2: 22, consumablePerM2PerMicron: 0.07, baseThicknessMicron: 20 },
  'hard-chrome':  { processRatePerM2: 60, consumablePerM2PerMicron: 0.40, baseThicknessMicron: 25 },
};

export interface SurfaceTreatmentInput {
  process: TreatmentProcess;
  treatedAreaMm2: number;
  thicknessMicron?: number;     // override; else process base
  maskingCost?: number;         // per part
  setupCost?: number;
  batchQuantity?: number;
  rejectRatePercent?: number;   // default 1
  processRateOverridePerM2?: number;
}

export interface SurfaceTreatmentResult {
  areaM2: number;
  processCost: number;
  consumableCost: number;
  maskingCost: number;
  setupCostPerPart: number;
  totalCostPerPart: number;
  warnings: string[];
}

export function estimate(input: SurfaceTreatmentInput): SurfaceTreatmentResult {
  const warnings: string[] = [];
  const def = DEFAULTS[input.process];
  if (!def) warnings.push(`Unknown process "${input.process}".`);
  const d = def ?? DEFAULTS['zinc-plate'];
  if (input.treatedAreaMm2 <= 0) warnings.push('Treated area must be positive.');

  const areaM2 = input.treatedAreaMm2 * 1e-6;
  const rate = input.processRateOverridePerM2 ?? d.processRatePerM2;
  const thickness = input.thicknessMicron ?? d.baseThicknessMicron;

  const processCost = areaM2 * rate;
  const consumableCost = areaM2 * d.consumablePerM2PerMicron * thickness;
  const masking = input.maskingCost ?? 0;
  const setupPerPart = (input.setupCost && input.batchQuantity && input.batchQuantity > 0)
    ? input.setupCost / input.batchQuantity
    : 0;

  const subtotal = processCost + consumableCost + masking + setupPerPart;
  const reject = (input.rejectRatePercent ?? 1) / 100;
  const total = reject < 1 ? subtotal / (1 - reject) : subtotal;

  return {
    areaM2,
    processCost,
    consumableCost,
    maskingCost: masking,
    setupCostPerPart: setupPerPart,
    totalCostPerPart: total,
    warnings,
  };
}

/** Compare processes for the same part area + thickness. */
export function compareProcesses(areaMm2: number, processes: TreatmentProcess[], thicknessMicron?: number): { process: TreatmentProcess; costPerPart: number }[] {
  return processes.map(p => ({
    process: p,
    costPerPart: estimate({ process: p, treatedAreaMm2: areaMm2, ...(thicknessMicron !== undefined ? { thicknessMicron } : {}) }).totalCostPerPart,
  })).sort((a, b) => a.costPerPart - b.costPerPart);
}

export function summarize(r: SurfaceTreatmentResult): { totalCostPerPart: number; processCost: number; consumableCost: number } {
  return { totalCostPerPart: r.totalCostPerPart, processCost: r.processCost, consumableCost: r.consumableCost };
}
