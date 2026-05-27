/**
 * assemblyLaborCost.ts — Estimate manual-assembly labour time + cost from
 * a list of assembly operations using element standard times (a simple
 * MTM/MOST-style rollup), with a learning-curve adjustment for batch.
 *
 *   baseTime = Σ (count · timePerOpSec)
 *   withAllowance = baseTime · (1 + fatigueAllowance)
 *   learning: T_n = T_1 · n^(log2(learningRate))   (Wright's model)
 *   cost = avgTimePerUnit/3600 · labourRatePerHour
 */

export type AssemblyOpType = 'insert' | 'screw' | 'snap' | 'press' | 'route-wire' | 'apply-adhesive' | 'inspect' | 'handle';

const STANDARD_TIME_SEC: Record<AssemblyOpType, number> = {
  insert: 4, screw: 8, snap: 2, press: 6, 'route-wire': 12, 'apply-adhesive': 10, inspect: 15, handle: 3,
};

export interface AssemblyOp {
  type: AssemblyOpType;
  count: number;
  timeOverrideSec?: number;
}

export interface AssemblyLaborInput {
  operations: AssemblyOp[];
  labourRatePerHour: number;
  fatigueAllowance?: number;   // default 0.15 (PF&D)
  batchQuantity?: number;
  learningRate?: number;       // e.g. 0.9 = 90% curve, default 1 (none)
}

export interface AssemblyLaborResult {
  baseTimeSec: number;
  unitTimeSec: number;          // with allowance, first unit
  avgUnitTimeSec: number;       // learning-curve average over batch
  totalBatchTimeSec: number;
  costPerUnit: number;
  totalBatchCost: number;
  warnings: string[];
}

export function estimate(input: AssemblyLaborInput): AssemblyLaborResult {
  const warnings: string[] = [];
  if (input.operations.length === 0) warnings.push('No operations provided.');
  if (input.labourRatePerHour < 0) warnings.push('Labour rate must be non-negative.');

  let baseTime = 0;
  for (const op of input.operations) {
    const t = op.timeOverrideSec ?? STANDARD_TIME_SEC[op.type] ?? 0;
    if (!STANDARD_TIME_SEC[op.type] && op.timeOverrideSec == null) warnings.push(`Unknown op "${op.type}".`);
    baseTime += t * Math.max(0, op.count);
  }

  const allowance = input.fatigueAllowance ?? 0.15;
  const unitTime = baseTime * (1 + allowance); // first-unit time

  const n = Math.max(1, input.batchQuantity ?? 1);
  const lr = input.learningRate ?? 1;
  // Average unit time over n units (Wright's cumulative average / n).
  let avgUnit = unitTime;
  if (lr < 1 && lr > 0) {
    const b = Math.log(lr) / Math.log(2);
    // cumulative total ≈ T1 · Σ k^b ; average = total / n.
    let total = 0;
    for (let k = 1; k <= n; k++) total += Math.pow(k, b);
    avgUnit = (unitTime * total) / n;
  }

  const totalBatchTime = avgUnit * n;
  const costPerUnit = (avgUnit / 3600) * input.labourRatePerHour;
  const totalBatchCost = costPerUnit * n;

  return {
    baseTimeSec: baseTime,
    unitTimeSec: unitTime,
    avgUnitTimeSec: avgUnit,
    totalBatchTimeSec: totalBatchTime,
    costPerUnit,
    totalBatchCost,
    warnings,
  };
}

/** Standard element time for an op type (sec). */
export function standardTimeSec(type: AssemblyOpType): number {
  return STANDARD_TIME_SEC[type] ?? 0;
}

export function summarize(r: AssemblyLaborResult): { costPerUnit: number; unitTimeSec: number; avgUnitTimeSec: number } {
  return { costPerUnit: r.costPerUnit, unitTimeSec: r.unitTimeSec, avgUnitTimeSec: r.avgUnitTimeSec };
}
