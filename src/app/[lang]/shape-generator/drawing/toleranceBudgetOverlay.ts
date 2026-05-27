/**
 * toleranceBudgetOverlay.ts — Compute drawable annotation overlay
 * showing how much tolerance budget each dimension consumes.
 *
 * For each dimension on the drawing, the overlay shows:
 *
 *   - Tolerance allocated (mm).
 *   - Contribution to a stack (mm or %).
 *   - Colour code: green = abundant, yellow = tight, red = critical.
 *   - Optional bar gauge next to the dimension.
 *
 * Inputs:
 *
 *   - dimension list with their assigned tolerances.
 *   - stack analysis result (per-dimension sensitivity + contribution).
 *
 * The module emits annotation positions + style info that the drawing
 * renderer paints.
 */

export interface Vec2 { x: number; y: number }

export interface DimensionTol {
  dimensionId: string;
  /** Position of the dimension's text on the drawing. */
  textPosition: Vec2;
  /** Plus tolerance (mm). */
  plusMm: number;
  /** Minus tolerance (mm). */
  minusMm: number;
  /** Sensitivity (∂Y/∂X). */
  sensitivity: number;
}

export interface StackBudget {
  /** Total tolerance window (mm). */
  totalBudgetMm: number;
  /** Worst-case sum of per-dimension contributions. */
  consumedMm: number;
}

export type BudgetColour = 'green' | 'yellow' | 'red';

export interface DimensionOverlay {
  dimensionId: string;
  /** Anchor for the overlay annotation. */
  anchor: Vec2;
  /** Bar width to render proportional to contribution. */
  barWidthMm: number;
  /** Fraction of stack budget consumed (0-1+). */
  budgetFraction: number;
  /** Colour code based on fraction. */
  colour: BudgetColour;
  /** Display text. */
  text: string;
}

export interface OverlayOptions {
  /** Pixel offset for annotation relative to dim text. */
  annotationOffsetMm: number;
  /** Maximum bar width (mm). */
  maxBarWidthMm: number;
  /** Fraction threshold for yellow / red. */
  yellowThreshold: number;
  redThreshold: number;
}

export const DEFAULT_OPTIONS: OverlayOptions = {
  annotationOffsetMm: 5,
  maxBarWidthMm: 30,
  yellowThreshold: 0.5,
  redThreshold: 0.8,
};

// ── Top-level entry ────────────────────────────────────────────

export function buildOverlay(
  dimensions: DimensionTol[],
  stack: StackBudget,
  options: Partial<OverlayOptions> = {},
): DimensionOverlay[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (stack.totalBudgetMm <= 0) {
    return dimensions.map(d => ({
      dimensionId: d.dimensionId,
      anchor: offsetAnchor(d.textPosition, opts.annotationOffsetMm),
      barWidthMm: 0,
      budgetFraction: 0,
      colour: 'green',
      text: `±${formatTol(d)}`,
    }));
  }
  return dimensions.map(d => {
    const contrib = Math.abs(d.sensitivity) * (d.plusMm + d.minusMm);
    const fraction = contrib / stack.totalBudgetMm;
    const colour: BudgetColour = fraction >= opts.redThreshold ? 'red' : fraction >= opts.yellowThreshold ? 'yellow' : 'green';
    return {
      dimensionId: d.dimensionId,
      anchor: offsetAnchor(d.textPosition, opts.annotationOffsetMm),
      barWidthMm: Math.min(opts.maxBarWidthMm, fraction * opts.maxBarWidthMm),
      budgetFraction: fraction,
      colour,
      text: `${(fraction * 100).toFixed(0)}% · ±${formatTol(d)}`,
    };
  });
}

function offsetAnchor(p: Vec2, off: number): Vec2 {
  return { x: p.x + off, y: p.y + off };
}

function formatTol(d: DimensionTol): string {
  if (d.plusMm === d.minusMm) return d.plusMm.toFixed(3);
  return `+${d.plusMm.toFixed(3)} / −${d.minusMm.toFixed(3)}`;
}

// ── Aggregate stats ──────────────────────────────────────────

export interface OverlayStats {
  total: number;
  greenCount: number;
  yellowCount: number;
  redCount: number;
  worstFraction: number;
}

export function aggregate(overlays: DimensionOverlay[]): OverlayStats {
  let g = 0, y = 0, r = 0, worst = 0;
  for (const o of overlays) {
    if (o.colour === 'green') g++;
    else if (o.colour === 'yellow') y++;
    else r++;
    if (o.budgetFraction > worst) worst = o.budgetFraction;
  }
  return {
    total: overlays.length,
    greenCount: g,
    yellowCount: y,
    redCount: r,
    worstFraction: worst,
  };
}

// ── Highlight top consumers ──────────────────────────────────

export function topConsumers(overlays: DimensionOverlay[], n: number = 5): DimensionOverlay[] {
  return overlays.slice().sort((a, b) => b.budgetFraction - a.budgetFraction).slice(0, n);
}

// ── Summary ────────────────────────────────────────────────────

export interface OverlaySummary {
  dimensionCount: number;
  redCount: number;
  yellowCount: number;
  worstFraction: number;
}

export function summarize(overlays: DimensionOverlay[]): OverlaySummary {
  const agg = aggregate(overlays);
  return {
    dimensionCount: agg.total,
    redCount: agg.redCount,
    yellowCount: agg.yellowCount,
    worstFraction: agg.worstFraction,
  };
}
