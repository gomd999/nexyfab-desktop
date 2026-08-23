import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MECHANICAL_CORE_30_FEATURES, type MechanicalCoreFeatureClosedLoopReceiptV1 } from '../src/lib/ai/mechanicalCoreFeatureContract';
import { REQUIRED_STEP_TARGETS, STEP_COMPATIBILITY_LEVELS, STEP_INTEROP_CHECKS } from '../src/lib/ai/mechanicalStepInteroperability';
import {
  adaptMechanicalCoreLocalEvidenceToCommercial,
  buildMechanicalCommercialContractAssessments,
  mechanicalContractSignoffPayload,
  mechanicalFeatureEvidenceTargetHash,
  mechanicalStepEvidenceTargetHash,
} from './build-mechanical-commercial-contract-assessments';

const sha = (char: string) => char.repeat(64);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const paths = {
  featureReceipt: 'external/feature.json', featureAssessment: 'out/feature.json',
  interoperabilityReceipts: 'external/interop.json', interoperabilityAssessment: 'out/interop.json',
};

function write(root: string, relative: string, value: unknown) {
  const absolute = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(value)}\n`);
}

describe('mechanical commercial contract assessment builder', () => {
  it('produces explicit pending assessments when external evidence is absent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-contracts-'));
    const result = buildMechanicalCommercialContractAssessments(root, paths, '2026-08-11T00:00:00.000Z');
    expect(result.feature).toMatchObject({ eligible: false, required: 30, passed: 0, sourceReceipt: null });
    expect(result.interoperability).toMatchObject({ eligible: false, requiredLevel: 'C4', sourceReceipts: null });
  });

  it('keeps the local v1 candidate HOLD and binds all 30 feature rows without inventing a commercial receipt', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-contracts-'));
    const adapted = adaptMechanicalCoreLocalEvidenceToCommercial(root, {
      ...paths,
      localEvidenceInput: 'missing/local-axis.json',
      localAssessmentOutput: 'out/local-readiness.json',
      adapterAssessmentOutput: 'out/adapter-readiness.json',
    }, { now: Date.parse('2026-08-11T04:00:00.000Z') });
    expect(adapted).toMatchObject({
      status: 'HOLD',
      eligible: false,
      requiredCases: 30,
      commercial: { eligible: false },
    });
    expect(adapted.caseBinding).toHaveLength(30);
    expect(adapted.commercial.blockers).toContain('commercial_feature_bundle_missing');
    expect(adapted.commercial.blockers).toContain('local_candidate_is_not_commercial_receipt');
  });

  it('binds complete receipts by file hash and passes both internal commercial contracts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-contracts-'));
    const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-contract-evidence-'));
    const trustedReviewers: Record<string, { publicKey: string; roles: string[] }> = {};
    const signingKeys = new Map<string, ReturnType<typeof generateKeyPairSync>>();
    const register = (reviewerId: string, role: string) => {
      const key = generateKeyPairSync('ed25519');
      signingKeys.set(reviewerId, key);
      trustedReviewers[reviewerId] = { publicKey: key.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: [role] };
    };
    const artifact = (relative: string, value: string) => {
      const absolute = path.join(evidenceRoot, ...relative.split('/'));
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      const bytes = Buffer.from(value);
      fs.writeFileSync(absolute, bytes);
      return { path: relative, sha256: sha256(bytes) };
    };
    const checks = STEP_COMPATIBILITY_LEVELS.slice(0, 5).flatMap(level => STEP_INTEROP_CHECKS[level]);
    const sourceEvidence = artifact('feature/source-evidence.json', 'feature-evidence');
    const nativeRunnerEvidence = artifact('feature/native-runner-evidence.json', 'native-runner-evidence');
    const featureReceipt: MechanicalCoreFeatureClosedLoopReceiptV1 = {
      schema: 'nexyfab.mechanical-core-feature-closed-loop.v1', releaseChannel: 'mechanical-core',
      generatedAt: '2026-08-11T00:00:00.000Z', designRevisionSha256: sha('a'), sourceEvidenceSha256: sourceEvidence.sha256,
      cases: MECHANICAL_CORE_30_FEATURES.map(feature => ({ feature, cycles: 3, status: 'pass', checks: {
        manualEditApplied: true, aiPatchApplied: true, nfabRoundtrip: true, stepRoundtrip: true,
        stableIdsPreserved: true, lockedValuesPreserved: true, selectionBindingsPreserved: true,
        topologySilentRemapCount: 0,
      } })),
    };
    register('feature-runner', 'feature-native-runner');
    register('feature-reviewer', 'feature-validator');
    const featureBundleCore = {
      schema: 'nexyfab.mechanical-core-feature-evidence-bundle.v2' as const,
      evidenceRootId: sha('e'), receipt: featureReceipt, artifacts: { sourceEvidence, nativeRunnerEvidence },
    };
    const featureTargetHash = mechanicalFeatureEvidenceTargetHash(featureBundleCore);
    const runnerUnsigned = { reviewerId: 'feature-runner', signedAt: '2026-08-11T00:30:00.000Z', targetHash: featureTargetHash };
    const featureUnsigned = { reviewerId: 'feature-reviewer', signedAt: '2026-08-11T01:00:00.000Z', targetHash: featureTargetHash };
    write(root, paths.featureReceipt, { ...featureBundleCore, runner: {
      ...runnerUnsigned,
      signature: sign(null, Buffer.from(mechanicalContractSignoffPayload('feature-native-runner', runnerUnsigned)), signingKeys.get('feature-runner')!.privateKey).toString('base64'),
    }, validator: {
      ...featureUnsigned,
      signature: sign(null, Buffer.from(mechanicalContractSignoffPayload('feature-validator', featureUnsigned)), signingKeys.get('feature-reviewer')!.privateKey).toString('base64'),
    } });
    const sourceStep = artifact('interop/source.step', 'shared-step-source');
    const targets = [...REQUIRED_STEP_TARGETS];
    const receipts = targets.map(target => ({
      schema: 'nexyfab.mechanical-step-interoperability-receipt.v2', releaseChannel: 'mechanical-core',
      target, targetVersion: '2026.1', protocol: 'AP242', modelKind: 'assembly', requestedLevel: 'C4',
      executionMode: target === 'nexyfab' ? 'kernel_self_test' : 'independent_parser',
      designRevisionSha256: sha('a'), sourceArtifactSha256: sourceStep.sha256,
      openedArtifactSha256: '', returnedArtifactSha256: '', evidenceBundleSha256: '', operatorId: `op-${target}`,
      operatorSignatureRef: `registry:op-${target}`, executedAt: '2026-08-11T02:00:00.000Z',
      checks: checks.map(id => ({ id, status: 'pass' })),
    }));
    const evidence = receipts.map((receipt, index) => {
      const openedExtension = '.step';
      const artifacts = {
        source: sourceStep,
        opened: artifact(`interop/${receipt.target}/opened${openedExtension}`, `opened-${index}`),
        returned: artifact(`interop/${receipt.target}/returned.step`, `returned-${index}`),
        evidenceBundle: artifact(`interop/${receipt.target}/evidence.json`, `evidence-${index}`),
      };
      receipt.openedArtifactSha256 = artifacts.opened.sha256;
      receipt.returnedArtifactSha256 = artifacts.returned.sha256;
      receipt.evidenceBundleSha256 = artifacts.evidenceBundle.sha256;
      return { target: receipt.target, artifacts };
    });
    const stepBundleCore = { schema: 'nexyfab.mechanical-step-interoperability-evidence-bundle.v3' as const, evidenceRootId: sha('f') };
    const signedEvidence = evidence.map((item, index) => {
      const receipt = receipts[index]!;
      const role = `step-${receipt.target}-operator`;
      register(receipt.operatorId, role);
      const targetHash = mechanicalStepEvidenceTargetHash(stepBundleCore, receipt as never, item);
      const unsigned = { reviewerId: receipt.operatorId, signedAt: receipt.executedAt, targetHash };
      return { ...item, operator: {
        ...unsigned,
        signature: sign(null, Buffer.from(mechanicalContractSignoffPayload(role, unsigned)), signingKeys.get(receipt.operatorId)!.privateKey).toString('base64'),
      } };
    });
    write(root, paths.interoperabilityReceipts, { ...stepBundleCore, receipts, evidence: signedEvidence });
    const result = buildMechanicalCommercialContractAssessments(root, paths, '2026-08-11T03:00:00.000Z', {
      evidenceRoot, trustedReviewers, now: Date.parse('2026-08-11T04:00:00.000Z'),
    });
    expect(result.feature).toMatchObject({ eligible: true, passed: 30, sourceReceipt: { path: paths.featureReceipt } });
    expect(result.interoperability).toMatchObject({ eligible: true, verifiedLevel: 'C4', sourceReceipts: { path: paths.interoperabilityReceipts } });
    const adapted = adaptMechanicalCoreLocalEvidenceToCommercial(root, {
      ...paths,
      localEvidenceInput: 'missing/local-axis.json',
      localAssessmentOutput: 'out/local-readiness.json',
      adapterAssessmentOutput: 'out/adapter-readiness.json',
    }, { evidenceRoot, trustedReviewers, now: Date.parse('2026-08-11T04:00:00.000Z') });
    expect(adapted).toMatchObject({ status: 'PASS', eligible: true, commercial: { eligible: true } });
    expect(adapted.caseBinding).toHaveLength(30);
    expect(adapted.caseBinding.every(item => item.commercialCasePresent)).toBe(true);
    const featureBundleWithoutRunner = JSON.parse(fs.readFileSync(path.join(root, ...paths.featureReceipt.split('/')), 'utf8'));
    delete featureBundleWithoutRunner.runner;
    write(root, paths.featureReceipt, featureBundleWithoutRunner);
    const missingRunner = buildMechanicalCommercialContractAssessments(root, paths, '2026-08-11T03:00:00.000Z', {
      evidenceRoot, trustedReviewers, now: Date.parse('2026-08-11T04:00:00.000Z'),
    });
    expect(missingRunner.feature.eligible).toBe(false);
    fs.writeFileSync(path.join(evidenceRoot, 'interop', 'independent-step-parser', 'returned.step'), 'tampered');
    const tampered = buildMechanicalCommercialContractAssessments(root, paths, '2026-08-11T03:00:00.000Z', {
      evidenceRoot, trustedReviewers, now: Date.parse('2026-08-11T04:00:00.000Z'),
    });
    expect(tampered.interoperability.eligible).toBe(false);
    expect(tampered.interoperability.blockers).toContain('target:independent-step-parser:missing');
  });
});
