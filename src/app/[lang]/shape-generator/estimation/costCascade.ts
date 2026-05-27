/**
 * costCascade.ts — Multi-pool overhead cascade for part cost.
 *
 * The existing CostEstimator + cost regression compute a single
 * cost number. Real shops break it into pools that cascade:
 *
 *   direct material
 *     → direct labor (machine time × hourly rate)
 *       → factory overhead (allocated by labor hours)
 *         → general/administrative overhead (allocated by total cost)
 *           → margin / profit (% markup)
 *             → sales price
 *
 * Each pool may have its own allocation basis. The cascade is
 * order-dependent: G&A is computed on factory cost (mat + labor + FOH),
 * then margin on G&A-loaded cost. Mis-ordering inflates / deflates
 * prices by 10-20%.
 *
 * This module makes the cascade explicit and traceable: every dollar
 * tagged with which pool added it. The UI can show a waterfall chart.
 */

export type AllocationBasis = 'flat' | 'percent-of' | 'per-labor-hour' | 'per-material-cost';

export interface CostPool {
  /** Pool id (e.g. "foh", "ga", "margin"). */
  id: string;
  /** Display name. */
  name: string;
  /** Cascade order — lower = applied earlier. */
  order: number;
  /** Allocation method. */
  basis: AllocationBasis;
  /** Allocation rate. Meaning depends on basis. */
  rate: number;
  /** When 'percent-of', the pool id to take percent of. */
  percentOf?: string;
}

export interface PartCostInput {
  /** Direct material cost (USD). */
  materialUsd: number;
  /** Direct labor hours. */
  laborHours: number;
  /** Labor hourly rate (USD/hr). */
  laborRateUsd: number;
}

export interface CostLine {
  /** Pool that added this line. */
  poolId: string;
  poolName: string;
  /** Dollar amount. */
  amountUsd: number;
  /** Allocation note (for the waterfall hover). */
  note: string;
}

export interface CascadeResult {
  /** Per-pool cost lines in cascade order. */
  lines: CostLine[];
  /** Cumulative subtotals — useful for waterfall rendering. */
  subtotals: Array<{ afterPoolId: string; subtotalUsd: number }>;
  /** Final price. */
  totalUsd: number;
}

// ── Top-level entry ─────────────────────────────────────────────

export function computeCascade(part: PartCostInput, pools: CostPool[]): CascadeResult {
  const lines: CostLine[] = [];
  const poolTotals: Map<string, number> = new Map();

  const materialLine: CostLine = {
    poolId: 'material',
    poolName: 'Direct Material',
    amountUsd: part.materialUsd,
    note: `material × 1`,
  };
  lines.push(materialLine);
  poolTotals.set('material', part.materialUsd);

  const laborCost = part.laborHours * part.laborRateUsd;
  const laborLine: CostLine = {
    poolId: 'labor',
    poolName: 'Direct Labor',
    amountUsd: laborCost,
    note: `${part.laborHours.toFixed(2)} hr × $${part.laborRateUsd.toFixed(2)}/hr`,
  };
  lines.push(laborLine);
  poolTotals.set('labor', laborCost);

  // Cascade pools in order.
  const sortedPools = [...pools].sort((a, b) => a.order - b.order);
  for (const pool of sortedPools) {
    const allocated = allocate(pool, part, poolTotals, lines);
    if (allocated <= 0) continue;
    lines.push({
      poolId: pool.id,
      poolName: pool.name,
      amountUsd: allocated,
      note: noteForPool(pool, part),
    });
    poolTotals.set(pool.id, allocated);
  }

  const subtotals = lines.map((_line, i) => {
    const cum = lines.slice(0, i + 1).reduce((s, l) => s + l.amountUsd, 0);
    return { afterPoolId: lines[i]!.poolId, subtotalUsd: cum };
  });

  const totalUsd = lines.reduce((s, l) => s + l.amountUsd, 0);
  return { lines, subtotals, totalUsd };
}

