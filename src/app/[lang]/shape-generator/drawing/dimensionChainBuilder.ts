/**
 * dimensionChainBuilder.ts — Build chain dimensions that share
 * extension lines.
 *
 * A chain dimension is a row of consecutive dimensions where each
 * extension line is shared between two neighbors (think `|10|20|15|`
 * style ruler at the bottom of a drawing). They're space-efficient
 * and prevent dimension-line clutter.
 *
 * Module accepts a sequence of feature positions + dimension values
 * along an axis, and produces:
 *
 *   - Shared extension line positions.
 *   - Per-dimension placement (start, end, text position).
 *   - Cumulative dimension from origin (sum check).
 *   - Optional "running" dimension showing distance-from-origin.
 */

export interface Vec2 { x: number; y: number }

export interface ChainFeature {
  id: string;
  /** Position along the chain axis (mm from start). */
  position: number;
  /** Label override (default = numeric dimension). */
  label?: string;
}

export interface ChainDimension {
  /** id pair: from-feature → to-feature. */
  fromId: string;
  toId: string;
  /** Dimension value (mm). */
  value: number;
  /** Center position along chain axis. */
  centerOffset: number;
  /** Label text. */
  label: string;
}

export interface ChainResult {
  dimensions: ChainDimension[];
  /** Extension line offsets along the axis. */
  extensionOffsets: number[];
  /** Cumulative position checked against final feature. */
  cumulativeLength: number;
  /** Per-feature running-dimension (distance from first feature). */
  runningDimensions: Array<{ id: string; runningMm: number }>;
}

export interface ChainOptions {
  /** Show running dimension. */
  includeRunningDimensions: boolean;
  /** Round display values to N decimals. */
  decimals: number;
  /** Min gap between consecutive features to consider non-overlapping. */
  minGapMm: number;
}

export const DEFAULT_OPTIONS: ChainOptions = {
  includeRunningDimensions: true,
  decimals: 1,
  minGapMm: 0.01,
};

// ── Top-level entry ────────────────────────────────────────────

export function buildDimensionChain(features: ChainFeature[], options: Partial<ChainOptions> = {}): ChainResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (features.length < 2) {
    return { dimensions: [], extensionOffsets: [], cumulativeLength: 0, runningDimensions: [] };
  }

  const sorted = [...features].sort((a, b) => a.position - b.position);
  const dimensions: ChainDimension[] = [];
  const extensionOffsets = sorted.map(f => f.position);
  const running: Array<{ id: string; runningMm: number }> = [];
  const origin = sorted[0]!.position;

  for (const f of sorted) {
    running.push({ id: f.id, runningMm: f.position - origin });
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    const value = b.position - a.position;
    if (value < opts.minGapMm) continue;
    const center = (a.position + b.position) / 2;
    const label = a.label ?? roundToDecimals(value, opts.decimals).toString();
    dimensions.push({
      fromId: a.id,
      toId: b.id,
      value,
      centerOffset: center,
      label,
    });
  }

  return {
    dimensions,
    extensionOffsets,
    cumulativeLength: sorted[sorted.length - 1]!.position - origin,
    runningDimensions: opts.includeRunningDimensions ? running : [],
  };
}

// ── Helpers ────────────────────────────────────────────────────

function roundToDecimals(value: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(value * m) / m;
}

// ── Validation ────────────────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  issues: string[];
  sumMm: number;
  expectedMm: number;
}

export function validateChain(result: ChainResult): ValidationResult {
  const issues: string[] = [];
  const sum = result.dimensions.reduce((s, d) => s + d.value, 0);
  if (Math.abs(sum - result.cumulativeLength) > 0.01) {
    issues.push(`Sum mismatch: ${sum.toFixed(3)} vs ${result.cumulativeLength.toFixed(3)}`);
  }
  for (let i = 1; i < result.dimensions.length; i++) {
    if (result.dimensions[i]!.fromId !== result.dimensions[i - 1]!.toId) {
      issues.push(`Chain broken between ${result.dimensions[i - 1]!.toId} and ${result.dimensions[i]!.fromId}`);
    }
  }
  return {
    isValid: issues.length === 0,
    issues,
    sumMm: sum,
    expectedMm: result.cumulativeLength,
  };
}

// ── Conversion to baseline dimensions ─────────────────────────

/** Convert a chain to baseline (origin-referenced) dimensions for comparison. */
export interface BaselineDimension {
  fromOriginId: string;
  toId: string;
  value: number;
}

export function chainToBaseline(features: ChainFeature[]): BaselineDimension[] {
  if (features.length < 2) return [];
  const sorted = [...features].sort((a, b) => a.position - b.position);
  const origin = sorted[0]!;
  const out: BaselineDimension[] = [];
  for (let i = 1; i < sorted.length; i++) {
    out.push({
      fromOriginId: origin.id,
      toId: sorted[i]!.id,
      value: sorted[i]!.position - origin.position,
    });
  }
  return out;
}

// ── Summary ────────────────────────────────────────────────────

export interface ChainSummary {
  dimensionCount: number;
  totalLengthMm: number;
  minDimensionMm: number;
  maxDimensionMm: number;
  averageDimensionMm: number;
}

export function summarize(result: ChainResult): ChainSummary {
  if (result.dimensions.length === 0) {
    return { dimensionCount: 0, totalLengthMm: 0, minDimensionMm: 0, maxDimensionMm: 0, averageDimensionMm: 0 };
  }
  const values = result.dimensions.map(d => d.value);
  const sum = values.reduce((s, v) => s + v, 0);
  return {
    dimensionCount: result.dimensions.length,
    totalLengthMm: result.cumulativeLength,
    minDimensionMm: Math.min(...values),
    maxDimensionMm: Math.max(...values),
    averageDimensionMm: sum / values.length,
  };
}
