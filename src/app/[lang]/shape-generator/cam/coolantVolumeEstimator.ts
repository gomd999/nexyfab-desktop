/**
 * coolantVolumeEstimator.ts — Estimate coolant volume consumption for
 * a CAM operation.
 *
 * Coolant usage drives consumable cost, environmental impact, and
 * tank sizing. Module estimates:
 *
 *   - Net volume consumed (litres) given operation duration + flow
 *     rate.
 *   - Mist consumption (which is much lower).
 *   - MQL droplet consumption (50-500 mL/h).
 *   - Through-spindle pressure × volume.
 *   - Cost estimate at given coolant price/L.
 *
 * Returns per-operation + aggregate fleet summary.
 */

export type CoolantMode = 'flood' | 'mist' | 'mql' | 'through-spindle' | 'dry' | 'cryogenic';

export interface OperationDuration {
  operationId: string;
  /** Cutting time in minutes. */
  cuttingMinutes: number;
  /** Idle time during which coolant continues running (or not). */
  idleMinutes: number;
  mode: CoolantMode;
}

export interface CoolantRates {
  /** Flow rate at the spindle (L/min) for flood. */
  floodFlowLpm: number;
  /** Mist droplet volume per hour (mL/h). */
  mistMlPerHour: number;
  /** MQL droplet volume per hour. */
  mqlMlPerHour: number;
  /** Through-spindle pressure × volume estimate (L/min). */
  tscFlowLpm: number;
  /** Cryogenic LN2 / CO2 flow (kg/min). */
  cryogenicKgPerMin: number;
}

export const TYPICAL_RATES: CoolantRates = {
  floodFlowLpm: 20,
  mistMlPerHour: 200,
  mqlMlPerHour: 50,
  tscFlowLpm: 5,
  cryogenicKgPerMin: 1.5,
};

export interface ConsumptionResult {
  operationId: string;
  mode: CoolantMode;
  volumeLitres: number;
  /** Coolant remains on after cutting? */
  idleCoolantOn: boolean;
  /** Estimated cost (currency-agnostic). */
  estimatedCost: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function estimateConsumption(
  operations: OperationDuration[],
  rates: CoolantRates = TYPICAL_RATES,
  costPerUnit: Partial<Record<CoolantMode, number>> = {},
): ConsumptionResult[] {
  return operations.map(op => estimateOne(op, rates, costPerUnit));
}

function estimateOne(op: OperationDuration, rates: CoolantRates, cost: Partial<Record<CoolantMode, number>>): ConsumptionResult {
  let volume = 0;
  let idleOn = false;
  switch (op.mode) {
    case 'flood':
      volume = op.cuttingMinutes * rates.floodFlowLpm + op.idleMinutes * rates.floodFlowLpm * 0.5;
      idleOn = true;
      break;
    case 'mist':
      volume = (op.cuttingMinutes / 60) * rates.mistMlPerHour / 1000;
      break;
    case 'mql':
      volume = (op.cuttingMinutes / 60) * rates.mqlMlPerHour / 1000;
      break;
    case 'through-spindle':
      volume = op.cuttingMinutes * rates.tscFlowLpm;
      idleOn = false;
      break;
    case 'dry':
      volume = 0;
      break;
    case 'cryogenic':
      // LN2/CO2 mass in kg; treat as "volume equivalent" for cost only.
      volume = op.cuttingMinutes * rates.cryogenicKgPerMin;
      break;
  }
  const unitCost = cost[op.mode] ?? defaultCost(op.mode);
  return {
    operationId: op.operationId,
    mode: op.mode,
    volumeLitres: volume,
    idleCoolantOn: idleOn,
    estimatedCost: volume * unitCost,
  };
}

function defaultCost(mode: CoolantMode): number {
  switch (mode) {
    case 'flood': return 0.05;      // per L mixed coolant
    case 'mist': return 0.5;
    case 'mql': return 1.0;
    case 'through-spindle': return 0.1;
    case 'dry': return 0;
    case 'cryogenic': return 2.5;    // per kg LN2
  }
}

// ── Fleet aggregation ────────────────────────────────────────

export interface FleetSummary {
  totalLitres: number;
  totalCost: number;
  byMode: Record<CoolantMode, number>;
  worstOperationId: string | null;
}

export function aggregateFleet(results: ConsumptionResult[]): FleetSummary {
  const byMode: Record<CoolantMode, number> = {
    flood: 0, mist: 0, mql: 0, 'through-spindle': 0, dry: 0, cryogenic: 0,
  };
  let total = 0;
  let cost = 0;
  let worstId: string | null = null;
  let worstVol = 0;
  for (const r of results) {
    byMode[r.mode] += r.volumeLitres;
    total += r.volumeLitres;
    cost += r.estimatedCost;
    if (r.volumeLitres > worstVol) { worstVol = r.volumeLitres; worstId = r.operationId; }
  }
  return { totalLitres: total, totalCost: cost, byMode, worstOperationId: worstId };
}

// ── Tank size recommendation ─────────────────────────────────

export interface TankRecommendation {
  recommendedTankLitres: number;
  /** Days between refills. */
  daysBetweenRefills: number;
}

export function recommendTank(dailyLitres: number, refillFrequency: number = 14): TankRecommendation {
  const safety = 1.3;
  return {
    recommendedTankLitres: Math.ceil(dailyLitres * refillFrequency * safety),
    daysBetweenRefills: refillFrequency,
  };
}

// ── Mode override helper ─────────────────────────────────────

export interface OverrideSuggestion {
  operationId: string;
  oldMode: CoolantMode;
  newMode: CoolantMode;
  estimatedSavingsLitres: number;
}

export function suggestModeOverride(op: OperationDuration, target: CoolantMode, rates: CoolantRates = TYPICAL_RATES): OverrideSuggestion {
  const before = estimateOne(op, rates, {});
  const newOp: OperationDuration = { ...op, mode: target };
  const after = estimateOne(newOp, rates, {});
  return {
    operationId: op.operationId,
    oldMode: op.mode,
    newMode: target,
    estimatedSavingsLitres: before.volumeLitres - after.volumeLitres,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface ConsumptionSummary {
  operationCount: number;
  totalLitres: number;
  totalCost: number;
  dominantMode: CoolantMode;
}

export function summarize(results: ConsumptionResult[]): ConsumptionSummary {
  const agg = aggregateFleet(results);
  let dominant: CoolantMode = 'dry';
  let maxVol = 0;
  for (const [mode, vol] of Object.entries(agg.byMode) as [CoolantMode, number][]) {
    if (vol > maxVol) { maxVol = vol; dominant = mode; }
  }
  return {
    operationCount: results.length,
    totalLitres: agg.totalLitres,
    totalCost: agg.totalCost,
    dominantMode: dominant,
  };
}
