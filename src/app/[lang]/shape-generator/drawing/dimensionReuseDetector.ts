/**
 * dimensionReuseDetector.ts — Detect dimensions repeated across views
 * on the same drawing.
 *
 * Drafting standards (ASME Y14.5, ISO 129) discourage repeating the
 * same dimension across multiple views — it inflates the drawing,
 * creates ambiguity, and breaks single-source-of-truth.
 *
 * Examples to detect:
 *
 *   - Same nominal value + tolerance on the same feature in 2+ views.
 *   - Same feature dimensioned twice on one view via different
 *     dimension lines (chained vs ordinate).
 *   - Implicit duplication: "Ø10" called out in front view AND as
 *     part of a hole table.
 *
 * Module:
 *   - Groups dimensions by (featureId + nominal + tolerance).
 *   - Flags groups with > 1 entry as reuse violations.
 *   - Suggests which dimension to keep (rule: keep the one with the
 *     most descriptive view = "primary view").
 */

export interface Dimension {
  id: string;
  /** ID of the geometric feature being dimensioned. */
  featureId: string;
  /** Nominal value (mm or degrees). */
  nominal: number;
  /** Tolerance plus, minus (mm). */
  tolerancePlus: number;
  toleranceMinus: number;
  /** View this dimension is placed on. */
  viewId: string;
  /** Is this view the "primary" view (front/main)? */
  isPrimaryView: boolean;
  /** Type. */
  kind: 'linear' | 'diameter' | 'radius' | 'angular' | 'arc-length' | 'reference';
}

export interface ReuseGroup {
  featureId: string;
  nominal: number;
  tolerance: [number, number];
  dimensions: Dimension[];
  /** ID of the dimension recommended to keep. */
  recommendedKeep: string;
  /** IDs of dimensions recommended to delete. */
  recommendedDelete: string[];
}

export interface DetectionResult {
  groups: ReuseGroup[];
  totalDimensions: number;
  /** Total flagged duplicates. */
  duplicateCount: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function detectDuplicates(dimensions: Dimension[]): DetectionResult {
  const grouped = new Map<string, Dimension[]>();
  for (const dim of dimensions) {
    const key = makeKey(dim);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(dim);
  }
  const groups: ReuseGroup[] = [];
  let duplicates = 0;
  for (const [, dims] of grouped) {
    if (dims.length < 2) continue;
    duplicates += dims.length - 1;
    const keep = pickRecommendedKeep(dims);
    const del = dims.filter(d => d.id !== keep.id).map(d => d.id);
    const first = dims[0]!;
    groups.push({
      featureId: first.featureId,
      nominal: first.nominal,
      tolerance: [first.tolerancePlus, first.toleranceMinus],
      dimensions: dims,
      recommendedKeep: keep.id,
      recommendedDelete: del,
    });
  }
  return { groups, totalDimensions: dimensions.length, duplicateCount: duplicates };
}

function makeKey(d: Dimension): string {
  return `${d.featureId}::${d.nominal.toFixed(4)}::${d.tolerancePlus.toFixed(4)}/${d.toleranceMinus.toFixed(4)}`;
}

function pickRecommendedKeep(dims: Dimension[]): Dimension {
  // Prefer primary view, then non-reference, then first by id.
  const primary = dims.find(d => d.isPrimaryView);
  if (primary) return primary;
  const nonRef = dims.find(d => d.kind !== 'reference');
  if (nonRef) return nonRef;
  return dims[0]!;
}

// ── Reference dimension classifier ─────────────────────────────

/**
 * A reference dimension (in parentheses) is technically a duplicate
 * but is allowed by the standard. This filter splits the groups by
 * whether they are pure reference dups or hard duplicates.
 */
export function splitByReference(result: DetectionResult): {
  hardDuplicates: ReuseGroup[];
  referenceOnly: ReuseGroup[];
} {
  const hard: ReuseGroup[] = [];
  const refOnly: ReuseGroup[] = [];
  for (const g of result.groups) {
    if (g.dimensions.every(d => d.kind === 'reference')) refOnly.push(g);
    else hard.push(g);
  }
  return { hardDuplicates: hard, referenceOnly: refOnly };
}

// ── Severity scoring ──────────────────────────────────────────

export interface SeverityRow {
  group: ReuseGroup;
  severity: 'critical' | 'warn' | 'info';
  reason: string;
}

export function classifySeverity(result: DetectionResult): SeverityRow[] {
  return result.groups.map(g => {
    if (g.dimensions.length >= 3) {
      return { group: g, severity: 'critical' as const, reason: `Feature ${g.featureId} dimensioned ${g.dimensions.length} times.` };
    }
    const tolerances = new Set(g.dimensions.map(d => `${d.tolerancePlus}/${d.toleranceMinus}`));
    if (tolerances.size > 1) {
      return { group: g, severity: 'critical' as const, reason: `Same feature with different tolerances across views.` };
    }
    return { group: g, severity: 'warn' as const, reason: 'Same feature dimensioned twice.' };
  });
}

// ── Summary ────────────────────────────────────────────────────

export interface ReuseSummary {
  totalDimensions: number;
  groupCount: number;
  duplicateCount: number;
  criticalCount: number;
}

export function summarize(result: DetectionResult): ReuseSummary {
  const severities = classifySeverity(result);
  const critical = severities.filter(s => s.severity === 'critical').length;
  return {
    totalDimensions: result.totalDimensions,
    groupCount: result.groups.length,
    duplicateCount: result.duplicateCount,
    criticalCount: critical,
  };
}
