/**
 * typAnnotationCollapse.ts — Collapse repeated drawing dimensions
 * into "TYP" (typical) notation.
 *
 * Drawings often have many identical features (e.g., 12 of the
 * same Ø6.5 hole). Calling out each individually is cluttered.
 * Standard practice: call out ONE and tag it "12× TYP" or
 * "12 PLACES" so the reader knows the same dimension applies
 * elsewhere.
 *
 * Module collapses identical dimensions:
 *
 *   - Same nominal value (within tolerance).
 *   - Same feature type (hole / slot / fillet / fold).
 *   - Same tolerance class.
 *
 * Output: representative annotations with quantity multiplier,
 * plus a list of suppressed redundant callouts.
 */

export interface DimensionEntity {
  id: string;
  /** Display value (e.g., "Ø6.5", "5×30", "R3"). */
  value: string;
  /** Feature kind. */
  featureKind: 'hole' | 'slot' | 'fillet' | 'chamfer' | 'thread' | 'linear';
  /** Tolerance string (e.g., "H7", "±0.05"). */
  tolerance?: string;
  /** Position for grouping (used for "TYP within zone" callouts). */
  position?: { x: number; y: number };
}

export interface TypCallout {
  /** Representative dimension that survives. */
  representative: DimensionEntity;
  /** Count this dimension applies to (including representative). */
  quantity: number;
  /** Other instance ids that share this dimension. */
  suppressedIds: string[];
  /** Suggested display label, e.g. "Ø6.5 (4 PLACES)" or "M6 TYP". */
  displayLabel: string;
}

export interface CollapseResult {
  /** Callouts after collapse. */
  callouts: TypCallout[];
  /** Dimensions left as-is (no duplicates). */
  unique: DimensionEntity[];
  /** Total dimensions suppressed. */
  suppressedCount: number;
}

export interface CollapseOptions {
  /** Minimum count to trigger collapse (e.g., 2). */
  minCount: number;
  /** Use "TYP" vs explicit count. */
  preferTypLabel: boolean;
  /** Spatial clustering: only collapse within distance ε on drawing. */
  spatialClusterDistance?: number;
}

export const DEFAULT_OPTIONS: CollapseOptions = {
  minCount: 2,
  preferTypLabel: false,
};

// ── Top-level entry ────────────────────────────────────────────

export function collapseDimensions(dimensions: DimensionEntity[], options: Partial<CollapseOptions> = {}): CollapseResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Group by signature (value + kind + tolerance).
  const groups = new Map<string, DimensionEntity[]>();
  for (const d of dimensions) {
    const sig = `${d.value}|${d.featureKind}|${d.tolerance ?? ''}`;
    const list = groups.get(sig) ?? [];
    list.push(d);
    groups.set(sig, list);
  }

  const callouts: TypCallout[] = [];
  const unique: DimensionEntity[] = [];
  let suppressed = 0;

  for (const list of groups.values()) {
    if (list.length < opts.minCount) {
      unique.push(...list);
      continue;
    }
    // Spatial cluster if requested.
    if (opts.spatialClusterDistance !== undefined && opts.spatialClusterDistance > 0) {
      const clusters = clusterSpatially(list, opts.spatialClusterDistance);
      for (const cluster of clusters) {
        if (cluster.length < opts.minCount) {
          unique.push(...cluster);
          continue;
        }
        callouts.push(buildCallout(cluster, opts));
        suppressed += cluster.length - 1;
      }
    } else {
      callouts.push(buildCallout(list, opts));
      suppressed += list.length - 1;
    }
  }

  return { callouts, unique, suppressedCount: suppressed };
}

// ── Spatial clustering ────────────────────────────────────────

function clusterSpatially(dimensions: DimensionEntity[], distance: number): DimensionEntity[][] {
  const clusters: DimensionEntity[][] = [];
  const used = new Set<number>();
  for (let i = 0; i < dimensions.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const cluster: DimensionEntity[] = [dimensions[i]!];
    for (let j = i + 1; j < dimensions.length; j++) {
      if (used.has(j)) continue;
      if (closeBy(dimensions[i]!, dimensions[j]!, distance)) {
        cluster.push(dimensions[j]!);
        used.add(j);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function closeBy(a: DimensionEntity, b: DimensionEntity, dist: number): boolean {
  if (!a.position || !b.position) return true;
  return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) <= dist;
}

function buildCallout(list: DimensionEntity[], opts: CollapseOptions): TypCallout {
  const representative = list[0]!;
  const label = opts.preferTypLabel
    ? `${representative.value} TYP`
    : `${representative.value} (${list.length} PLACES)`;
  return {
    representative,
    quantity: list.length,
    suppressedIds: list.slice(1).map(d => d.id),
    displayLabel: label,
  };
}

// ── Expand back ───────────────────────────────────────────────

/** Reconstruct full list of dimensions from a collapse result. */
export function expandCallouts(result: CollapseResult): DimensionEntity[] {
  const out: DimensionEntity[] = [...result.unique];
  for (const co of result.callouts) {
    out.push(co.representative);
    for (const id of co.suppressedIds) {
      // We don't have full data for suppressed entries here — return placeholder copies.
      out.push({ ...co.representative, id });
    }
  }
  return out;
}

// ── Summary ────────────────────────────────────────────────────

export interface CollapseSummary {
  beforeCount: number;
  afterCount: number;
  collapseRatio: number;
  calloutCount: number;
  largestQuantity: number;
}

export function summarize(input: DimensionEntity[], result: CollapseResult): CollapseSummary {
  const after = result.callouts.length + result.unique.length;
  const largestQty = result.callouts.reduce((m, c) => Math.max(m, c.quantity), 0);
  return {
    beforeCount: input.length,
    afterCount: after,
    collapseRatio: input.length > 0 ? after / input.length : 1,
    calloutCount: result.callouts.length,
    largestQuantity: largestQty,
  };
}
