/**
 * oee.ts — Overall Equipment Effectiveness for a manufacturing cell.
 *
 *   Availability = runTime / plannedProductionTime   (runTime = planned − downtime)
 *   Performance  = (idealCycleTime · totalCount) / runTime
 *   Quality      = goodCount / totalCount
 *   OEE          = Availability · Performance · Quality
 *
 * World-class benchmark ≈ 85 % (A 90 % · P 95 % · Q 99.9 %).
 */

export interface OeeInput {
  plannedProductionTimeMin: number;
  downtimeMin: number;            // unplanned stops
  idealCycleTimeSec: number;      // fastest cycle per part
  totalCount: number;             // total parts produced
  goodCount: number;              // parts passing quality
}

export interface OeeResult {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  runTimeMin: number;
  worldClass: boolean;            // OEE ≥ 0.85
  availabilityLossMin: number;
  performanceLossMin: number;
  qualityLossMin: number;
  warnings: string[];
}

const WORLD_CLASS = 0.85;

export function compute(input: OeeInput): OeeResult {
  const warnings: string[] = [];
  if (input.plannedProductionTimeMin <= 0) warnings.push('Planned production time must be positive.');
  if (input.totalCount <= 0) warnings.push('Total count must be positive.');
  if (input.goodCount > input.totalCount) warnings.push('Good count exceeds total count.');

  const runTime = Math.max(input.plannedProductionTimeMin - input.downtimeMin, 0);
  const availability = input.plannedProductionTimeMin > 0 ? runTime / input.plannedProductionTimeMin : 0;

  const idealMin = input.idealCycleTimeSec / 60;
  const performanceRaw = runTime > 0 ? (idealMin * input.totalCount) / runTime : 0;
  const performance = Math.min(performanceRaw, 1);
  if (performanceRaw > 1.0001) warnings.push('Performance > 100%: ideal cycle time may be understated.');

  const quality = input.totalCount > 0 ? Math.min(input.goodCount / input.totalCount, 1) : 0;

  const oee = availability * performance * quality;

  const availabilityLoss = input.downtimeMin;
  const performanceLoss = Math.max(runTime - idealMin * input.totalCount, 0);
  const qualityLoss = idealMin * (input.totalCount - input.goodCount);

  return {
    availability, performance, quality, oee,
    runTimeMin: runTime,
    worldClass: oee >= WORLD_CLASS,
    availabilityLossMin: availabilityLoss,
    performanceLossMin: performanceLoss,
    qualityLossMin: Math.max(qualityLoss, 0),
    warnings,
  };
}

/** Which of the three factors is the largest loss (smallest factor)? */
export function biggestLoss(r: OeeResult): 'availability' | 'performance' | 'quality' {
  const m = Math.min(r.availability, r.performance, r.quality);
  if (m === r.availability) return 'availability';
  if (m === r.performance) return 'performance';
  return 'quality';
}

export function summarize(r: OeeResult): { oee: number; worldClass: boolean; bottleneck: string } {
  return { oee: r.oee, worldClass: r.worldClass, bottleneck: biggestLoss(r) };
}
