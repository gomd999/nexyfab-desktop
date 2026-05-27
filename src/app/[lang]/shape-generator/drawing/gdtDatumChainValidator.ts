/**
 * gdtDatumChainValidator.ts — Validate GD&T datum reference frame
 * chains per ASME Y14.5-2018.
 *
 * Each Feature Control Frame (FCF) lists 1-3 datum references in
 * order (primary, secondary, tertiary). Constraints:
 *
 *   1. Datum letters must reference existing datum features.
 *   2. Each FCF can only use the same letter once.
 *   3. Primary alone constrains 3 DOF; primary+secondary 5; full 6.
 *   4. Datum features should be ordered by function (mating priority).
 *   5. Material modifier (Ⓜ Ⓛ) only valid on regular features of size.
 *
 * The validator returns issues with severity and remediation hints.
 */

export type DatumLetter = string;

export interface DatumFeature {
  letter: DatumLetter;
  /** Feature type: plane, axis, point. */
  featureType: 'plane' | 'axis' | 'point' | 'feature-of-size';
  /** Whether the datum has been declared on the drawing. */
  declared: boolean;
}

export type MaterialModifier = 'MMC' | 'LMC' | 'RFS' | undefined;

export interface FeatureControlFrame {
  id: string;
  symbol: string;          // e.g., position, perpendicularity
  toleranceMm: number;
  datums: { letter: DatumLetter; modifier?: MaterialModifier }[];
  /** Whether this FCF is on a feature of size. */
  appliedToFOS: boolean;
}

export interface ValidationIssue {
  fcfId: string;
  severity: 'error' | 'warn';
  message: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  /** DOF constrained for each FCF (3, 5, or 6). */
  dofPerFcf: Record<string, number>;
  /** Whether full reference frame established for each FCF. */
  fullFramePerFcf: Record<string, boolean>;
}

// ── Top-level entry ────────────────────────────────────────────

export function validateDatumChains(
  datums: DatumFeature[],
  fcfs: FeatureControlFrame[],
): ValidationResult {
  const datumMap = new Map(datums.map(d => [d.letter, d]));
  const issues: ValidationIssue[] = [];
  const dofPerFcf: Record<string, number> = {};
  const fullPerFcf: Record<string, boolean> = {};

  for (const fcf of fcfs) {
    let dof = 0;
    const seen = new Set<DatumLetter>();
    for (let i = 0; i < fcf.datums.length; i++) {
      const ref = fcf.datums[i]!;
      const letter = ref.letter;

      // Rule 1 + duplicate check.
      if (seen.has(letter)) {
        issues.push({
          fcfId: fcf.id,
          severity: 'error',
          message: `Datum letter ${letter} used twice in same FCF.`,
        });
        continue;
      }
      seen.add(letter);

      const datum = datumMap.get(letter);
      if (!datum || !datum.declared) {
        issues.push({
          fcfId: fcf.id,
          severity: 'error',
          message: `Datum ${letter} referenced but not declared on drawing.`,
        });
        continue;
      }

      // Material modifier valid only on RFOS.
      if (ref.modifier && ref.modifier !== 'RFS' && datum.featureType !== 'feature-of-size') {
        issues.push({
          fcfId: fcf.id,
          severity: 'error',
          message: `Material modifier ${ref.modifier} on datum ${letter} invalid: ${letter} is not a feature of size.`,
        });
      }

      // DOF accumulation: primary = 3, secondary = 2 more, tertiary = 1 more.
      if (i === 0) dof += 3;
      else if (i === 1) dof += 2;
      else if (i === 2) dof += 1;
    }
    dofPerFcf[fcf.id] = dof;
    fullPerFcf[fcf.id] = dof === 6;

    // Warn if position tolerance on FOS without enough constraint.
    if (fcf.symbol === 'position' && dof < 6) {
      issues.push({
        fcfId: fcf.id,
        severity: 'warn',
        message: `Position tolerance with only ${dof} DOF constrained; add secondary/tertiary datums for full reference frame.`,
      });
    }
  }

  return { issues, dofPerFcf, fullFramePerFcf: fullPerFcf };
}

// ── Datum usage frequency ─────────────────────────────────────

export interface DatumUsage {
  letter: DatumLetter;
  asPrimary: number;
  asSecondary: number;
  asTertiary: number;
  total: number;
}

export function datumUsage(datums: DatumFeature[], fcfs: FeatureControlFrame[]): DatumUsage[] {
  const out: DatumUsage[] = datums.map(d => ({
    letter: d.letter,
    asPrimary: 0, asSecondary: 0, asTertiary: 0, total: 0,
  }));
  for (const fcf of fcfs) {
    for (let i = 0; i < fcf.datums.length; i++) {
      const entry = out.find(u => u.letter === fcf.datums[i]!.letter);
      if (!entry) continue;
      if (i === 0) entry.asPrimary++;
      else if (i === 1) entry.asSecondary++;
      else if (i === 2) entry.asTertiary++;
      entry.total++;
    }
  }
  return out;
}

// ── Recommended datum priority ────────────────────────────────

export function suggestPriority(datums: DatumFeature[]): DatumLetter[] {
  // Prefer planes > FOS > axes > points (typical mating priority).
  const priority = (t: DatumFeature['featureType']): number => {
    switch (t) {
      case 'plane': return 0;
      case 'feature-of-size': return 1;
      case 'axis': return 2;
      case 'point': return 3;
    }
  };
  return datums
    .slice()
    .sort((a, b) => priority(a.featureType) - priority(b.featureType))
    .map(d => d.letter);
}

// ── Summary ────────────────────────────────────────────────────

export interface DatumSummary {
  fcfCount: number;
  errorCount: number;
  warnCount: number;
  fullFrameCount: number;
  undeclaredDatumCount: number;
}

export function summarize(result: ValidationResult, fcfCount: number): DatumSummary {
  const errors = result.issues.filter(i => i.severity === 'error').length;
  const warns = result.issues.filter(i => i.severity === 'warn').length;
  const full = Object.values(result.fullFramePerFcf).filter(v => v).length;
  const undeclared = result.issues.filter(i => i.message.includes('not declared')).length;
  return {
    fcfCount,
    errorCount: errors,
    warnCount: warns,
    fullFrameCount: full,
    undeclaredDatumCount: undeclared,
  };
}
