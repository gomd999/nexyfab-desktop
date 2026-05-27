/**
 * lineWeightBiasDetector.ts — Detect inconsistent line-weight usage
 * on a drawing.
 *
 * ASME Y14.2 / ISO 128 prescribe a small set of line weights:
 *
 *   - Thin (≈ 0.25 mm): centerlines, hidden lines, dimensions.
 *   - Thick (≈ 0.5 mm): visible (continuous) outline, section lines.
 *   - Extra-thick (≈ 0.7 mm): cutting plane lines, breaks.
 *
 * Module:
 *   - Tallies line weights per type.
 *   - Flags lines that deviate from the standard weight for their type.
 *   - Identifies "bias": >80% of lines on one weight when standard
 *     calls for mixed.
 */

export type LineType = 'visible' | 'hidden' | 'centerline' | 'dimension' | 'section' | 'cutting-plane' | 'break' | 'phantom' | 'leader';

export interface DrawingLine {
  id: string;
  type: LineType;
  weightMm: number;
  /** Length on paper (for weighted statistics). */
  lengthMm: number;
}

export interface WeightExpectation {
  type: LineType;
  expectedMm: number;
  toleranceMm: number;
}

export const DEFAULT_EXPECTATIONS: WeightExpectation[] = [
  { type: 'visible', expectedMm: 0.5, toleranceMm: 0.05 },
  { type: 'hidden', expectedMm: 0.25, toleranceMm: 0.05 },
  { type: 'centerline', expectedMm: 0.25, toleranceMm: 0.05 },
  { type: 'dimension', expectedMm: 0.25, toleranceMm: 0.05 },
  { type: 'section', expectedMm: 0.25, toleranceMm: 0.05 },
  { type: 'cutting-plane', expectedMm: 0.7, toleranceMm: 0.1 },
  { type: 'break', expectedMm: 0.25, toleranceMm: 0.05 },
  { type: 'phantom', expectedMm: 0.25, toleranceMm: 0.05 },
  { type: 'leader', expectedMm: 0.25, toleranceMm: 0.05 },
];

export type Severity = 'critical' | 'warn' | 'info';

export interface LineIssue {
  lineId: string;
  type: LineType;
  actualMm: number;
  expectedMm: number;
  severity: Severity;
  message: string;
}

export interface BiasReport {
  /** Weighted by length. */
  dominantWeight: number;
  /** Percentage of lines at that weight. */
  dominantPct: number;
  /** Whether the drawing has only one weight (poor differentiation). */
  uniform: boolean;
}

export interface DetectorResult {
  issues: LineIssue[];
  countsByType: Record<LineType, number>;
  bias: BiasReport;
}

// ── Top-level entry ────────────────────────────────────────────

export function analyzeLines(lines: DrawingLine[], expectations: WeightExpectation[] = DEFAULT_EXPECTATIONS): DetectorResult {
  const expMap = new Map(expectations.map(e => [e.type, e]));
  const issues: LineIssue[] = [];
  const counts: Record<LineType, number> = {
    visible: 0, hidden: 0, centerline: 0, dimension: 0, section: 0,
    'cutting-plane': 0, break: 0, phantom: 0, leader: 0,
  };
  const weightHistogram = new Map<number, number>();
  let totalLength = 0;

  for (const line of lines) {
    counts[line.type]++;
    const bucket = Math.round(line.weightMm * 100) / 100;
    weightHistogram.set(bucket, (weightHistogram.get(bucket) ?? 0) + line.lengthMm);
    totalLength += line.lengthMm;

    const exp = expMap.get(line.type);
    if (exp) {
      const diff = Math.abs(line.weightMm - exp.expectedMm);
      if (diff > exp.toleranceMm) {
        const severity: Severity = diff > exp.toleranceMm * 2 ? 'critical' : 'warn';
        issues.push({
          lineId: line.id,
          type: line.type,
          actualMm: line.weightMm,
          expectedMm: exp.expectedMm,
          severity,
          message: `Line ${line.id} (${line.type}) weight ${line.weightMm.toFixed(2)} mm differs from expected ${exp.expectedMm} mm.`,
        });
      }
    }
  }

  // Bias detection.
  let dominantWeight = 0;
  let dominantLength = 0;
  for (const [w, l] of weightHistogram) {
    if (l > dominantLength) { dominantLength = l; dominantWeight = w; }
  }
  const dominantPct = totalLength === 0 ? 0 : (dominantLength / totalLength) * 100;
  const uniform = weightHistogram.size === 1 && lines.length > 1;

  return {
    issues,
    countsByType: counts,
    bias: { dominantWeight, dominantPct, uniform },
  };
}

// ── Severity rollup ──────────────────────────────────────────

export interface SeverityCounts {
  critical: number;
  warn: number;
  info: number;
}

export function rollupSeverity(result: DetectorResult): SeverityCounts {
  let c = 0, w = 0, i = 0;
  for (const issue of result.issues) {
    if (issue.severity === 'critical') c++;
    else if (issue.severity === 'warn') w++;
    else i++;
  }
  return { critical: c, warn: w, info: i };
}

// ── Suggest line-weight assignment ───────────────────────────

export interface LineFix {
  lineId: string;
  recommendedWeightMm: number;
}

export function suggestFixes(result: DetectorResult, expectations: WeightExpectation[] = DEFAULT_EXPECTATIONS): LineFix[] {
  const expMap = new Map(expectations.map(e => [e.type, e]));
  return result.issues.map(i => {
    const e = expMap.get(i.type);
    return { lineId: i.lineId, recommendedWeightMm: e?.expectedMm ?? i.expectedMm };
  });
}

// ── Summary ────────────────────────────────────────────────────

export interface DetectorSummary {
  lineCount: number;
  issueCount: number;
  criticalCount: number;
  dominantWeight: number;
  uniform: boolean;
}

export function summarize(lines: DrawingLine[], result: DetectorResult): DetectorSummary {
  const rollup = rollupSeverity(result);
  return {
    lineCount: lines.length,
    issueCount: result.issues.length,
    criticalCount: rollup.critical,
    dominantWeight: result.bias.dominantWeight,
    uniform: result.bias.uniform,
  };
}
