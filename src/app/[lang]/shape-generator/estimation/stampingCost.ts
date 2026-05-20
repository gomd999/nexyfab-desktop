/**
 * stampingCost.ts — Estimate the per-part cost of a sheet-metal stamping
 * (blanking / piercing / forming) from press time, material strip
 * utilisation, tooling amortisation, and press tonnage feasibility.
 *
 *   blankingForce  = perimeter · thickness · shearStrength
 *   pressTonnes    = blankingForce · safety / 9806.65
 *   stripUtil      = partArea / (pitch · stripWidth)
 *   materialCost   = (partMassG / stripUtil)/1000 · pricePerKg
 *   pressCost/part = (1 / strokesPerMin) · pressRatePerMin
 *   dieCost/part   = diePrice / dieLifeStrokes
 */

export interface StampingCostInput {
  perimeterMm: number;       // cut perimeter (blank + pierces)
  thicknessMm: number;
  shearStrengthMpa: number;  // material shear (≈0.8·UTS)
  partAreaMm2: number;
  partMassG: number;
  stripPitchMm: number;      // feed per stroke
  stripWidthMm: number;
  materialPricePerKg: number;
  strokesPerMin: number;
  pressRatePerMin: number;   // machine + labour per minute
  diePrice?: number;
  dieLifeStrokes?: number;
  pressCapacityTonnes?: number;
  safetyFactor?: number;     // tonnage safety, default 1.2
}

export interface StampingCostResult {
  blankingForceN: number;
  requiredPressTonnes: number;
  stripUtilisation: number;
  materialCost: number;
  pressCost: number;
  dieCostPerPart: number;
  totalCostPerPart: number;
  pressCapable: boolean | null;
  warnings: string[];
}

export function estimate(input: StampingCostInput): StampingCostResult {
  const warnings: string[] = [];
  if (input.thicknessMm <= 0) warnings.push('Thickness must be positive.');
  if (input.strokesPerMin <= 0) warnings.push('Strokes/min must be positive.');

  // Blanking force = L · t · τ  (N): perimeter·thickness in mm² × MPa = N.
  const blankingForce = input.perimeterMm * input.thicknessMm * input.shearStrengthMpa;
  const safety = input.safetyFactor ?? 1.2;
  const tonnes = (blankingForce * safety) / 9806.65;

  const stripArea = input.stripPitchMm * input.stripWidthMm;
  const stripUtil = stripArea > 0 ? Math.min(1, input.partAreaMm2 / stripArea) : 0;

  const materialCost = stripUtil > 0
    ? (input.partMassG / stripUtil) / 1000 * input.materialPricePerKg
    : Infinity;

  const pressCost = input.strokesPerMin > 0 ? input.pressRatePerMin / input.strokesPerMin : 0;

  const dieCostPerPart = (input.diePrice && input.dieLifeStrokes && input.dieLifeStrokes > 0)
    ? input.diePrice / input.dieLifeStrokes
    : 0;

  const total = materialCost + pressCost + dieCostPerPart;

  let pressCapable: boolean | null = null;
  if (input.pressCapacityTonnes != null) {
    pressCapable = tonnes <= input.pressCapacityTonnes;
    if (!pressCapable) warnings.push(`Required ${tonnes.toFixed(0)} t exceeds press ${input.pressCapacityTonnes} t.`);
  }

  return {
    blankingForceN: blankingForce,
    requiredPressTonnes: tonnes,
    stripUtilisation: stripUtil,
    materialCost,
    pressCost,
    dieCostPerPart,
    totalCostPerPart: total,
    pressCapable,
    warnings,
  };
}

/** Parts per hour at the given press speed. */
export function partsPerHour(strokesPerMin: number): number {
  return strokesPerMin * 60;
}

export function summarize(r: StampingCostResult): { totalCostPerPart: number; requiredPressTonnes: number; stripUtilisation: number } {
  return { totalCostPerPart: r.totalCostPerPart, requiredPressTonnes: r.requiredPressTonnes, stripUtilisation: r.stripUtilisation };
}
