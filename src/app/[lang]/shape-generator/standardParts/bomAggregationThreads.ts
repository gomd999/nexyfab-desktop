/**
 * bomAggregationThreads.ts — Wave 2 Phase 2 Track D Week 8 (D8).
 *
 * Thread-specific BOM aggregation. The standard-parts roll-up
 * (`bomAggregation.ts`) groups fasteners + bearings; this module rolls up
 * `ThreadFeature` instances (the manufacturing-operation side of threads
 * — every threaded hole needs a tap drill + tapping operation, and the
 * shop needs the count + the total tapping length to estimate cost).
 *
 * Spec: `docs/wave-2-phase-2-threads-spec.md` §12.3 (THREAD OPERATIONS
 * block in the BOM exporter), §15 W8 (this PR scope).
 *
 * Kept separate from `bomAggregation.ts` so the fastener / bearing path
 * stays untouched — the BOM exporter composes both at the call site.
 */

import type { ThreadFeature } from '../features/threads/threadFeature';
import type { ThreadSeries } from '../features/threads/threadCatalog';
import { findThreadRow } from '../features/threads/threadCatalog';

// ─── Row schema ─────────────────────────────────────────────────────────────

/**
 * One row of the THREAD OPERATIONS BOM block. Grouped by
 * `(series, designation, class)` — two M8 threads at class 6H vs 7H roll up
 * as separate lines because the operator may pick different tap sizes for
 * the tighter class.
 */
export interface ThreadBomLine {
  /** Canonical catalog designation. `M8`, `1/4-20 UNC`, `NPT 1/2`, `G 1/4`. */
  designation: string;
  /** Catalog series — preserved so the exporter can group ISO/UTS/NPT/BSP. */
  series: ThreadSeries;
  /** Tolerance class — `6H` / `2B` / `A` / `B` / `Rc`. */
  class: string;
  /** Number of features rolled up into this line. */
  count: number;
  /** Sum of feature lengths (mm). 0 if every input is annotation-only. */
  totalLength: number;
  /** Tap-drill diameter (mm) — from the catalog row. `null` if row missing. */
  tapDrillMm: number | null;
  /**
   * Distribution by direction. Right-hand is default — only present when
   * mixed (any left-hand within the group).
   */
  directionMix?: { right: number; left: number };
  /**
   * Distribution by mode. Only present when mixed cosmetic + geometric
   * within the same designation+class group.
   */
  modeMix?: { cosmetic: number; geometric: number };
  /**
   * Distribution by kind (internal / external). Internal is by far the most
   * common; this field is only populated if the group has any external
   * threads (external bosses are rare on tapped parts).
   */
  kindMix?: { internal: number; external: number };
  /**
   * Distribution of distinct classes within the rolled-up parent group.
   * `aggregateThreads` groups on class, so a single line will always have
   * `{ [class]: count }` with one key; the `classDistribution` is a
   * pre-aggregation snapshot kept for downstream UIs that want to display
   * a roll-up "M8 (× 8) → 6H × 6 / 7H × 2" hint.
   */
  classDistribution: Readonly<Record<string, number>>;
}

/** Options for `aggregateThreads`. */
export interface ThreadAggregationOptions {
  /** Collapse classes within the same designation. Default `false`. */
  collapseClasses?: boolean;
  /**
   * Collapse direction (RH vs LH) within the same designation+class.
   * Default `false` — LH and RH genuinely cost differently to tap, so
   * the BOM keeps them separate by default.
   */
  collapseDirection?: boolean;
}

// ─── Aggregation ────────────────────────────────────────────────────────────

function groupKey(
  feature: ThreadFeature,
  opts: Required<ThreadAggregationOptions>,
): string {
  const series = feature.threadRef.series;
  const desig = feature.threadRef.designation;
  const cls = opts.collapseClasses ? '' : feature.class;
  const dir = opts.collapseDirection ? '' : feature.threadDirection;
  return `${series}|${desig}|${cls}|${dir}`;
}

/**
 * Roll up `ThreadFeature[]` into one `ThreadBomLine` per
 * `(series, designation, class, direction)` tuple. Stable sort by series
 * (ISO → UTS → NPT → BSP) then by designation alphabetically.
 *
 * Pure function — does not mutate the inputs. Safe to call from anywhere.
 *
 * @example
 *   const lines = aggregateThreads([
 *     makeThreadFeature({ id: '1', threadRef: { series: 'ISO_M_COARSE', designation: 'M8' }, length: 20 }),
 *     makeThreadFeature({ id: '2', threadRef: { series: 'ISO_M_COARSE', designation: 'M8' }, length: 15 }),
 *   ]);
 *   // → [{ designation: 'M8', count: 2, totalLength: 35, tapDrillMm: 6.8, ... }]
 */
