/**
 * extrusionCost.ts — Estimate the per-metre (and per-part) cost of an
 * extruded profile (aluminium / plastic) from cross-section mass, die
 * cost, extrusion-line rate, and finishing.
 *
 *   massPerMeterKg = crossSectionAreaMm2 · 1e-6 · densityKgM3
 *   materialCost/m = massPerMeterKg · pricePerKg
 *   lineCost/m     = (1 / lineSpeedMperMin) · lineRatePerMin
 *   dieCost/part   = diePrice / dieLifeKg · massPerPart   (amortise by throughput kg)
 *   cutPart cost   = massPerMeterKg · partLengthM · material + line + finishing
 *
 * Aluminium extrusion has cheap dies but slower lines; plastic the
 * reverse. Scrap (front/back end + transverse weld) reduces yield.
 */

export type ExtrusionMaterial = 'aluminium' | 'pvc' | 'abs' | 'polycarbonate' | 'steel';

interface ExtrudeDefaults {
  densityKgM3: number;
  lineSpeedMperMin: number;
  defaultDiePrice: number;
  dieLifeKg: number;        // total throughput before die rework
  scrapFraction: number;    // ends + setup
}

const DEFAULTS: Record<ExtrusionMaterial, ExtrudeDefaults> = {
  aluminium:     { densityKgM3: 2700, lineSpeedMperMin: 25, defaultDiePrice: 1200, dieLifeKg: 50000, scrapFraction: 0.08 },
  pvc:           { densityKgM3: 1400, lineSpeedMperMin: 40, defaultDiePrice: 6000, dieLifeKg: 200000, scrapFraction: 0.05 },
  abs:           { densityKgM3: 1050, lineSpeedMperMin: 35, defaultDiePrice: 6000, dieLifeKg: 150000, scrapFraction: 0.05 },
  polycarbonate: { densityKgM3: 1200, lineSpeedMperMin: 30, defaultDiePrice: 7000, dieLifeKg: 120000, scrapFraction: 0.06 },
  steel:         { densityKgM3: 7850, lineSpeedMperMin: 8,  defaultDiePrice: 4000, dieLifeKg: 80000, scrapFraction: 0.10 },
};

export interface ExtrusionCostInput {
  material: ExtrusionMaterial;
  crossSectionAreaMm2: number;
  materialPricePerKg: number;
  lineRatePerMin: number;       // machine + labour per minute
  partLengthM: number;
  diePrice?: number;
  finishingPerMeter?: number;   // anodise/paint per m
}

export interface ExtrusionCostResult {
  massPerMeterKg: number;
  materialCostPerMeter: number;
  lineCostPerMeter: number;
  dieCostPerMeter: number;
  finishingPerMeter: number;
  costPerMeter: number;
  costPerPart: number;
  warnings: string[];
}

export function estimate(input: ExtrusionCostInput): ExtrusionCostResult {
  const warnings: string[] = [];
  const def = DEFAULTS[input.material];
  if (!def) warnings.push(`Unknown extrusion material "${input.material}".`);
  const d = def ?? DEFAULTS.aluminium;
  if (input.crossSectionAreaMm2 <= 0) warnings.push('Cross-section area must be positive.');

  const massPerM = input.crossSectionAreaMm2 * 1e-6 * d.densityKgM3; // kg/m
  const yieldFactor = 1 - d.scrapFraction;

  const materialPerM = (massPerM / yieldFactor) * input.materialPricePerKg;
  const linePerM = d.lineSpeedMperMin > 0 ? input.lineRatePerMin / d.lineSpeedMperMin : 0;

  const diePrice = input.diePrice ?? d.defaultDiePrice;
  // amortise die by mass throughput: cost/kg = diePrice / dieLifeKg → ×mass/m.
  const dieCostPerM = d.dieLifeKg > 0 ? (diePrice / d.dieLifeKg) * massPerM : 0;

  const finishing = input.finishingPerMeter ?? 0;

  const perM = materialPerM + linePerM + dieCostPerM + finishing;
  const perPart = perM * input.partLengthM;

  return {
    massPerMeterKg: massPerM,
    materialCostPerMeter: materialPerM,
    lineCostPerMeter: linePerM,
    dieCostPerMeter: dieCostPerM,
    finishingPerMeter: finishing,
    costPerMeter: perM,
    costPerPart: perPart,
    warnings,
  };
}

/** Compare materials for the same cross-section + part length. */
export function compareMaterials(crossSectionAreaMm2: number, materialPricePerKg: number, lineRatePerMin: number, partLengthM: number, materials: ExtrusionMaterial[]): { material: ExtrusionMaterial; costPerPart: number }[] {
  return materials.map(m => ({
    material: m,
    costPerPart: estimate({ material: m, crossSectionAreaMm2, materialPricePerKg, lineRatePerMin, partLengthM }).costPerPart,
  })).sort((a, b) => a.costPerPart - b.costPerPart);
}

export function summarize(r: ExtrusionCostResult): { costPerMeter: number; costPerPart: number; massPerMeterKg: number } {
  return { costPerMeter: r.costPerMeter, costPerPart: r.costPerPart, massPerMeterKg: r.massPerMeterKg };
}
