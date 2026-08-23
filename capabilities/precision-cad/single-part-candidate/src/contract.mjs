export const MECHANICAL_SINGLE_PART_CANDIDATE_SCHEMA =
  'nexyfab.mechanical-single-part-candidate.v1';

export const MECHANICAL_SINGLE_PART_CANDIDATE_RECEIPT_SCHEMA =
  'nexyfab.mechanical-single-part-candidate-receipt.v1';

export const MECHANICAL_SINGLE_PART_REQUIRED_AXES = Object.freeze([
  'create',
  'edit',
  'regenerate',
  'save_reopen',
  'undo',
  'export',
  'drawing',
]);

export function evaluateMechanicalSinglePartSourceRuns(feature, runs) {
  const reasons = [];
  const expected = new Set(MECHANICAL_SINGLE_PART_REQUIRED_AXES);
  const seen = new Map();

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

export function mechanicalSinglePartDimensionsMm(boundsMm) {
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
