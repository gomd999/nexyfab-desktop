import { describe, expect, it } from 'vitest';
import {
  REQUIRED_STEP_TARGETS,
  MECHANICAL_STEP_INTEROP_RECEIPT_SCHEMA,
  STEP_COMPATIBILITY_LEVELS,
  STEP_INTEROP_CHECKS,
  evaluateMechanicalStepInteroperability,
  type MechanicalStepInteropReceiptV1,
  type StepInteropTarget,
} from './mechanicalStepInteroperability';

const sha = (char: string) => char.repeat(64);
const requiredChecks = STEP_COMPATIBILITY_LEVELS.slice(0, 5).flatMap(level => STEP_INTEROP_CHECKS[level]);

function receipt(target: StepInteropTarget, index: number): MechanicalStepInteropReceiptV1 {
  return {
    schema: MECHANICAL_STEP_INTEROP_RECEIPT_SCHEMA,
    releaseChannel: 'mechanical-core',
    target,
    targetVersion: target === 'nexyfab' ? '3d6ba1ec' : '2026.1',
    protocol: 'AP242',
    modelKind: 'assembly',
    requestedLevel: 'C4',
    executionMode: target === 'nexyfab' ? 'kernel_self_test' : target === 'independent-step-parser' ? 'independent_parser' : 'native_application',
    designRevisionSha256: sha('a'),
    sourceArtifactSha256: sha('b'),
    openedArtifactSha256: (index + 2).toString(16).repeat(64),
    returnedArtifactSha256: (index + 7).toString(16).repeat(64),
    evidenceBundleSha256: (index + 11).toString(16).repeat(64),
    operatorId: `operator-${target}`,
    operatorSignatureRef: `signature-${target}`,
    executedAt: '2026-08-11T00:00:00.000Z',
    checks: requiredChecks.map(id => ({ id, status: 'pass' })),
  };
}

describe('mechanical STEP C4 interoperability', () => {
  it('requires the same AP242 assembly in NexyFab and an independent STEP parser', () => {
    const targets: StepInteropTarget[] = [...REQUIRED_STEP_TARGETS];
    expect(evaluateMechanicalStepInteroperability(targets.map(receipt))).toEqual({
      schema: 'nexyfab.mechanical-step-interoperability-assessment.v2',
      releaseChannel: 'mechanical-core',
      requiredLevel: 'C4',
      verifiedLevel: 'C4',
      verifiedTargets: targets,
      eligible: true,
      blockers: [],
    });
  });

  it('does not accept a kernel-only claim for the independent parser or a missing reverse-diff check', () => {
    const targets: StepInteropTarget[] = [...REQUIRED_STEP_TARGETS];
    const receipts = targets.map(receipt);
    receipts[1] = {
      ...receipts[1]!,
      executionMode: 'kernel_self_test',
      checks: receipts[1]!.checks.filter(check => check.id !== 'geometry_diff'),
    };
    const result = evaluateMechanicalStepInteroperability(receipts);
    expect(result.eligible).toBe(false);
    expect(result.verifiedLevel).toBeNull();
    expect(result.blockers).toEqual(expect.arrayContaining([
      'target:independent-step-parser:independent_execution_required',
      'target:independent-step-parser:check:geometry_diff:missing',
    ]));
  });

  it('rejects mixed design revisions even when every self-reported check passes', () => {
    const targets: StepInteropTarget[] = [...REQUIRED_STEP_TARGETS];
    const receipts = targets.map(receipt);
    receipts[1] = { ...receipts[1]!, designRevisionSha256: sha('f') };
    expect(evaluateMechanicalStepInteroperability(receipts).blockers).toContain('matrix:revision_mismatch');
  });

  it('does not require vendor-native CAD receipts for the standalone product', () => {
    const receipts = REQUIRED_STEP_TARGETS.map(receipt);
    const result = evaluateMechanicalStepInteroperability(receipts);
    expect(result.eligible).toBe(true);
    expect(result.blockers.join(',')).not.toMatch(/solidworks|fusion|onshape/);
  });
});
