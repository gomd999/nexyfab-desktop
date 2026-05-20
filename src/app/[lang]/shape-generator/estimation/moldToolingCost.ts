/**
 * moldToolingCost.ts — Estimate the build cost of an injection-mold tool
 * from cavity count, part-envelope size, geometric complexity, mold-base
 * + steel cost, and machining (CNC + EDM) hours.
 *
 *   cavitySetCost = cavities · (cncHoursPerCavity + edmHoursPerCavity·edmShare) · shopRate
 *   steelCost     = moldBaseCost + cavities·cavitySteelCost
 *   designCost    = designHours · designRate
 *   featuresCost  = sliders·sliderCost + lifters·lifterCost
 *   total = steel + machining + design + features + texture/polish
 *
 * Complexity (1–5) scales CNC/EDM hours. The result also gives a per-part
 * tooling amortisation over an expected production volume.
 */

export interface MoldToolingInput {
  cavities: number;
  complexity: number;          // 1 (simple) … 5 (very complex)
  partEnvelopeCm3: number;     // bounding volume, drives base size
  shopRatePerHour: number;
  designHours: number;
  designRatePerHour: number;
  sliders?: number;
  lifters?: number;
  edmShare?: number;           // fraction of cavity work done by EDM, default 0.3
  polishGrade?: 'none' | 'standard' | 'mirror';
  expectedVolume?: number;     // for per-part amortisation
}

export interface MoldToolingResult {
  moldBaseCost: number;
  cavitySteelCost: number;
  machiningCost: number;
  designCost: number;
  featuresCost: number;
  finishingCost: number;
  totalToolCost: number;
  toolCostPerPart: number | null;
  warnings: string[];
}

const POLISH_COST: Record<NonNullable<MoldToolingInput['polishGrade']>, number> = {
  none: 0, standard: 1500, mirror: 6000,
};

export function estimate(input: MoldToolingInput): MoldToolingResult {
  const warnings: string[] = [];
  const cav = Math.max(1, input.cavities);
  if (input.cavities <= 0) warnings.push('Cavities defaulted to 1.');
  const cx = Math.max(1, Math.min(5, input.complexity));
  if (input.complexity < 1 || input.complexity > 5) warnings.push('Complexity clamped to 1–5.');

  // Mold base scales with envelope (rough): base price + size factor.
  const moldBaseCost = 2000 + Math.pow(input.partEnvelopeCm3, 0.5) * 60;
  const cavitySteelCost = cav * (400 + cx * 150);

  // Machining hours per cavity grow with complexity.
  const cncHoursPerCavity = 8 * cx;
  const edmShare = input.edmShare ?? 0.3;
  const edmHoursPerCavity = 4 * cx * edmShare;
  const machiningCost = cav * (cncHoursPerCavity + edmHoursPerCavity) * input.shopRatePerHour;

  const designCost = input.designHours * input.designRatePerHour;

  const sliderCost = (input.sliders ?? 0) * 3000;
  const lifterCost = (input.lifters ?? 0) * 2000;
  const featuresCost = sliderCost + lifterCost;

  const finishingCost = POLISH_COST[input.polishGrade ?? 'standard'];

  const total = moldBaseCost + cavitySteelCost + machiningCost + designCost + featuresCost + finishingCost;

  const perPart = (input.expectedVolume && input.expectedVolume > 0) ? total / input.expectedVolume : null;

  return {
    moldBaseCost,
    cavitySteelCost,
    machiningCost,
    designCost,
    featuresCost,
    finishingCost,
    totalToolCost: total,
    toolCostPerPart: perPart,
    warnings,
  };
}

/** Compare single vs multi-cavity tools on per-part tooling cost. */
export function cavityCostCurve(input: MoldToolingInput, cavityCounts: number[]): { cavities: number; perPart: number | null }[] {
  return cavityCounts.map(c => {
    const r = estimate({ ...input, cavities: c });
    return { cavities: c, perPart: r.toolCostPerPart };
  });
}

export function summarize(r: MoldToolingResult): { totalToolCost: number; machiningCost: number; toolCostPerPart: number | null } {
  return { totalToolCost: r.totalToolCost, machiningCost: r.machiningCost, toolCostPerPart: r.toolCostPerPart };
}
