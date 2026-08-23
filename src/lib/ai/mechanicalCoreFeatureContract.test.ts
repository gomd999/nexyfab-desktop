import { describe, expect, it } from 'vitest';
import {
  MECHANICAL_CORE_30_FEATURES,
  MECHANICAL_CORE_FEATURE_RECEIPT_SCHEMA,
  MECHANICAL_CORE_LOCAL_AXIS_EVIDENCE_SCHEMA,
  MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES,
  evaluateMechanicalCoreFeatureClosedLoop,
  evaluateMechanicalCoreFeatureLocalClosedLoop,
  mechanicalCoreSelectionIdentityPayload,
  requiredMechanicalCoreLocalAssertionSuffixes,
  type MechanicalCoreFeatureClosedLoopReceiptV1,
  type MechanicalCoreLocalAxisEvidenceV1,
} from './mechanicalCoreFeatureContract';

const sha = (char: string) => char.repeat(64);

function receipt(): MechanicalCoreFeatureClosedLoopReceiptV1 {
  return {
    schema: MECHANICAL_CORE_FEATURE_RECEIPT_SCHEMA,
    releaseChannel: 'mechanical-core',
    generatedAt: '2026-08-11T00:00:00.000Z',
    designRevisionSha256: sha('a'),
    sourceEvidenceSha256: sha('b'),
    cases: MECHANICAL_CORE_30_FEATURES.map(feature => ({
      feature,
      cycles: 3,
      status: 'pass',
      checks: {
        manualEditApplied: true,
        aiPatchApplied: true,
        nfabRoundtrip: true,
        stepRoundtrip: true,
        stableIdsPreserved: true,
        lockedValuesPreserved: true,
        selectionBindingsPreserved: true,
        topologySilentRemapCount: 0,
      },
    })),
  };
}

describe('mechanical core 30-feature commercial contract', () => {
  it('freezes exactly thirty unique feature adapter families', () => {
    expect(MECHANICAL_CORE_30_FEATURES).toHaveLength(30);
    expect(new Set(MECHANICAL_CORE_30_FEATURES).size).toBe(30);
  });

  it('passes only a complete three-cycle NFAB and STEP receipt', () => {
    expect(evaluateMechanicalCoreFeatureClosedLoop(receipt())).toEqual({
      schema: 'nexyfab.mechanical-core-feature-contract.v1',
      eligible: true,
      required: 30,
      passed: 30,
      blockers: [],
    });
  });

  it('fails closed on missing, duplicate, drifted, or not-run feature evidence', () => {
    const value = receipt();
    const cases = [...value.cases];
    cases[0] = {
      ...cases[0]!,
      status: 'not_run',
      checks: { ...cases[0]!.checks, topologySilentRemapCount: 1 },
    };
    cases.push(cases[1]!);
    const result = evaluateMechanicalCoreFeatureClosedLoop({ ...value, cases });
    expect(result.eligible).toBe(false);
    expect(result.passed).toBe(29);
    expect(result.blockers).toEqual(expect.arrayContaining([
      `feature:${MECHANICAL_CORE_30_FEATURES[0]}:status:not_run`,
      `feature:${MECHANICAL_CORE_30_FEATURES[0]}:topology_silent_remap`,
      `feature:${MECHANICAL_CORE_30_FEATURES[1]}:duplicate`,
      'feature_case_count:31/30',
    ]));
  });
});

