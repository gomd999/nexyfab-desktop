/**
 * dimensionOverrideList.ts — Track dimension value/text overrides on
 * a drawing and validate them against the model.
 *
 * Drafters sometimes override the computed dimension value (e.g., to
 * round 9.987 to 10.00) or replace the dim text with a custom string
 * ("Match drilled hole"). Audit module:
 *
 *   - Detects every override (value, prefix, suffix, tolerance, text).
 *   - Flags overrides that diverge from the model by > tolerance.
 *   - Suggests removing pointless overrides (where value matches
 *     model already).
 */

export type OverrideKind = 'value' | 'prefix' | 'suffix' | 'tolerance' | 'text-replacement';

export interface DimensionOverride {
  dimensionId: string;
  modelNominal: number;
  overrideValue?: number;
  overridePrefix?: string;
  overrideSuffix?: string;
  overrideTolerancePlus?: number;
  overrideToleranceMinus?: number;
  /** Free-text replacement (overrides numeric display entirely). */
  overrideText?: string;
  modelTolerancePlus?: number;
  modelToleranceMinus?: number;
}

export interface AuditOptions {
  /** Maximum allowable mismatch between override and model. */
  valueToleranceMm: number;
  /** Whether to flag pointless overrides (override = model). */
  flagPointless: boolean;
}

export const DEFAULT_OPTIONS: AuditOptions = {
  valueToleranceMm: 0.001,
  flagPointless: true,
};

export type Severity = 'critical' | 'warn' | 'info';

export interface OverrideIssue {
  dimensionId: string;
  kind: OverrideKind;
  severity: Severity;
  message: string;
}

export interface AuditResult {
  issues: OverrideIssue[];
  overrideCount: number;
  divergenceCount: number;
  pointlessCount: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function auditOverrides(overrides: DimensionOverride[], options: Partial<AuditOptions> = {}): AuditResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const issues: OverrideIssue[] = [];
  let divergence = 0;
  let pointless = 0;
  let overrideCount = 0;

  for (const dim of overrides) {
    let hasOverride = false;

    if (dim.overrideValue !== undefined) {
      hasOverride = true;
      const diff = Math.abs(dim.overrideValue - dim.modelNominal);
      if (diff > opts.valueToleranceMm) {
        divergence++;
        issues.push({
          dimensionId: dim.dimensionId,
          kind: 'value',
          severity: 'critical',
          message: `Override value ${dim.overrideValue} differs from model ${dim.modelNominal} by ${diff.toFixed(4)} mm.`,
        });
      } else if (opts.flagPointless && diff < opts.valueToleranceMm / 10) {
        pointless++;
        issues.push({
          dimensionId: dim.dimensionId,
          kind: 'value',
          severity: 'info',
          message: `Override value matches model; consider removing.`,
        });
      }
    }

    if (dim.overridePrefix !== undefined) {
      hasOverride = true;
      issues.push({
        dimensionId: dim.dimensionId,
        kind: 'prefix',
        severity: 'info',
        message: `Custom prefix "${dim.overridePrefix}" applied.`,
      });
    }

    if (dim.overrideSuffix !== undefined) {
      hasOverride = true;
      issues.push({
        dimensionId: dim.dimensionId,
        kind: 'suffix',
        severity: 'info',
        message: `Custom suffix "${dim.overrideSuffix}" applied.`,
      });
    }

    if (dim.overrideTolerancePlus !== undefined || dim.overrideToleranceMinus !== undefined) {
      hasOverride = true;
      const plusDelta = Math.abs((dim.overrideTolerancePlus ?? dim.modelTolerancePlus ?? 0) - (dim.modelTolerancePlus ?? 0));
      const minusDelta = Math.abs((dim.overrideToleranceMinus ?? dim.modelToleranceMinus ?? 0) - (dim.modelToleranceMinus ?? 0));
      if (plusDelta > opts.valueToleranceMm || minusDelta > opts.valueToleranceMm) {
        divergence++;
        issues.push({
          dimensionId: dim.dimensionId,
          kind: 'tolerance',
          severity: 'warn',
          message: `Tolerance override differs from model.`,
        });
      }
    }

    if (dim.overrideText !== undefined) {
      hasOverride = true;
      issues.push({
        dimensionId: dim.dimensionId,
        kind: 'text-replacement',
        severity: 'warn',
        message: `Text replacement "${dim.overrideText}" — dimension does not show numeric value.`,
      });
    }

    if (hasOverride) overrideCount++;
  }

  return { issues, overrideCount, divergenceCount: divergence, pointlessCount: pointless };
}

// ── Strip pointless overrides ────────────────────────────────

export function stripPointless(overrides: DimensionOverride[], options: Partial<AuditOptions> = {}): DimensionOverride[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return overrides.map(d => {
    const copy = { ...d };
    if (copy.overrideValue !== undefined && Math.abs(copy.overrideValue - copy.modelNominal) < opts.valueToleranceMm / 10) {
      delete copy.overrideValue;
    }
    return copy;
  });
}

// ── Severity rollup ──────────────────────────────────────────

export interface SeverityRollup {
  criticalCount: number;
  warnCount: number;
  infoCount: number;
}

export function rollupSeverity(result: AuditResult): SeverityRollup {
  let crit = 0, warn = 0, info = 0;
  for (const i of result.issues) {
    if (i.severity === 'critical') crit++;
    else if (i.severity === 'warn') warn++;
    else info++;
  }
  return { criticalCount: crit, warnCount: warn, infoCount: info };
}

// ── Summary ────────────────────────────────────────────────────

export interface AuditSummary {
  overrideCount: number;
  divergenceCount: number;
  pointlessCount: number;
  criticalIssues: number;
}

export function summarize(result: AuditResult): AuditSummary {
  const rollup = rollupSeverity(result);
  return {
    overrideCount: result.overrideCount,
    divergenceCount: result.divergenceCount,
    pointlessCount: result.pointlessCount,
    criticalIssues: rollup.criticalCount,
  };
}
