import { describe, expect, it } from 'vitest';
import {
  MECHANICAL_SINGLE_PART_REQUIRED_AXES,
  evaluateMechanicalSinglePartSourceRuns,
  mechanicalSinglePartDimensionsMm,
  type MechanicalSinglePartSourceRun,
} from './mechanicalSinglePartCandidate';

const passRuns = (feature = 'hole'): MechanicalSinglePartSourceRun[] => MECHANICAL_SINGLE_PART_REQUIRED_AXES.map(axis => ({
  feature,
  axis,
  status: 'PASS' as const,
}));

describe('mechanical single-part candidate contract', () => {
  it('accepts exactly one PASS per required axis without a feature allowlist', () => {
    expect(evaluateMechanicalSinglePartSourceRuns('newExactFeature', passRuns('newExactFeature')))
      .toEqual({ eligible: true, reasons: [] });
  });

  it('fails closed on missing, duplicate, failed, or foreign axes', () => {
    const runs = passRuns();
    runs.splice(1, 1);
    runs.push({ feature: 'hole', axis: 'create', status: 'PASS' });
    runs.push({ feature: 'hole', axis: 'drawing', status: 'FAIL' });
    runs.push({ feature: 'hole', axis: 'foreign', status: 'PASS' });
    const verdict = evaluateMechanicalSinglePartSourceRuns('hole', runs);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons).toEqual(expect.arrayContaining([
      'axis_missing:edit',
      'axis_duplicate:create:2',
      'axis_duplicate:drawing:2',
      'axis_not_pass:drawing:FAIL',
      'unexpected_axis:foreign',
    ]));
  });

  it('derives positive axis dimensions from the inspected bbox', () => {
    expect(mechanicalSinglePartDimensionsMm([[-2, -3, -4], [3, 5, 7]]))
      .toEqual({ x: 5, y: 8, z: 11 });
    expect(() => mechanicalSinglePartDimensionsMm([[0, 0, 0], [0, 1, 1]]))
      .toThrow('CANDIDATE_BOUNDS_EMPTY');
  });
});