export function aggregateThreads(
  features: readonly ThreadFeature[],
  options: ThreadAggregationOptions = {},
): ThreadBomLine[] {
  const opts: Required<ThreadAggregationOptions> = {
    collapseClasses: options.collapseClasses ?? false,
    collapseDirection: options.collapseDirection ?? false,
  };

  const byKey = new Map<string, ThreadBomLine & { _seriesIdx: number }>();

  // Stable series sort order for the output.
  const SERIES_ORDER: Record<ThreadSeries, number> = {
    ISO_M_COARSE: 0,
    ISO_M_FINE: 1,
    UNC: 2,
    UNF: 3,
    NPT: 4,
    BSP_PARALLEL: 5,
    BSP_TAPERED: 6,
  };

  for (const f of features) {
    const key = groupKey(f, opts);
    const row = findThreadRow(f.threadRef.series, f.threadRef.designation);
    const tapDrillMm = row ? row.tapDrill : null;

    let line = byKey.get(key);
    if (!line) {
      line = {
        _seriesIdx: SERIES_ORDER[f.threadRef.series] ?? 99,
        designation: f.threadRef.designation,
        series: f.threadRef.series,
        class: f.class,
        count: 0,
        totalLength: 0,
        tapDrillMm,
        classDistribution: {},
      };
      byKey.set(key, line);
    }

    line.count += 1;
    line.totalLength = +(line.totalLength + f.length).toFixed(4);

    // Per-class distribution.
    const dist = line.classDistribution as Record<string, number>;
    dist[f.class] = (dist[f.class] ?? 0) + 1;

    // Direction mix — track LH/RH within the group so the exporter can show
    // a mixed-direction warning even when not collapsing direction.
    const dir: 'right' | 'left' =
      f.threadDirection === 'left_hand' ? 'left' : 'right';
    if (!line.directionMix) line.directionMix = { right: 0, left: 0 };
    line.directionMix[dir] += 1;

    // Mode mix.
    const mode: 'cosmetic' | 'geometric' = f.mode === 'geometric' ? 'geometric' : 'cosmetic';
    if (!line.modeMix) line.modeMix = { cosmetic: 0, geometric: 0 };
    line.modeMix[mode] += 1;

    // Kind mix.
    const kind: 'internal' | 'external' = f.threadKind === 'external' ? 'external' : 'internal';
    if (!line.kindMix) line.kindMix = { internal: 0, external: 0 };
    line.kindMix[kind] += 1;
  }

  // Sort + strip the helper field.
  const rows = Array.from(byKey.values()).sort((a, b) => {
    if (a._seriesIdx !== b._seriesIdx) return a._seriesIdx - b._seriesIdx;
    return a.designation.localeCompare(b.designation);
  });

  return rows.map(({ _seriesIdx: _, ...row }) => {
    // Drop empty/trivial mixes — only keep the field when actually mixed.
    const out: ThreadBomLine = { ...row };
    if (out.directionMix && out.directionMix.left === 0) delete out.directionMix;
    if (out.modeMix && out.modeMix.geometric === 0) delete out.modeMix;
    if (out.kindMix && out.kindMix.external === 0) delete out.kindMix;
    return out;
  });
}

// ─── Formatting helpers (BOM block emission) ────────────────────────────────

/**
 * Format a `ThreadBomLine` array into a plain-text block per spec §12.3:
 *
 *   THREAD OPERATIONS
 *   ─────────────────
 *   M8 × 1.25  - 6H × 6   (tap drill Ø6.8)
 *   M10 × 1.5  - 6H × 2   (tap drill Ø8.5)
 *   1/4 NPT × 1           (tap drill Ø11.10)
 *
 * Pure function. The exporter (Phase 3) concatenates this with the
 * fastener / bearing block.
 */
export function formatThreadBomBlock(lines: readonly ThreadBomLine[]): string {
  if (lines.length === 0) return '';
  const header = 'THREAD OPERATIONS\n─────────────────';
  const body = lines.map(formatThreadBomRow).join('\n');
  return `${header}\n${body}`;
}

function formatThreadBomRow(line: ThreadBomLine): string {
  const desig = line.designation;
  // NPT / BSP rows omit the class suffix (the seal is in the taper) — match
  // the formatThreadCallout convention.
  const omitClass = line.series === 'NPT' || line.series === 'BSP_TAPERED';
  const classSuffix = omitClass ? '' : ` - ${line.class}`;
  const tapDrill = line.tapDrillMm !== null
    ? `  (tap drill Ø${line.tapDrillMm.toFixed(2)})`
    : '';
  return `${desig}${classSuffix} × ${line.count}${tapDrill}`;
}

/**
 * Compute the **unique tap-drill set** across all rolled-up lines. Used by
 * the manufacturing planner to populate the tool list.
 */
export function uniqueTapDrills(lines: readonly ThreadBomLine[]): number[] {
  const set = new Set<number>();
  for (const l of lines) {
    if (l.tapDrillMm !== null) set.add(l.tapDrillMm);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Compute the total tapping length across all rolled-up lines. Used as a
 * cost estimator input (cost ~= unit-rate × total mm tapped).
 */
export function totalTappingLengthMm(lines: readonly ThreadBomLine[]): number {
  let total = 0;
  for (const l of lines) total += l.totalLength;
  return +total.toFixed(4);
}