function allocate(pool: CostPool, part: PartCostInput, totals: Map<string, number>, prior: CostLine[]): number {
  switch (pool.basis) {
    case 'flat':
      return pool.rate;
    case 'percent-of': {
      if (pool.percentOf) {
        const base = totals.get(pool.percentOf) ?? 0;
        return base * pool.rate;
      }
      // No specific pool → percent of running subtotal so far.
      const subtotal = prior.reduce((s, l) => s + l.amountUsd, 0);
      return subtotal * pool.rate;
    }
    case 'per-labor-hour':
      return part.laborHours * pool.rate;
    case 'per-material-cost':
      return part.materialUsd * pool.rate;
  }
}

function noteForPool(pool: CostPool, part: PartCostInput): string {
  switch (pool.basis) {
    case 'flat':
      return `flat $${pool.rate.toFixed(2)}`;
    case 'percent-of':
      return `${(pool.rate * 100).toFixed(1)}% of ${pool.percentOf ?? 'subtotal'}`;
    case 'per-labor-hour':
      return `${part.laborHours.toFixed(2)} hr × $${pool.rate.toFixed(2)}/hr`;
    case 'per-material-cost':
      return `${(pool.rate * 100).toFixed(1)}% of material`;
  }
}

// ── Sensitivity ─────────────────────────────────────────────────

export interface SensitivityRow {
  inputName: string;
  baseValue: number;
  /** USD per 1% increase in this input. */
  perPercentImpactUsd: number;
}

/** How does total cost shift if material / labor hours / labor rate
 *  each move 1%? Useful for "where to invest in cost reduction?". */
export function sensitivity(part: PartCostInput, pools: CostPool[]): SensitivityRow[] {
  const base = computeCascade(part, pools).totalUsd;
  const out: SensitivityRow[] = [];
  for (const key of ['materialUsd', 'laborHours', 'laborRateUsd'] as const) {
    const bumped = { ...part, [key]: part[key] * 1.01 };
    const bumpedTotal = computeCascade(bumped, pools).totalUsd;
    out.push({
      inputName: key,
      baseValue: part[key],
      perPercentImpactUsd: (bumpedTotal - base),
    });
  }
  return out;
}

// ── Standard pool library ───────────────────────────────────────

export const POOLS_STANDARD_MACHINE_SHOP: CostPool[] = [
  { id: 'foh', name: 'Factory Overhead', order: 10, basis: 'per-labor-hour', rate: 25 },
  { id: 'ga', name: 'General & Admin', order: 20, basis: 'percent-of', rate: 0.10 },
  { id: 'margin', name: 'Margin', order: 30, basis: 'percent-of', rate: 0.30 },
];

export const POOLS_LIGHT_MARGIN: CostPool[] = [
  { id: 'foh', name: 'Factory Overhead', order: 10, basis: 'per-labor-hour', rate: 18 },
  { id: 'margin', name: 'Margin', order: 20, basis: 'percent-of', rate: 0.15 },
];

// ── Comparison ──────────────────────────────────────────────────

export interface CostComparison {
  totalA: number;
  totalB: number;
  /** Per-pool diffs. */
  poolDiffs: Array<{ poolId: string; diffUsd: number }>;
}

export function compareScenarios(part: PartCostInput, poolsA: CostPool[], poolsB: CostPool[]): CostComparison {
  const a = computeCascade(part, poolsA);
  const b = computeCascade(part, poolsB);
  const aMap = new Map(a.lines.map(l => [l.poolId, l.amountUsd]));
  const bMap = new Map(b.lines.map(l => [l.poolId, l.amountUsd]));
  const allPools = new Set([...aMap.keys(), ...bMap.keys()]);
  const poolDiffs: Array<{ poolId: string; diffUsd: number }> = [];
  for (const p of allPools) {
    poolDiffs.push({ poolId: p, diffUsd: (bMap.get(p) ?? 0) - (aMap.get(p) ?? 0) });
  }
  return { totalA: a.totalUsd, totalB: b.totalUsd, poolDiffs };
}