function localReceipt(): MechanicalCoreLocalAxisEvidenceV1 {
  return {
    schema: MECHANICAL_CORE_LOCAL_AXIS_EVIDENCE_SCHEMA,
    generatedAt: '2026-08-13T00:00:00.000Z',
    designRevisionSha256: sha('c'),
    runs: MECHANICAL_CORE_30_FEATURES.flatMap(feature => (
      MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES.map(axis => ({
        feature,
        axis,
        status: 'PASS' as const,
        executedAt: '2026-08-13T00:00:00.000Z',
        evidence: [{
          path: `artifacts/mechanical/${feature}-${axis}.json`,
          sha256: sha('d'),
          bytes: 1,
          assertionId: `${feature}${requiredMechanicalCoreLocalAssertionSuffixes(axis)[0]}`,
        }, ...requiredMechanicalCoreLocalAssertionSuffixes(axis).slice(1).map((suffix, index) => ({
          path: `artifacts/mechanical/${feature}-${axis}-${index + 1}.json`,
          sha256: sha('d'),
          bytes: 1,
          assertionId: `${feature}${suffix}`,
        }))],
        selectionIdentity: {
          featureFamily: feature,
          featureId: 'runtime-feature',
          selectionId: `${feature}:runtime-feature-selection`,
          identitySha256: sha('e'),
          preserved: true,
          topologySilentRemapCount: 0,
        },
        designRevisionSha256: sha('c'),
      }))
    )),
  };
}

describe('mechanical core local seven-axis assessment', () => {
  it('keeps every axis NOT_RUN when no execution receipt exists', () => {
    const result = evaluateMechanicalCoreFeatureLocalClosedLoop(null);
    expect(result).toMatchObject({
      eligible: false,
      requiredFeatures: 30,
      passedFeatures: 0,
      requiredAxesPerFeature: 7,
      axisTotals: { PASS: 0, FAIL: 0, NOT_RUN: 210 },
    });
    expect(result.cases.every(item => item.status === 'NOT_RUN')).toBe(true);
  });

  it('passes only when all 210 feature-axis bindings are independently verified', () => {
    const result = evaluateMechanicalCoreFeatureLocalClosedLoop(localReceipt(), {
      verifyEvidenceBinding: () => true,
      verifySelectionIdentity: () => true,
    });
    expect(result).toMatchObject({
      eligible: true,
      passedFeatures: 30,
      axisTotals: { PASS: 210, FAIL: 0, NOT_RUN: 0 },
      blockers: [],
    });
  });

  it('downgrades an unverified PASS binding to FAIL', () => {
    const result = evaluateMechanicalCoreFeatureLocalClosedLoop(localReceipt());
    expect(result.eligible).toBe(false);
    expect(result.passedFeatures).toBe(0);
    expect(result.axisTotals).toEqual({ PASS: 0, FAIL: 210, NOT_RUN: 0 });
    expect(result.blockers).toContain('feature:hole:axis:create:binding_unverified');
  });

  it('does not let duplicate, failed, or missing axes collapse into PASS', () => {
    const value = localReceipt();
    const runs = [...value.runs];
    runs.push(runs[0]!);
    runs.splice(runs.findIndex(item => item.feature === 'fillet' && item.axis === 'drawing'), 1);
    const failedIndex = runs.findIndex(item => item.feature === 'chamfer' && item.axis === 'export');
    runs[failedIndex] = { ...runs[failedIndex]!, status: 'FAIL' };
    const result = evaluateMechanicalCoreFeatureLocalClosedLoop({ ...value, runs }, {
      verifyEvidenceBinding: () => true,
      verifySelectionIdentity: () => true,
    });
    expect(result.eligible).toBe(false);
    expect(result.cases.find(item => item.feature === 'hole')?.status).toBe('FAIL');
    expect(result.cases.find(item => item.feature === 'fillet')?.status).toBe('NOT_RUN');
    expect(result.cases.find(item => item.feature === 'chamfer')?.status).toBe('FAIL');
    expect(result.blockers).toEqual(expect.arrayContaining([
      'feature:hole:axis:create:duplicate',
      'feature:fillet:axis:drawing:not_run',
      'feature:chamfer:axis:export:status:fail',
    ]));
  });

  it('requires the selection digest to be independently rebound to family, object, and selection IDs', () => {
    const value = localReceipt();
    const result = evaluateMechanicalCoreFeatureLocalClosedLoop(value, {
      verifyEvidenceBinding: () => true,
      verifySelectionIdentity: identity => identity.identitySha256 === mechanicalCoreSelectionIdentityPayload(identity),
    });
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain('feature:hole:axis:create:selection_identity_unverified');
  });
});
