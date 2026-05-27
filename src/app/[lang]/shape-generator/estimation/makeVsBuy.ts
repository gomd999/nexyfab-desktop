/**
 * makeVsBuy.ts — Make-vs-buy break-even analysis: compare in-house
 * production (fixed tooling/setup + variable per-part) against an outside
 * supplier quote (per-part, possibly with a one-time NRE), and find the
 * break-even volume.
 *
 *   make(q)  = makeFixed + makeVariable·q
 *   buy(q)   = buyNRE + buyPerPart·q
 *   breakEven q* where make = buy:
 *     q* = (makeFixed − buyNRE) / (buyPerPart − makeVariable)
 *
 * Below q*, the lower-fixed-cost option wins; above, the lower-variable
 * option wins. We report the cheaper option at the actual volume + the
 * cost gap.
 */

export interface MakeVsBuyInput {
  makeFixedCost: number;       // tooling + setup (one-time)
  makeVariableCost: number;    // per-part in-house
  buyNRE?: number;             // supplier one-time (tooling/NRE), default 0
  buyPerPartCost: number;      // supplier per-part
  annualVolume: number;
  inHouseCapacityPerYear?: number; // optional capacity limit
}

export interface MakeVsBuyResult {
  breakEvenVolume: number | null;
  makeTotalCost: number;
  buyTotalCost: number;
  cheaperOption: 'make' | 'buy' | 'tie';
  costGap: number;             // |make − buy| at the volume
  capacityExceeded: boolean;
  warnings: string[];
}

export function analyze(input: MakeVsBuyInput): MakeVsBuyResult {
  const warnings: string[] = [];
  if (input.annualVolume <= 0) warnings.push('Annual volume must be positive.');

  const buyNRE = input.buyNRE ?? 0;
  const q = input.annualVolume;

  const makeTotal = input.makeFixedCost + input.makeVariableCost * q;
  const buyTotal = buyNRE + input.buyPerPartCost * q;

  const denom = input.buyPerPartCost - input.makeVariableCost;
  const breakEven = Math.abs(denom) > 1e-9 ? (input.makeFixedCost - buyNRE) / denom : null;
  const validBreakEven = breakEven != null && breakEven > 0 ? breakEven : null;

  let cheaper: 'make' | 'buy' | 'tie';
  if (Math.abs(makeTotal - buyTotal) < 1e-6) cheaper = 'tie';
  else cheaper = makeTotal < buyTotal ? 'make' : 'buy';

  const capacityExceeded = input.inHouseCapacityPerYear != null && q > input.inHouseCapacityPerYear;
  if (capacityExceeded && cheaper === 'make') {
    warnings.push(`Volume ${q} exceeds in-house capacity ${input.inHouseCapacityPerYear}; buy or add capacity.`);
  }

  return {
    breakEvenVolume: validBreakEven,
    makeTotalCost: makeTotal,
    buyTotalCost: buyTotal,
    cheaperOption: cheaper,
    costGap: Math.abs(makeTotal - buyTotal),
    capacityExceeded,
    warnings,
  };
}

/** Per-part cost of each option at a volume. */
export function perPartCosts(input: MakeVsBuyInput, volume: number): { makePerPart: number; buyPerPart: number } {
  const q = Math.max(1, volume);
  return {
    makePerPart: input.makeFixedCost / q + input.makeVariableCost,
    buyPerPart: (input.buyNRE ?? 0) / q + input.buyPerPartCost,
  };
}

export function summarize(r: MakeVsBuyResult): { cheaperOption: 'make' | 'buy' | 'tie'; breakEvenVolume: number | null; costGap: number } {
  return { cheaperOption: r.cheaperOption, breakEvenVolume: r.breakEvenVolume, costGap: r.costGap };
}
