/**
 * referenceDimension.ts — Mark drawing dimensions as "reference"
 * (parenthesized, non-controlling) and validate against the
 * controlling dimension chain.
 *
 * Per ASME Y14.5: a reference dimension is shown in parentheses
 * to indicate it is for *information only* — it duplicates a value
 * the part already enforces through other dimensions and is not
 * inspected directly.
 *
 * The rules:
 *
 *   - A reference dimension must equal the sum/derivation of
 *     controlling dimensions (within tolerance).
 *   - Reference dimensions never carry a tolerance.
 *   - On a drawing, they appear with parentheses.
 *
 * Module:
 *
 *   - Tag a dimension as reference.
 *   - Validate references against controlling chain.
 *   - Format display strings.
 */

export interface Dimension {
  id: string;
  /** Numeric nominal value, mm. */
  nominalMm: number;
  /** Is this a reference (parenthesized) dimension? */
  isReference?: boolean;
  /** Optional formula referencing other dimension ids: { id: weight } */
  derivedFrom?: Record<string, number>;
  /** Tolerance (only valid for non-reference dimensions). */
  tolerance?: { plus: number; minus: number };
}

export interface ValidationIssue {
  dimensionId: string;
  expected: number;
  actual: number;
  delta: number;
  reason: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface FormatOptions {
  /** Tolerance display: include parentheses around reference dims. */
  showParentheses: boolean;
  /** Decimal precision. */
  decimals: number;
  /** Show unit suffix. */
  unitSuffix: string;
}

export const DEFAULT_FORMAT: FormatOptions = {
  showParentheses: true,
  decimals: 2,
  unitSuffix: '',
};

// ── Tagging ────────────────────────────────────────────────────

export function markAsReference(dim: Dimension): Dimension {
  return { ...dim, isReference: true, tolerance: undefined };
}

export function unmarkReference(dim: Dimension): Dimension {
  return { ...dim, isReference: false };
}

// ── Validation ────────────────────────────────────────────────

export function validateReferences(dimensions: Dimension[], toleranceMm: number = 0.01): ValidationResult {
  const map = new Map<string, Dimension>();
  for (const d of dimensions) map.set(d.id, d);
  const issues: ValidationIssue[] = [];

  for (const dim of dimensions) {
    if (!dim.isReference) {
      if (dim.tolerance) continue;
      continue;
    }
    if (dim.tolerance) {
      issues.push({
        dimensionId: dim.id,
        expected: dim.nominalMm,
        actual: dim.nominalMm,
        delta: 0,
        reason: 'Reference dimension cannot have tolerance.',
      });
    }
    if (dim.derivedFrom) {
      let computed = 0;
      let allFound = true;
      for (const [refId, weight] of Object.entries(dim.derivedFrom)) {
        const referenced = map.get(refId);
        if (!referenced) {
          issues.push({
            dimensionId: dim.id,
            expected: 0,
            actual: dim.nominalMm,
            delta: 0,
            reason: `Referenced dimension ${refId} not found.`,
          });
          allFound = false;
          break;
        }
        computed += referenced.nominalMm * weight;
      }
      if (allFound && Math.abs(computed - dim.nominalMm) > toleranceMm) {
        issues.push({
          dimensionId: dim.id,
          expected: computed,
          actual: dim.nominalMm,
          delta: dim.nominalMm - computed,
          reason: `Reference value differs from derived (${computed.toFixed(3)} vs ${dim.nominalMm.toFixed(3)}).`,
        });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

// ── Formatting ────────────────────────────────────────────────

export function formatDimension(dim: Dimension, opts: Partial<FormatOptions> = {}): string {
  const o = { ...DEFAULT_FORMAT, ...opts };
  const value = dim.nominalMm.toFixed(o.decimals);
  const tol = dim.tolerance ? ` ±${Math.max(Math.abs(dim.tolerance.plus), Math.abs(dim.tolerance.minus)).toFixed(o.decimals)}` : '';
  const unit = o.unitSuffix ? ` ${o.unitSuffix}` : '';
  const base = `${value}${unit}${tol}`;
  if (dim.isReference && o.showParentheses) {
    return `(${base})`;
  }
  return base;
}

// ── Bulk operations ──────────────────────────────────────────

export interface DerivationGraph {
  /** id → ids that derive from it. */
  dependents: Map<string, Set<string>>;
  /** id → ids it depends on. */
  dependencies: Map<string, Set<string>>;
}

export function buildDerivationGraph(dimensions: Dimension[]): DerivationGraph {
  const dependents = new Map<string, Set<string>>();
  const dependencies = new Map<string, Set<string>>();
  for (const d of dimensions) {
    if (!d.derivedFrom) continue;
    dependencies.set(d.id, new Set(Object.keys(d.derivedFrom)));
    for (const refId of Object.keys(d.derivedFrom)) {
      const set = dependents.get(refId) ?? new Set();
      set.add(d.id);
      dependents.set(refId, set);
    }
  }
  return { dependents, dependencies };
}

// ── Summary ────────────────────────────────────────────────────

export interface ReferenceSummary {
  totalDimensions: number;
  referenceCount: number;
  controllingCount: number;
  brokenReferenceCount: number;
  hasInvalidReferences: boolean;
}

export function summarize(dimensions: Dimension[], validation: ValidationResult): ReferenceSummary {
  const refs = dimensions.filter(d => d.isReference).length;
  return {
    totalDimensions: dimensions.length,
    referenceCount: refs,
    controllingCount: dimensions.length - refs,
    brokenReferenceCount: validation.issues.length,
    hasInvalidReferences: !validation.valid,
  };
}
