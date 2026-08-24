import { describe, expect, it } from 'vitest';
import {
  MECHANICAL_SINGLE_PART_REQUIRED_AXES as legacyAxes,
  evaluateMechanicalSinglePartSourceRuns as evaluateLegacy,
  mechanicalSinglePartDimensionsMm as dimensionsLegacy,
} from './mechanicalSinglePartCandidate';
import {
  MECHANICAL_SINGLE_PART_REQUIRED_AXES as sliceAxes,
  evaluateMechanicalSinglePartSourceRuns as evaluateSlice,
  mechanicalSinglePartDimensionsMm as dimensionsSlice,
} from '../../../capabilities/precision-cad/single-part-candidate/src/contract.mjs';

describe('single-part slice compatibility', () => {
  it('keeps the legacy path as an identity-preserving adapter', () => {
    expect(legacyAxes).toBe(sliceAxes);
    expect(evaluateLegacy).toBe(evaluateSlice);
    expect(dimensionsLegacy).toBe(dimensionsSlice);
  });

  it('matches the legacy fail-closed source verdict', () => {
    const runs = legacyAxes.map(axis => ({ feature: 'fixture', axis, status: 'PASS' as const }));
    expect(sliceAxes).toEqual(legacyAxes);
    expect(evaluateSlice('fixture', runs)).toEqual(evaluateLegacy('fixture', runs));
    expect(evaluateSlice('fixture', runs.slice(1))).toEqual(evaluateLegacy('fixture', runs.slice(1)));
  });

  it('matches the legacy dimension contract', () => {
    const bounds = [[-1, 2, 3], [4, 8, 12]] as const;
    expect(dimensionsSlice(bounds)).toEqual(dimensionsLegacy(bounds));
  });
});
