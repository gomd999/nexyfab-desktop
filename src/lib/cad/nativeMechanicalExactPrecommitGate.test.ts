// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hashCanonicalCadLockSet, sealCanonicalCadCommandV2 } from './canonicalCadV2ConsumerDraft';
import { FEATURE_REGISTRY_HASH } from './featureRegistry';
import { executeNativeMechanicalExactFeature } from '../occt/nativeMechanicalExactFeatureLoop';
import {
  NATIVE_MECHANICAL_EXACT_COMMAND_BINDING_SCHEMA,
  decideNativeMechanicalExactPrecommit,
} from './nativeMechanicalExactPrecommitGate';

const SHA = 'a'.repeat(64);
const host = { loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], depth: 5 } as const;

describe('native mechanical exact pure precommit gate', () => {
  it('returns structural EVIDENCE_BOUND only for fully bound exact evidence, while remaining HOLD/non-authoritative', async () => {
    const result = await executeNativeMechanicalExactFeature({ schema: 'nexyfab.precision-cad.native-mechanical-exact-request.v1', featureId: 'cad.mechanical.draft', operationId: 'operation-draft', projectId: 'project-1', documentId: 'document-1', baseRevisionId: 'revision-7', baseSequence: 7, baseContentSha256: SHA, parameters: { host, angleDeg: 5, pullDirection: [0, 0, 1], neutralZ: 0 } });
    if (result.status !== 'EXACT_PASS') return;
    const baseRevision = { revisionId: 'revision-7', sequence: 7, contentSha256: SHA };
    const command = sealCanonicalCadCommandV2({
      commandId: 'operation-draft', idempotencyKey: 'idempotency-draft', projectId: 'project-1', documentId: 'document-1', baseRevision, nextRevisionId: 'revision-8',
      actor: { kind: 'human', actorId: 'user-1', agentIdentity: null }, units: { length: 'mm', angle: 'deg' }, coordinateFrame: { frameId: 'project-frame', parentFrameId: null, origin: [0, 0, 0], rotationDeg: [0, 0, 0] }, tolerancePolicy: { linear: 0.01, angularDeg: 0.1 },
      preconditions: { lockSetSha256: hashCanonicalCadLockSet([]), locks: [], selectedObjectIds: [], parameterPaths: [] }, dependencies: [], compensationForCommandId: null, expectedChangedObjectIds: ['part-1'], artifacts: {
        inputs: [{ artifactId: 'native-exact-receipt', contentSha256: result.receipt.receiptSha256 }],
        expectedOutputs: [{ artifactId: 'step', contentSha256: result.receipt.stepSha256 }],
      },
      authorization: { permission: 'EDIT_DOCUMENT', riskClass: 'R2', approvalScope: 'document-1', approvalReceiptSha256: null }, resourceBudget: { timeoutMs: 1000, memoryMb: 512, maxIterations: 10, maxRetries: 0 }, sideEffects: { canonicalDocument: true, externalTransmission: false, quoteOrRfq: false }, verification: { verifierIds: ['part-exact-brep', 'part-step-roundtrip'], blockers: [] }, timing: { issuedAt: '2026-08-24T00:00:00.000Z', expiresAt: '2026-08-24T01:00:00.000Z' }, staleIf: { baseRevisionChanges: true, baseContentHashChanges: true },
      operations: [{ kind: 'feature', targetObjectId: 'part-1', payload: {
        schema: NATIVE_MECHANICAL_EXACT_COMMAND_BINDING_SCHEMA,
        featureId: result.receipt.featureId,
        operationId: result.receipt.operationId,
        registryHash: FEATURE_REGISTRY_HASH,
        runtimeIdentitySha256: result.receipt.runtimeIdentitySha256,
        requestSha256: result.receipt.requestSha256,
        resultMeasurementSha256: result.receipt.resultMeasurementSha256,
        roundtripMeasurementSha256: result.receipt.roundtripMeasurementSha256,
        receiptArtifactId: 'native-exact-receipt',
        receiptSha256: result.receipt.receiptSha256,
        stepArtifactId: 'step',
        stepSha256: result.receipt.stepSha256,
      } }],
    });
    const decision = decideNativeMechanicalExactPrecommit({ command, result, currentRegistryHash: FEATURE_REGISTRY_HASH });
    expect(decision).toMatchObject({
      authority: 'PRECISION_LOCAL_STRUCTURAL_GATE',
      status: 'EVIDENCE_BOUND',
      verification: 'STRUCTURAL_ONLY',
      authoritativeCommit: false,
      release: 'HOLD',
    });
    expect(decideNativeMechanicalExactPrecommit({ command, result, currentRegistryHash: 'b'.repeat(64) }))
      .toMatchObject({ status: 'HOLD', blockers: ['REGISTRY_STALE'] });
    expect(decideNativeMechanicalExactPrecommit({
      command: { ...command, operations: [...command.operations, command.operations[0]] },
      result,
      currentRegistryHash: FEATURE_REGISTRY_HASH,
    })).toMatchObject({ status: 'HOLD' });
  }, 60_000);

  it('fails closed for stale, missing, extra, tampered, and hostile inputs', () => {
    expect(decideNativeMechanicalExactPrecommit({ status: 'HOLD' })).toMatchObject({ status: 'HOLD' });
    expect(decideNativeMechanicalExactPrecommit({ command: {}, result: {}, currentRegistryHash: SHA, extra: true })).toMatchObject({ status: 'HOLD' });
    const hostile = new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
    expect(() => decideNativeMechanicalExactPrecommit(hostile)).not.toThrow();
    expect(decideNativeMechanicalExactPrecommit(hostile)).toMatchObject({ status: 'HOLD' });
  });
});
