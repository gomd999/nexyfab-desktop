/**
 * laserCutCost.ts — Estimate the per-part laser-cutting cost from cut
 * length, pierce count, sheet material/thickness, machine rate, gas, and
 * sheet material cost.
 *
 *   cutTime    = cutLength / feedRate(thickness, material)
 *   pierceTime = pierces · pierceTimePerHole(thickness)
 *   cycleTime  = cutTime + pierceTime + handlingTime
 *   cost = (cycleTime/60)·(machineRate + gasRate)
 *        + materialCost (sheet area × price, adjusted by nesting yield)
 *
 * Feed rate falls with thickness; pierce time rises with thickness. A
 * material factor scales both (stainless slower than mild steel, etc).
 */

export type LaserMaterial = 'mild-steel' | 'stainless' | 'aluminium' | 'copper' | 'brass';

interface MaterialFactor {
  feedFactor: number;  // multiplies base feed
  pierceFactor: number;
}

const MATERIAL: Record<LaserMaterial, MaterialFactor> = {
  'mild-steel': { feedFactor: 1.0, pierceFactor: 1.0 },
  'stainless':  { feedFactor: 0.7, pierceFactor: 1.4 },
  'aluminium':  { feedFactor: 0.85, pierceFactor: 1.2 },
  'copper':     { feedFactor: 0.5, pierceFactor: 1.8 },
  'brass':      { feedFactor: 0.6, pierceFactor: 1.6 },
};

export interface LaserCutCostInput {
  cutLengthMm: number;
  pierceCount: number;
  thicknessMm: number;
  material: LaserMaterial;
  baseFeedMmMin?: number;       // feed at 1 mm mild steel, default 8000
  machineRatePerHour: number;
  gasRatePerHour?: number;      // assist gas, default 8
  handlingTimeSec?: number;     // load/unload, default 20
  sheetAreaMm2?: number;        // for material cost
  materialPricePerKg?: number;
  materialDensityKgM3?: number; // default 7850
  nestingYield?: number;        // usable fraction, default 0.8
}

export interface LaserCutCostResult {
  feedRateMmMin: number;
  cutTimeMin: number;
  pierceTimeMin: number;
  cycleTimeMin: number;
  machineGasCost: number;
  materialCost: number;
  totalCostPerPart: number;
  warnings: string[];
}

export function estimate(input: LaserCutCostInput): LaserCutCostResult {
  const warnings: string[] = [];
  if (input.thicknessMm <= 0) warnings.push('Thickness must be positive.');
  const mat = MATERIAL[input.material];
  if (!mat) warnings.push(`Unknown material "${input.material}".`);
  const m = mat ?? MATERIAL['mild-steel'];

  const baseFeed = input.baseFeedMmMin ?? 8000;
  // Feed falls roughly inversely with thickness.
  const feed = (baseFeed * m.feedFactor) / Math.max(0.5, input.thicknessMm);
  const cutTimeMin = feed > 0 ? input.cutLengthMm / feed : 0;

  // Pierce time per hole grows with thickness (≈ 0.2 s/mm × factor).
  const pierceTimePerSec = 0.2 * input.thicknessMm * m.pierceFactor;
  const pierceTimeMin = (input.pierceCount * pierceTimePerSec) / 60;

  const handlingMin = (input.handlingTimeSec ?? 20) / 60;
  const cycleTimeMin = cutTimeMin + pierceTimeMin + handlingMin;

  const rate = input.machineRatePerHour + (input.gasRatePerHour ?? 8);
  const machineGasCost = (cycleTimeMin / 60) * rate;

  let materialCost = 0;
  if (input.sheetAreaMm2 && input.materialPricePerKg) {
    const yieldFrac = input.nestingYield ?? 0.8;
    const density = input.materialDensityKgM3 ?? 7850;
    const volM3 = (input.sheetAreaMm2 / yieldFrac) * input.thicknessMm * 1e-9;
    const massKg = volM3 * density;
    materialCost = massKg * input.materialPricePerKg;
  }

  return {
    feedRateMmMin: feed,
    cutTimeMin,
    pierceTimeMin,
    cycleTimeMin,
    machineGasCost,
    materialCost,
    totalCostPerPart: machineGasCost + materialCost,
    warnings,
  };
}

/** Throughput: parts per hour at this cycle time. */
export function partsPerHour(result: LaserCutCostResult): number {
  return result.cycleTimeMin > 0 ? 60 / result.cycleTimeMin : 0;
}

export function summarize(r: LaserCutCostResult): { totalCostPerPart: number; cycleTimeMin: number; feedRateMmMin: number } {
  return { totalCostPerPart: r.totalCostPerPart, cycleTimeMin: r.cycleTimeMin, feedRateMmMin: r.feedRateMmMin };
}
