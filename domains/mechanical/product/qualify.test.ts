import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildMotorGearboxDriveModuleFixtureContract } from './fixtures/motorGearboxDriveModuleContract';
import { MECHANICAL_CHECK_RECEIPT_SCHEMA, qualifyMotorGearboxDriveModule, type MechanicalCheckReceipt } from './qualify';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const globalChecks = [
  'assembly-solver', 'assembly-dof', 'assembly-static-interference', 'assembly-motion', 'assembly-exact-evidence',
  'load-life', 'alignment', 'service-clearance', 'guard-safety', 'tolerance-stack', 'dfm',
  'model-drawing-bom', 'inspection-coverage',
];

function passingChecks(): MechanicalCheckReceipt[] {
  const contract = buildMotorGearboxDriveModuleFixtureContract();
  const checkIds = [
    ...globalChecks,
    ...contract.parts.flatMap(part => [`part:${part.id}:feature-tree`, `part:${part.id}:exact-brep`, `part:${part.id}:topology`, `part:${part.id}:step-roundtrip`]),
  ];
  return checkIds.map(checkId => {
    const featurePart = contract.parts.find(part => checkId === `part:${part.id}:feature-tree`);
    return {
      schema: MECHANICAL_CHECK_RECEIPT_SCHEMA,
      checkId,
      status: 'PASS',
      sourceRevision: contract.identity.revision,
      inputSha256: contract.identity.contentSha256,
      resultSha256: featurePart?.geometryHash ?? hash(checkId),
      validatorId: `validator-${checkId.replaceAll(':', '-')}`,
      validatorVersion: '1.0.0',
      issuedAt: '2026-08-24T00:00:00Z',
    };
  });
}

describe('mechanical drive-module qualification', () => {
  it('verifies one immutable revision but never fabricates aggregate product promotion', () => {
    const contract = buildMotorGearboxDriveModuleFixtureContract();
    const result = qualifyMotorGearboxDriveModule(contract, passingChecks());
    expect(result).toMatchObject({ status: 'PASS', currentRevisionVerified: true, productReceiptPromotionReady: false });
    expect(result.axisEvidence).toHaveLength(7);
    expect(result.axisEvidence.every(axis => axis.status === 'PASS' && axis.caseCount === 1)).toBe(true);
  });

  it('holds the revision when a required governed calculation is not run', () => {
    const contract = buildMotorGearboxDriveModuleFixtureContract();
    const checks = passingChecks().filter(check => check.checkId !== 'load-life');
    const result = qualifyMotorGearboxDriveModule(contract, checks);
    expect(result).toMatchObject({ status: 'HOLD', currentRevisionVerified: false });
    expect(result.blockers).toContain('check_not_run:load-life');
    expect(result.axisEvidence.find(axis => axis.axis === 'manufacturability')?.status).toBe('NOT_RUN');
  });

  it('fails a stale receipt or feature-tree hash substitution', () => {
    const contract = buildMotorGearboxDriveModuleFixtureContract();
    const checks = passingChecks();
    checks[0] = { ...checks[0]!, sourceRevision: 'old-revision' };
    const featureIndex = checks.findIndex(check => check.checkId.endsWith(':feature-tree'));
    checks[featureIndex] = { ...checks[featureIndex]!, resultSha256: hash('preview-mesh') };
    const result = qualifyMotorGearboxDriveModule(contract, checks);
    expect(result.status).toBe('FAIL');
    expect(result.blockers).toEqual(expect.arrayContaining(['checks[0]:revision_stale', `checks[${featureIndex}]:feature_tree_hash_mismatch`]));
  });
});
