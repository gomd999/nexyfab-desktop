/**
 * batchQuoteService.ts — Multi-part batch quote optimizer.
 *
 * Single-part quotes (CostEstimator + costCascade) tell you what one
 * unit costs. Customers usually buy in batches and want quantity
 * discounts, shared setup costs, and aggregated lead times. This
 * module assembles the batch-level quote:
 *
 *   - **Setup grouping** — parts sharing material + machine can share
 *     setup time across the batch.
 *   - **Quantity discount tiers** — per-part unit cost drops at break
 *     points (10/50/100/500).
 *   - **Material consolidation** — same material across parts → bulk
 *     pricing.
 *   - **Lead-time aggregation** — max(per-part) + safety margin.
 *   - **Multi-quote scenarios** — produce quotes at multiple quantity
 *     levels in one call ("how does the price drop if I order 100
 *     instead of 50?").
 */

export interface PartQuoteRequest {
  /** Part id. */
  partId: string;
  /** Quantity ordered. */
  quantity: number;
  /** Single-unit cost components (already computed). */
  unitCost: {
    materialUsd: number;
    laborSec: number;
    setupSec: number;
  };
  /** Material id (for material consolidation). */
  materialId: string;
  /** Machine id (for shared setup). */
  machineId: string;
  /** Per-part lead time (days). */
  leadTimeDays: number;
}

export interface ShopRates {
  laborRateUsdPerHour: number;
  /** Per-machine hourly rate (USD/hr). Fallback if not in map. */
  defaultMachineRate: number;
  machineRatesUsdPerHour: Record<string, number>;
  /** Setup time multiplier when sharing across parts (0.3 = 70% saved). */
  sharedSetupFactor: number;
  /** Quantity-discount break-points + multipliers. */
  quantityDiscounts: Array<{ minQuantity: number; multiplier: number }>;
  /** Material bulk-pricing tiers (kg → discount fraction). */
  materialTiers?: Array<{ minKg: number; multiplier: number }>;
  /** Lead-time safety margin (days). */
  leadTimeMarginDays: number;
}

export const DEFAULT_SHOP_RATES: ShopRates = {
  laborRateUsdPerHour: 50,
  defaultMachineRate: 30,
  machineRatesUsdPerHour: {},
  sharedSetupFactor: 0.3,
  quantityDiscounts: [
    { minQuantity: 10, multiplier: 0.95 },
    { minQuantity: 50, multiplier: 0.85 },
    { minQuantity: 100, multiplier: 0.75 },
    { minQuantity: 500, multiplier: 0.65 },
  ],
  leadTimeMarginDays: 3,
};

export interface BatchQuote {
  /** Per-part line items. */
  lines: BatchLine[];
  /** Total before discount. */
  rawTotalUsd: number;
  /** Total after all discounts. */
  totalUsd: number;
  /** Estimated lead time (days). */
  leadTimeDays: number;
  /** Setup-sharing savings (USD). */
  setupSavingsUsd: number;
  /** Quantity-discount savings (USD). */
  quantityDiscountUsd: number;
  /** Notes / warnings. */
  notes: string[];
}

export interface BatchLine {
  partId: string;
  quantity: number;
  unitCostBeforeDiscountUsd: number;
  unitCostAfterDiscountUsd: number;
  /** Discount tier applied. */
  discountMultiplier: number;
  /** Setup share (fraction this part bears). */
  setupShare: number;
  lineTotalUsd: number;
}

// ── Top-level entry ─────────────────────────────────────────────

