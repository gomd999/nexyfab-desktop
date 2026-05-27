/**
 * costEstimatorStage2.ts — Cost-estimate refinements: setup, finishing,
 * tolerance grade, quantity discount, material waste factor.
 *
 * Stage 1 (`CostEstimator.ts`) covers raw material + machine time
 * per process. Stage 2 wraps that result with the operational costs
 * that show up on a real quote:
 *
 *   - **Setup cost** per batch (machine programming + fixture +
 *     first-article inspection) — fixed regardless of qty, amortized.
 *   - **Finishing operations** — anodizing, painting, plating,
 *     polishing, heat treat. Each has cost-per-surface-area + min lot.
 *   - **Material waste factor** — saw kerf for CNC, sprue/runner for
 *     injection, support for FDM. Process-specific.
 *   - **Tolerance grade** — ISO 2768-m vs -f vs ±0.01mm GD&T.
 *     Adjusts machining time + inspection time.
 *   - **Quantity break discount** — typical price tier curves.
 */

export type Process = 'cnc-mill' | 'cnc-turn' | 'injection-mold' | 'sheet-metal' | 'fdm' | 'sla' | 'sls';

export type ToleranceGrade = 'iso2768-m' | 'iso2768-f' | 'precision' | 'high-precision';

export type Finishing =
  | 'as-machined'
  | 'bead-blast'
  | 'anodize-clear'
  | 'anodize-color'
  | 'powder-coat'
  | 'plating-zn'
  | 'plating-ni'
  | 'plating-cr'
  | 'polish-mirror'
  | 'heat-treat'
  | 'passivation';

export interface Stage2Inputs {
  process: Process;
  toleranceGrade: ToleranceGrade;
  finishingOps: Finishing[];
  /** Surface area of the part (cm²). Drives finishing cost. */
  surfaceAreaCm2: number;
  /** Batch / order quantity. */
  quantity: number;
}

export interface Stage2Adjustments {
  /** Setup cost per batch (USD), amortized over qty. */
  setupCostUsd: number;
  /** Per-unit setup amortization (USD). */
  setupPerUnitUsd: number;
  /** Per-unit finishing cost (USD). */
  finishingPerUnitUsd: number;
  /** Multiplier applied to base machining time / cost. */
  toleranceMultiplier: number;
  /** Material waste factor (1.0 = no waste). */
  wasteFactor: number;
  /** Quantity discount factor (≤ 1.0). */
  qtyDiscount: number;
}

// ── Setup cost ────────────────────────────────────────────────────

const SETUP_USD: Record<Process, number> = {
  'cnc-mill': 180,        // programming + fixture + first-article
  'cnc-turn': 120,
  'injection-mold': 12000, // tooling-class cost; should be amortized differently in practice
  'sheet-metal': 90,
  'fdm': 25,               // print prep + bed leveling
  'sla': 35,               // resin tank prep
  'sls': 95,               // powder bed prep + sieving
};

// ── Finishing ─────────────────────────────────────────────────────

/** Cost per cm² of surface, USD. */
const FINISHING_PER_CM2: Record<Finishing, number> = {
  'as-machined': 0,
  'bead-blast': 0.04,
  'anodize-clear': 0.08,
  'anodize-color': 0.12,
  'powder-coat': 0.10,
  'plating-zn': 0.06,
  'plating-ni': 0.18,
  'plating-cr': 0.25,
  'polish-mirror': 0.30,
  'heat-treat': 0.05,
  'passivation': 0.04,
};

/** Minimum lot charge for finishing service (USD). */
const FINISHING_MIN_USD: Record<Finishing, number> = {
  'as-machined': 0,
  'bead-blast': 25,
  'anodize-clear': 50,
  'anodize-color': 75,
  'powder-coat': 60,
  'plating-zn': 40,
  'plating-ni': 80,
  'plating-cr': 120,
  'polish-mirror': 75,
  'heat-treat': 80,
  'passivation': 35,
};

// ── Tolerance grade multipliers ──────────────────────────────────

