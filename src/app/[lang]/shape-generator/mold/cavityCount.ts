/**
 * cavityCount.ts — Economic number of mold cavities.
 *
 * Total job cost as a function of cavity count n:
 *   tooling(n)  = baseToolingCost + (n − 1)·extraCavityCost
 *   machine(n)  = machineHourRate · (totalParts · cycleTimeSec) / (3600 · n)
 *   total(n)    = tooling(n) + machine(n) + material
 *
 * Minimising total over n (continuous) gives:
 *   n* = √( machineHourRate · totalParts · cycleTimeSec / (3600 · extraCavityCost) )
 * then clamp to the machine's max cavities (clamp tonnage / platen limited).
 */

export interface CavityCountInput {
  totalParts: number;
  cycleTimeSec: number;
  machineHourRate: number;       // currency / hr
  baseToolingCost: number;       // 1-cavity tool
  extraCavityCost: number;       // marginal cost per added cavity
  maxCavities?: number;          // machine/tonnage limit, default 64
}

export interface CavityCountResult {
  optimalContinuous: number;     // n* before rounding/clamping
  recommendedCavities: number;   // integer, clamped
  totalCostAtRecommended: number;
  toolingCost: number;
  machineCost: number;
  costPerPart: number;
  clampedByMachine: boolean;
  warnings: string[];
}

function totalCost(n: number, input: CavityCountInput): { tooling: number; machine: number; total: number } {
  const tooling = input.baseToolingCost + Math.max(n - 1, 0) * input.extraCavityCost;
  const machine = input.machineHourRate * (input.totalParts * input.cycleTimeSec) / (3600 * n);
  return { tooling, machine, total: tooling + machine };
}

export function compute(input: CavityCountInput): CavityCountResult {
  const warnings: string[] = [];
  const maxCav = input.maxCavities ?? 64;
  if (input.totalParts <= 0) warnings.push('Total parts must be positive.');
  if (input.extraCavityCost <= 0) warnings.push('Extra cavity cost must be positive.');

  const nStar = input.extraCavityCost > 0
    ? Math.sqrt((input.machineHourRate * input.totalParts * input.cycleTimeSec) / (3600 * input.extraCavityCost))
    : 1;

  // Compare floor/ceil integer candidates around n*, then clamp.
  const lo = Math.max(1, Math.floor(nStar));
  const hi = Math.ceil(nStar);
  const candidates = [lo, hi].map(n => Math.min(Math.max(n, 1), maxCav));
  let best = candidates[0]!;
  let bestCost = totalCost(best, input).total;
  for (const c of candidates) {
    const tc = totalCost(c, input).total;
    if (tc < bestCost) { best = c; bestCost = tc; }
  }

  const clampedByMachine = nStar > maxCav;
  if (clampedByMachine) {
    best = maxCav;
    warnings.push(`Optimal ${nStar.toFixed(1)} cavities exceeds machine limit ${maxCav}; clamped.`);
  }

  const { tooling, machine, total } = totalCost(best, input);

  return {
    optimalContinuous: nStar,
    recommendedCavities: best,
    totalCostAtRecommended: total,
    toolingCost: tooling,
    machineCost: machine,
    costPerPart: input.totalParts > 0 ? total / input.totalParts : Infinity,
    clampedByMachine,
    warnings,
  };
}

/** Total job cost for an explicit cavity count (for what-if comparison). */
export function costForCavities(input: CavityCountInput, n: number): number {
  return totalCost(Math.max(n, 1), input).total;
}

export function summarize(r: CavityCountResult): {
  recommendedCavities: number; costPerPart: number; clampedByMachine: boolean;
} {
  return { recommendedCavities: r.recommendedCavities, costPerPart: r.costPerPart, clampedByMachine: r.clampedByMachine };
}
