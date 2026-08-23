import { describe, expect, it } from 'vitest';
import {
  MECHANICAL_LOAD_SUPPORT_CONTRACT_SCHEMA,
  evaluateMechanicalLoadSupportEligibility,
  validateMechanicalLoadSupportModel,
  type MechanicalLoadSupportModelV1,
} from './mechanicalLoadSupportContract';

const revision = 'a'.repeat(64);
const provenance = {
  sourceId: 'load-case-1',
  sourceKind: 'user_input' as const,
  sourceRef: 'case://load-case-1',
  capturedAt: '2026-08-22T00:00:00.000Z',
  revisionSha256: revision,
};

function model(): MechanicalLoadSupportModelV1 {
  return {
    schema: MECHANICAL_LOAD_SUPPORT_CONTRACT_SCHEMA,
    units: 'N-mm-s',
    coordinateFrame: 'global_cartesian',
    coordinateSystemId: 'global-mm',
    revisionSha256: revision,
    solverStatus: 'NOT_RUN',
    loads: [{ id: 'force-1', kind: 'force', locationMm: { x: 100, y: 0, z: 20 }, vectorN: { x: 0, y: -500, z: 0 }, coordinateFrame: 'global_cartesian', provenance }],
    supports: [{ id: 'support-1', kind: 'fixed', locationMm: { x: 0, y: 0, z: 0 }, constrainedTranslations: [true, true, true], constrainedRotations: [true, true, true], coordinateFrame: 'global_cartesian', provenance }],
  };
}

describe('mechanical load/support canonical contract', () => {
  it('accepts canonical N-mm global coordinates with revision-bound provenance', () => {
    expect(validateMechanicalLoadSupportModel(model())).toEqual({ valid: true, issues: [] });
  });

  it('rejects non-canonical units, unbound provenance, non-finite geometry, and external receipts', () => {
    const invalid = model() as MechanicalLoadSupportModelV1 & { externalReceipt?: unknown };
    invalid.units = 'N-m-s' as MechanicalLoadSupportModelV1['units'];
    invalid.loads[0]!.locationMm.x = Number.NaN;
    invalid.loads[0]!.provenance = { ...provenance, revisionSha256: 'b'.repeat(64) };
    invalid.externalReceipt = { status: 'approved' };
    const result = validateMechanicalLoadSupportModel(invalid);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'canonical_units_required',
      'load_binding_invalid:force-1',
      'external_receipt_forbidden',
    ]));
  });

  it('keeps solver eligibility NOT_RUN/HOLD even for valid canonical input', () => {
    const result = evaluateMechanicalLoadSupportEligibility(model());
    expect(result).toEqual({
      schema: MECHANICAL_LOAD_SUPPORT_CONTRACT_SCHEMA,
      status: 'HOLD',
      solverStatus: 'NOT_RUN',
      eligible: false,
      blockers: ['elastic_solver_not_run', 'external_receipt_not_available'],
    });
  });

  it('uses N-mm moments and rejects support kinds whose six degrees of freedom disagree', () => {
    const valid = model();
    valid.loads = [{ id: 'moment-1', kind: 'moment', locationMm: { x: 0, y: 0, z: 0 }, momentNmm: { x: 0, y: 0, z: 250_000 }, coordinateFrame: 'global_cartesian', provenance }];
    expect(validateMechanicalLoadSupportModel(valid).valid).toBe(true);
    valid.supports = [{ ...valid.supports[0]!, kind: 'roller', constrainedTranslations: [true, true, false], constrainedRotations: [false, false, false] }];
    expect(validateMechanicalLoadSupportModel(valid).issues).toContain('support_constraints_invalid:support-1');
  });
});