const TOLERANCE_MULT: Record<ToleranceGrade, number> = {
  'iso2768-m': 1.0,
  'iso2768-f': 1.15,
  'precision': 1.45,
  'high-precision': 2.10,
};

// ── Material waste by process ────────────────────────────────────

const PROCESS_WASTE: Record<Process, number> = {
  'cnc-mill': 1.30,        // chip waste
  'cnc-turn': 1.20,
  'injection-mold': 1.05,  // sprue / runners
  'sheet-metal': 1.12,     // nesting offcut
  'fdm': 1.15,             // support material
  'sla': 1.08,             // cup walls
  'sls': 1.10,             // unfused powder eventually recycled, some loss
};

// ── Quantity discount ────────────────────────────────────────────

/** Returns a multiplier ≤ 1.0 representing the per-unit price after
 *  quantity-break discount. Smooth log-curve: 1 unit = 100%, 10 = ~85%,
 *  100 = ~70%, 1000 = ~55%. */
export function quantityDiscount(qty: number): number {
  if (qty <= 1) return 1.0;
  // 1 - 0.15 · log10(qty), clamped to 0.5.
  return Math.max(0.5, 1 - 0.15 * Math.log10(qty));
}

// ── Main computation ─────────────────────────────────────────────

export function computeStage2(input: Stage2Inputs): Stage2Adjustments {
  const setupCost = SETUP_USD[input.process];
  const qty = Math.max(1, input.quantity);
  const setupPerUnit = setupCost / qty;

  // Sum finishing per-unit costs.
  let finishingPerUnit = 0;
  for (const op of input.finishingOps) {
    const perCm2 = FINISHING_PER_CM2[op];
    const minLot = FINISHING_MIN_USD[op];
    const opCost = Math.max(minLot / qty, perCm2 * input.surfaceAreaCm2);
    finishingPerUnit += opCost;
  }

  return {
    setupCostUsd: setupCost,
    setupPerUnitUsd: setupPerUnit,
    finishingPerUnitUsd: finishingPerUnit,
    toleranceMultiplier: TOLERANCE_MULT[input.toleranceGrade],
    wasteFactor: PROCESS_WASTE[input.process],
    qtyDiscount: quantityDiscount(qty),
  };
}

/** Apply Stage 2 adjustments to a Stage 1 base estimate. */
export interface Stage1Estimate {
  materialCostUsd: number;
  machiningCostUsd: number;
  perUnitTotalUsd: number;
}

export function applyStage2(
  base: Stage1Estimate,
  adj: Stage2Adjustments,
): {
  materialCostUsd: number;
  machiningCostUsd: number;
  setupCostUsd: number;
  finishingCostUsd: number;
  subtotalUsd: number;
  qtyDiscountedUsd: number;
  totalPerUnitUsd: number;
} {
  const material = base.materialCostUsd * adj.wasteFactor;
  const machining = base.machiningCostUsd * adj.toleranceMultiplier;
  const subtotal = material + machining + adj.setupPerUnitUsd + adj.finishingPerUnitUsd;
  const discounted = subtotal * adj.qtyDiscount;
  return {
    materialCostUsd: material,
    machiningCostUsd: machining,
    setupCostUsd: adj.setupPerUnitUsd,
    finishingCostUsd: adj.finishingPerUnitUsd,
    subtotalUsd: subtotal,
    qtyDiscountedUsd: discounted,
    totalPerUnitUsd: discounted,
  };
}

/** Build a multi-quantity price ladder for the quote UI. */
export interface PriceTier {
  quantity: number;
  pricePerUnitUsd: number;
  totalUsd: number;
}

export function buildPriceLadder(
  base: Stage1Estimate,
  baseInputs: Omit<Stage2Inputs, 'quantity'>,
  quantities: number[] = [1, 5, 10, 25, 50, 100, 500],
): PriceTier[] {
  return quantities.map(q => {
    const adj = computeStage2({ ...baseInputs, quantity: q });
    const r = applyStage2(base, adj);
    return {
      quantity: q,
      pricePerUnitUsd: r.totalPerUnitUsd,
      totalUsd: r.totalPerUnitUsd * q,
    };
  });
}