export function quoteBatch(parts: PartQuoteRequest[], rates: Partial<ShopRates> = {}): BatchQuote {
  const r = { ...DEFAULT_SHOP_RATES, ...rates };
  if (parts.length === 0) {
    return {
      lines: [], rawTotalUsd: 0, totalUsd: 0,
      leadTimeDays: 0, setupSavingsUsd: 0, quantityDiscountUsd: 0,
      notes: ['Empty batch'],
    };
  }
  const notes: string[] = [];

  // 1. Group by (material, machine) for shared setup.
  const setupGroups = new Map<string, PartQuoteRequest[]>();
  for (const p of parts) {
    const key = `${p.materialId}|${p.machineId}`;
    if (!setupGroups.has(key)) setupGroups.set(key, []);
    setupGroups.get(key)!.push(p);
  }

  // 2. Compute per-part cost.
  const lines: BatchLine[] = [];
  let setupSavings = 0;
  let qtyDiscountSavings = 0;

  for (const group of setupGroups.values()) {
    if (group.length === 0) continue;
    // Sort so the first (longest-setup) part pays full setup; rest share.
    const sortedGroup = [...group].sort((a, b) => b.unitCost.setupSec - a.unitCost.setupSec);
    const maxSetupSec = sortedGroup[0]!.unitCost.setupSec;
    const groupTotal = sortedGroup.reduce((s, p) => s + p.unitCost.setupSec, 0);
    const savings = groupTotal - (maxSetupSec + (groupTotal - maxSetupSec) * r.sharedSetupFactor);

    for (let idx = 0; idx < sortedGroup.length; idx++) {
      const part = sortedGroup[idx]!;
      const machineRate = r.machineRatesUsdPerHour[part.machineId] ?? r.defaultMachineRate;
      const laborHours = part.unitCost.laborSec / 3600;
      const setupHours = part.unitCost.setupSec / 3600;
      // First part pays full setup; subsequent parts share.
      const fullSetupCost = setupHours * r.laborRateUsdPerHour + setupHours * machineRate;
      const sharedSetupCost = idx === 0 ? fullSetupCost : fullSetupCost * r.sharedSetupFactor;
      const cycleCost = laborHours * (r.laborRateUsdPerHour + machineRate);
      const unitCostBefore = part.unitCost.materialUsd + cycleCost + fullSetupCost;
      const unitCostShared = part.unitCost.materialUsd + cycleCost + sharedSetupCost;
      const setupShareFraction = sharedSetupCost / Math.max(1e-9, fullSetupCost);

      // Apply quantity discount.
      const tier = r.quantityDiscounts
        .filter(t => part.quantity >= t.minQuantity)
        .sort((a, b) => b.minQuantity - a.minQuantity)[0];
      const multiplier = tier?.multiplier ?? 1;
      const unitAfter = unitCostShared * multiplier;

      const lineTotal = unitAfter * part.quantity;
      qtyDiscountSavings += (unitCostShared - unitAfter) * part.quantity;
      lines.push({
        partId: part.partId,
        quantity: part.quantity,
        unitCostBeforeDiscountUsd: unitCostBefore,
        unitCostAfterDiscountUsd: unitAfter,
        discountMultiplier: multiplier,
        setupShare: setupShareFraction,
        lineTotalUsd: lineTotal,
      });
    }
    // Convert setup-time savings to USD using the *first* part's machine rate (proxy).
    const repMachine = r.machineRatesUsdPerHour[group[0]!.machineId] ?? r.defaultMachineRate;
    setupSavings += (savings / 3600) * (r.laborRateUsdPerHour + repMachine);
  }

  const rawTotal = lines.reduce((s, l) => s + l.unitCostBeforeDiscountUsd * l.quantity, 0);
  const total = lines.reduce((s, l) => s + l.lineTotalUsd, 0);
  const leadTimes = parts.map(p => p.leadTimeDays);
  const leadTime = Math.max(...leadTimes) + r.leadTimeMarginDays;

  if (setupSavings > 0) notes.push(`Shared-setup savings: $${setupSavings.toFixed(2)}`);
  if (qtyDiscountSavings > 0) notes.push(`Quantity-discount savings: $${qtyDiscountSavings.toFixed(2)}`);

  return {
    lines,
    rawTotalUsd: rawTotal,
    totalUsd: total,
    leadTimeDays: leadTime,
    setupSavingsUsd: setupSavings,
    quantityDiscountUsd: qtyDiscountSavings,
    notes,
  };
}

// ── Quantity scenario sweep ────────────────────────────────────

export interface QuantityScenario {
  quantity: number;
  unitCostUsd: number;
  totalUsd: number;
  leadTimeDays: number;
}

/** Produce quotes at multiple quantity levels for the same part. */
export function sweepQuantities(part: Omit<PartQuoteRequest, 'quantity'>, quantities: number[], rates: Partial<ShopRates> = {}): QuantityScenario[] {
  return quantities.map(q => {
    const quote = quoteBatch([{ ...part, quantity: q }], rates);
    const line = quote.lines[0];
    return {
      quantity: q,
      unitCostUsd: line?.unitCostAfterDiscountUsd ?? 0,
      totalUsd: quote.totalUsd,
      leadTimeDays: quote.leadTimeDays,
    };
  });
}

// ── Quote diff / what-if ───────────────────────────────────────

export interface QuoteComparison {
  totalDiffUsd: number;
  /** Per-part diff. */
  perPartDiffs: Array<{ partId: string; diffUsd: number }>;
  leadTimeDiffDays: number;
}

export function compareQuotes(a: BatchQuote, b: BatchQuote): QuoteComparison {
  const aMap = new Map(a.lines.map(l => [l.partId, l.lineTotalUsd]));
  const bMap = new Map(b.lines.map(l => [l.partId, l.lineTotalUsd]));
  const ids = new Set([...aMap.keys(), ...bMap.keys()]);
  const perPartDiffs: Array<{ partId: string; diffUsd: number }> = [];
  for (const id of ids) {
    perPartDiffs.push({ partId: id, diffUsd: (bMap.get(id) ?? 0) - (aMap.get(id) ?? 0) });
  }
  return {
    totalDiffUsd: b.totalUsd - a.totalUsd,
    perPartDiffs,
    leadTimeDiffDays: b.leadTimeDays - a.leadTimeDays,
  };
}
