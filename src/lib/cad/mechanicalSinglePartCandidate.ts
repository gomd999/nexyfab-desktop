export const MECHANICAL_SINGLE_PART_CANDIDATE_SCHEMA =
  'nexyfab.mechanical-single-part-candidate.v1' as const;

export const MECHANICAL_SINGLE_PART_CANDIDATE_RECEIPT_SCHEMA =
  'nexyfab.mechanical-single-part-candidate-receipt.v1' as const;

export const MECHANICAL_SINGLE_PART_REQUIRED_AXES = [
  'create',
  'edit',
  'regenerate',
  'save_reopen',
  'undo',
  'export',
  'drawing',
] as const;

export type MechanicalSinglePartAxis =
  (typeof MECHANICAL_SINGLE_PART_REQUIRED_AXES)[number];

export interface MechanicalSinglePartSourceRun {
  feature: string;
  axis: string;
  status: 'PASS' | 'FAIL' | 'NOT_RUN' | string;
}

export interface MechanicalSinglePartSourceVerdict {
  eligible: boolean;
  reasons: string[];
}

/**
 * A feature is eligible for expensive STEP reinspection only when the current
 * source receipt contains exactly one PASS for every closed-loop axis. This is
 * deliberately independent of feature names: a newly evidenced feature is not
 * promoted by an allowlist, and a named feature with a missing axis cannot pass.
 */
export function evaluateMechanicalSinglePartSourceRuns(
  feature: string,
  runs: readonly MechanicalSinglePartSourceRun[],
): MechanicalSinglePartSourceVerdict {
  const reasons: string[] = [];
  const expected = new Set<string>(MECHANICAL_SINGLE_PART_REQUIRED_AXES);
  const seen = new Map<string, number>();

  for (const run of runs) {
    if (run.feature !== feature) {
      reasons.push(`feature_mismatch:${run.feature}`);
      continue;
    }
    if (!expected.has(run.axis)) {
      reasons.push(`unexpected_axis:${run.axis}`);
      continue;
    }
    seen.set(run.axis, (seen.get(run.axis) ?? 0) + 1);
    if (run.status !== 'PASS') reasons.push(`axis_not_pass:${run.axis}:${run.status}`);
  }

  for (const axis of MECHANICAL_SINGLE_PART_REQUIRED_AXES) {
    const count = seen.get(axis) ?? 0;
    if (count === 0) reasons.push(`axis_missing:${axis}`);
    else if (count !== 1) reasons.push(`axis_duplicate:${axis}:${count}`);
  }

  return { eligible: reasons.length === 0, reasons };
}

export function mechanicalSinglePartDimensionsMm(
  boundsMm: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
  ],
): { x: number; y: number; z: number } {
  const values = boundsMm.flat();
  if (!values.every(Number.isFinite)) throw new Error('CANDIDATE_BOUNDS_NON_FINITE');
  const dimensions = {
    x: boundsMm[1][0] - boundsMm[0][0],
    y: boundsMm[1][1] - boundsMm[0][1],
    z: boundsMm[1][2] - boundsMm[0][2],
  };
  if (!Object.values(dimensions).every(value => value > 0)) {
    throw new Error('CANDIDATE_BOUNDS_EMPTY');
  }
  return dimensions;
}
