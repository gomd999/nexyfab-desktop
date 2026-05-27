/**
 * bomCompareChartData.ts — Prepare chart-ready data for visualizing
 * BOM revision comparisons.
 *
 * The PDM revision tracker emits diff records. The UI needs:
 *
 *   - **Bar chart**: added / removed / quantity-changed counts.
 *   - **Cost waterfall**: line items by Δ price (positive vs
 *     negative contributors).
 *   - **Treemap data**: hierarchical view of parts by category +
 *     dollar impact.
 *   - **Top-N driver list**: items causing the largest cost shift.
 *
 * Module shapes raw diff into these chart-friendly arrays without
 * doing any rendering (kept renderer-agnostic).
 */

export type ChangeKind = 'added' | 'removed' | 'quantity-changed' | 'price-changed' | 'unchanged';

export interface BOMLineDiff {
  partNumber: string;
  category?: string;
  /** Change kind. */
  kind: ChangeKind;
  /** Old quantity (0 if added). */
  oldQty: number;
  /** New quantity (0 if removed). */
  newQty: number;
  /** Old unit price USD. */
  oldUnitPriceUsd: number;
  /** New unit price USD. */
  newUnitPriceUsd: number;
}

export interface CategorySlice {
  category: string;
  added: number;
  removed: number;
  qtyChanged: number;
  priceChanged: number;
  totalCostDeltaUsd: number;
}

export interface WaterfallSegment {
  partNumber: string;
  deltaUsd: number;
  /** Cumulative running total after this segment. */
  cumulativeUsd: number;
}

export interface TopDriver {
  partNumber: string;
  absDeltaUsd: number;
  signedDeltaUsd: number;
  kind: ChangeKind;
}

export interface ChartData {
  /** Per-kind line counts. */
  kindCounts: Record<ChangeKind, number>;
  /** Per-category aggregations. */
  categorySlices: CategorySlice[];
  /** Waterfall segments sorted by signed delta. */
  waterfall: WaterfallSegment[];
  /** Top-N drivers sorted by absolute delta. */
  topDrivers: TopDriver[];
  /** Net total cost change (sum of all deltas). */
  netCostDeltaUsd: number;
  /** Total absolute cost movement (sum of |delta|). */
  grossMovementUsd: number;
}

export interface ChartOptions {
  /** N items to include in topDrivers. */
  topN: number;
}

export const DEFAULT_OPTIONS: ChartOptions = {
  topN: 10,
};

// ── Top-level entry ────────────────────────────────────────────

export function buildChartData(lines: BOMLineDiff[], options: Partial<ChartOptions> = {}): ChartData {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const kindCounts: Record<ChangeKind, number> = {
    added: 0, removed: 0, 'quantity-changed': 0, 'price-changed': 0, unchanged: 0,
  };
  const categoryMap = new Map<string, CategorySlice>();
  const drivers: TopDriver[] = [];
  let netDelta = 0;
  let grossMovement = 0;

  for (const line of lines) {
    kindCounts[line.kind]++;
    const oldCost = line.oldQty * line.oldUnitPriceUsd;
    const newCost = line.newQty * line.newUnitPriceUsd;
    const delta = newCost - oldCost;
    netDelta += delta;
    grossMovement += Math.abs(delta);

    const cat = line.category ?? 'Uncategorized';
    const slice = categoryMap.get(cat) ?? {
      category: cat,
      added: 0, removed: 0, qtyChanged: 0, priceChanged: 0, totalCostDeltaUsd: 0,
    };
    if (line.kind === 'added') slice.added++;
    else if (line.kind === 'removed') slice.removed++;
    else if (line.kind === 'quantity-changed') slice.qtyChanged++;
    else if (line.kind === 'price-changed') slice.priceChanged++;
    slice.totalCostDeltaUsd += delta;
    categoryMap.set(cat, slice);

    if (delta !== 0) {
      drivers.push({
        partNumber: line.partNumber,
        absDeltaUsd: Math.abs(delta),
        signedDeltaUsd: delta,
        kind: line.kind,
      });
    }
  }

  // Waterfall: positive contributors first then negative, with cumulative.
  const sortedDrivers = [...drivers].sort((a, b) => b.signedDeltaUsd - a.signedDeltaUsd);
  let running = 0;
  const waterfall: WaterfallSegment[] = sortedDrivers.map(d => {
    running += d.signedDeltaUsd;
    return { partNumber: d.partNumber, deltaUsd: d.signedDeltaUsd, cumulativeUsd: running };
  });

  // Top drivers by absolute delta.
  const topDrivers = [...drivers]
    .sort((a, b) => b.absDeltaUsd - a.absDeltaUsd)
    .slice(0, opts.topN);

  // Category slices sorted by absolute total.
  const categorySlices = [...categoryMap.values()].sort((a, b) => Math.abs(b.totalCostDeltaUsd) - Math.abs(a.totalCostDeltaUsd));

  return {
    kindCounts,
    categorySlices,
    waterfall,
    topDrivers,
    netCostDeltaUsd: netDelta,
    grossMovementUsd: grossMovement,
  };
}

// ── Verdict ────────────────────────────────────────────────────

export type ImpactVerdict = 'cost-down' | 'neutral' | 'cost-up' | 'high-volatility';

export function classifyImpact(data: ChartData): ImpactVerdict {
  if (data.grossMovementUsd > Math.abs(data.netCostDeltaUsd) * 3 && data.grossMovementUsd > 10) {
    return 'high-volatility';
  }
  if (data.netCostDeltaUsd > 0.01) return 'cost-up';
  if (data.netCostDeltaUsd < -0.01) return 'cost-down';
  return 'neutral';
}

// ── Summary ────────────────────────────────────────────────────

export interface ChartSummary {
  lineCount: number;
  categoryCount: number;
  netCostDeltaUsd: number;
  verdict: ImpactVerdict;
  topDriverPart: string;
  topDriverDeltaUsd: number;
}

export function summarize(data: ChartData): ChartSummary {
  const top = data.topDrivers[0];
  return {
    lineCount: Object.values(data.kindCounts).reduce((s, v) => s + v, 0),
    categoryCount: data.categorySlices.length,
    netCostDeltaUsd: data.netCostDeltaUsd,
    verdict: classifyImpact(data),
    topDriverPart: top?.partNumber ?? '',
    topDriverDeltaUsd: top?.signedDeltaUsd ?? 0,
  };
}
