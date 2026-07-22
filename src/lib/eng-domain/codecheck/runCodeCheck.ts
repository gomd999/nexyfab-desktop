/**
 * eng-domain/codecheck/runCodeCheck.ts — run the deterministic 코드체크 룰셋over measured features.
 *
 * runCodeCheck(features) → { results[], passCount, failCount, naCount, disclaimer }.
 * Pure/deterministic. NA when a feature is absent (never assume compliance). The
 * disclaimer (non-statutory 감리 보조) is ALWAYS returned so callers cannot drop it.
 *
 * FEATURE PROVENANCE (정직한 매핑):
 *  - Most fields are USER-supplied measured features (which dimension is the stall
 *    width is a semantic label the drawing does not carry by itself).
 *  - `collectMeasurementsFromIr2d` REUSES what the DWG-2D IR (src/lib/cad-ir) already
 *    measures — extents + dimension values + circle diameters — and surfaces them as a
 *    candidate POOL (in metres when units are known). It does NOT auto-assign them to a
 *    semantic slot; that would be a guess and violates the honesty contract.
 */

import {
  CODECHECK_RULES,
  CODECHECK_DISCLAIMER,
  type CodeCheckFeatures,
  type RuleResult,
} from './rules';

export interface CodeCheckReport {
  results: RuleResult[];
  passCount: number;
  failCount: number;
  naCount: number;
  /** convenience: only the FAIL results (violations to surface first) */
  violations: RuleResult[];
  disclaimer: string;
}

/**
 * Run every rule against the measured features. Deterministic: rule order is stable,
 * every rule contributes exactly one result (pass/fail/na).
 */
export function runCodeCheck(features: CodeCheckFeatures): CodeCheckReport {
  const results = CODECHECK_RULES.map((r) => r.check(features));
  let passCount = 0;
  let failCount = 0;
  let naCount = 0;
  const violations: RuleResult[] = [];
  for (const res of results) {
    if (res.status === 'pass') passCount++;
    else if (res.status === 'fail') {
      failCount++;
      violations.push(res);
    } else naCount++;
  }
  return { results, passCount, failCount, naCount, violations, disclaimer: CODECHECK_DISCLAIMER };
}

// ── DWG-2D IR measurement pool (reuse of what we already measure) ─────────────
/** Minimal shape of the Ir2d fields we read (see src/lib/cad-ir/schema2d). */
export interface Ir2dLike {
  units?: 'mm' | 'in' | null;
  extents?: { w: number; h: number } | null;
  dimensions?: Array<{ value: number; text?: string }>;
  circles?: Array<{ r: number }>;
}

export interface MeasurementCandidate {
  /** source of the raw measurement */
  kind: 'extent' | 'dimension' | 'circle-dia';
  /** raw value in the drawing's native unit */
  rawValue: number;
  /** native unit as declared by the IR ('mm'|'in'|'unknown') */
  rawUnit: string;
  /** value in metres iff units are known (mm/in); null when undeclared (never guessed) */
  meters: number | null;
  /** optional dimension text for traceability */
  label?: string;
}

/**
 * Surface the raw measurement pool the DWG-2D IR already carries, converted to metres
 * ONLY when the drawing declared its units. Undeclared units → meters:null (honesty
 * invariant: we never guess mm). This is a PICKLIST for the user to assign to semantic
 * feature slots — it deliberately does NOT map to CodeCheckFeatures automatically.
 */
export function collectMeasurementsFromIr2d(ir: Ir2dLike): MeasurementCandidate[] {
  const toMeters = (v: number): number | null => {
    if (ir.units === 'mm') return v / 1000;
    if (ir.units === 'in') return (v * 25.4) / 1000;
    return null;
  };
  const unit = ir.units ?? 'unknown';
  const out: MeasurementCandidate[] = [];
  if (ir.extents && Number.isFinite(ir.extents.w) && ir.extents.w > 0) {
    out.push({ kind: 'extent', rawValue: ir.extents.w, rawUnit: unit, meters: toMeters(ir.extents.w), label: 'extent.w' });
  }
  if (ir.extents && Number.isFinite(ir.extents.h) && ir.extents.h > 0) {
    out.push({ kind: 'extent', rawValue: ir.extents.h, rawUnit: unit, meters: toMeters(ir.extents.h), label: 'extent.h' });
  }
  for (const d of ir.dimensions ?? []) {
    if (Number.isFinite(d.value) && d.value > 0) {
      out.push({ kind: 'dimension', rawValue: d.value, rawUnit: unit, meters: toMeters(d.value), label: d.text || undefined });
    }
  }
  for (const c of ir.circles ?? []) {
    if (Number.isFinite(c.r) && c.r > 0) {
      out.push({ kind: 'circle-dia', rawValue: c.r * 2, rawUnit: unit, meters: toMeters(c.r * 2), label: `dia ${c.r * 2}` });
    }
  }
  return out;
}
