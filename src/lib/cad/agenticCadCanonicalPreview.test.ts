import { describe, expect, it } from 'vitest';
import { previewAgenticCanonicalCadCommand, validateAgenticCadCanonicalPreviewResult } from './agenticCadCanonicalPreview';
import {
  applyCanonicalCadCommandV2,
  createCanonicalCadDocumentV2,
  hashCanonicalCadLockSet,
  sealCanonicalCadCommandV2,
  sealCanonicalCadObjectV2,
  sealCanonicalCadRelationshipV2,
  type CanonicalCadDocumentV2ConsumerDraft,
  type CanonicalCadOperationV2,
} from './canonicalCadV2ConsumerDraft';
import { createAgenticCadExecutionPlan, evaluateAgenticCadExecutionPlan } from './agenticCadExecutionPlan';
import { getAgenticCadToolDescriptor } from './agenticCadToolRegistry';

const h = (character: string) => character.repeat(64);
const issuedAt = '2026-08-24T00:00:00.000Z';
const expiresAt = '2026-08-24T01:00:00.000Z';
const evaluatedAt = '2026-08-24T00:30:00.000Z';
const agentIdentity = { agentId: 'agent-1', modelId: 'model-1', promptSha256: h('d') };

function object(objectId: string, width: number) {
  return sealCanonicalCadObjectV2({
    objectId, namespace: 'building', objectKind: 'building.object', objectRevision: 0,
    payload: { width }, transform: null,
  });
}

function document(): CanonicalCadDocumentV2ConsumerDraft {
  return createCanonicalCadDocumentV2({
    projectId: 'project-1', documentId: 'document-1', domains: ['building'],
    revision: { revisionId: 'revision-0', sequence: 0, contentSha256: h('0') },
    units: { length: 'mm', angle: 'deg' },
    coordinateFrame: { frameId: 'project-frame', parentFrameId: null, origin: [0, 0, 0], rotationDeg: [0, 0, 0] },
    tolerancePolicy: { linear: 0.01, angularDeg: 0.1 },
    objects: [object('building:wall-1', 100), object('building:space-1', 200)],
    relationships: [],
    sourceBindings: [{ schema: 'nexyfab.test.source.v1', revision: 'source-1', contentSha256: h('a') }],
  });
}

function command(
  base: CanonicalCadDocumentV2ConsumerDraft,
  operations: CanonicalCadOperationV2[],
  objectIds: string[],
  paths: string[],
) {
  return sealCanonicalCadCommandV2({
    commandId: 'agent-command-1', idempotencyKey: 'agent-idempotency-1',
    projectId: base.projectId, documentId: base.documentId, baseRevision: base.revision, nextRevisionId: 'revision-1',
    actor: { kind: 'agent', actorId: agentIdentity.agentId, agentIdentity },
    units: base.units, coordinateFrame: base.coordinateFrame, tolerancePolicy: base.tolerancePolicy,
    preconditions: {
      lockSetSha256: hashCanonicalCadLockSet([]), locks: [],
      selectedObjectIds: [...objectIds], parameterPaths: [...paths],
    },
    dependencies: [], compensationForCommandId: null, expectedChangedObjectIds: [...objectIds],
    artifacts: { inputs: [], expectedOutputs: [] },
    authorization: { permission: 'EDIT_DOCUMENT', riskClass: 'R3', approvalScope: 'document-1', approvalReceiptSha256: null },
    resourceBudget: { timeoutMs: 5_000, memoryMb: 512, maxIterations: 16, maxRetries: 0 },
    sideEffects: { canonicalDocument: true, externalTransmission: false, quoteOrRfq: false },
    verification: { verifierIds: ['canonical-structure'], blockers: [] },
    timing: { issuedAt, expiresAt },
    staleIf: { baseRevisionChanges: true, baseContentHashChanges: true },
    operations,
  });
}

function plan(base: CanonicalCadDocumentV2ConsumerDraft, proposal: ReturnType<typeof command>) {
  const descriptor = getAgenticCadToolDescriptor('spatial.object.commit')!;
  return createAgenticCadExecutionPlan({
    planId: 'agent-plan-1', projectId: base.projectId, documentId: base.documentId, domain: 'building',
    baseRevision: base.revision, lockSetSha256: hashCanonicalCadLockSet([]), agentIdentity,
    steps: [{
      stepId: 'step-1', toolId: 'spatial.object.commit',
      input: { artifactId: 'artifact:command-1', contentSha256: proposal.commandSha256, schema: descriptor.inputSchema },
      expectedChangedObjectIds: proposal.expectedChangedObjectIds,
      expectedOutputArtifactIds: ['artifact:candidate-document'],
      idempotencyKey: proposal.idempotencyKey,
      canonicalCommandSha256: proposal.commandSha256,
    }],
    issuedAt, expiresAt,
  });
}

describe('GP-07 canonical agent sandbox preview', () => {
  it('dry-runs bounded create/update/move/relate/host operations without mutating the base', () => {
    const base = document();
    const first = base.objects[0]!;
    const second = base.objects[1]!;
    const created = object('building:wall-2', 300);
    const relate = sealCanonicalCadRelationshipV2({
      relationshipId: 'relation-1', kind: 'RELATES', fromObjectId: first.objectId,
      toObjectId: second.objectId, relationshipRevision: 0, payload: {},
    });
    const host = sealCanonicalCadRelationshipV2({
      relationshipId: 'host-1', kind: 'HOST', fromObjectId: first.objectId,
      toObjectId: second.objectId, relationshipRevision: 0, payload: {},
    });
    const cases: Array<[CanonicalCadOperationV2, string[], string[]]> = [
      [{ kind: 'create', object: created }, [created.objectId], ['object']],
      [{ kind: 'update', objectId: first.objectId, expectedObjectContentSha256: first.contentSha256, payload: { width: 125 } }, [first.objectId], ['payload']],
      [{ kind: 'move', objectId: first.objectId, expectedObjectContentSha256: first.contentSha256, transform: { translation: [10, 0, 0], rotationDeg: [0, 0, 0] } }, [first.objectId], ['transform']],
      [{ kind: 'relate', mode: 'create', relationship: relate }, [first.objectId, second.objectId], ['relationships']],
      [{ kind: 'host', relationship: host }, [first.objectId, second.objectId], ['relationships']],
    ];

    for (const [operation, objectIds, paths] of cases) {
      const proposal = command(base, [operation], objectIds, paths);
      const draftPlan = plan(base, proposal);
      const before = structuredClone(base);
      const result = previewAgenticCanonicalCadCommand(draftPlan, proposal, base, { currentLocks: [], evaluatedAt });
      expect(validateAgenticCadCanonicalPreviewResult(result, draftPlan)).toEqual([]);
      expect(result).toMatchObject({
        ok: true, authority: 'SANDBOX_CANDIDATE_ONLY', receipt: { status: 'PASS', verification: 'NOT_AUTHORITATIVE', release: 'HOLD' },
      });
      expect(result.document.revision.sequence).toBe(1);
      expect(base).toEqual(before);
      if (!result.ok) throw new Error(result.issues.join(','));
      expect(evaluateAgenticCadExecutionPlan(draftPlan, {
        currentRevision: base.revision, currentLockSetSha256: hashCanonicalCadLockSet([]), evaluatedAt,
        permissions: ['EDIT_DOCUMENT'], dryRunReceipt: result.receipt,
      })).toMatchObject({ status: 'AWAITING_HUMAN_APPROVAL', authoritativeCommit: 'NOT_AUTHORIZED' });
    }
  });

  it('blocks direct R3 reduction and never converts the agent proposal into a commit', () => {
    const base = document();
    const created = object('building:wall-2', 300);
    const proposal = command(base, [{ kind: 'create', object: created }], [created.objectId], ['object']);
    expect(applyCanonicalCadCommandV2(base, proposal, { currentLocks: [], evaluatedAt })).toMatchObject({
      committed: false, issues: expect.arrayContaining(['trusted_approval_boundary_required']),
    });
    const preview = previewAgenticCanonicalCadCommand(plan(base, proposal), proposal, base, { currentLocks: [], evaluatedAt });
    expect(preview.authority).toBe('SANDBOX_CANDIDATE_ONLY');
    expect(preview.receipt?.authority).toBe('SANDBOX_EVIDENCE_ONLY');
  });

  it('holds delete, domain handlers, forged scope and a changed live lock set', () => {
    const base = document();
    const first = base.objects[0]!;
    const deletion = command(base, [{ kind: 'delete', objectId: first.objectId, expectedObjectContentSha256: first.contentSha256 }], [first.objectId], ['object']);
    expect(previewAgenticCanonicalCadCommand(plan(base, deletion), deletion, base, { currentLocks: [], evaluatedAt })).toMatchObject({
      ok: false, issues: expect.arrayContaining(['agent_preview_operation_hold:delete']), receipt: null,
    });
    const feature = command(base, [{ kind: 'feature', targetObjectId: first.objectId, payload: { featureId: 'cad.mechanical.extrude' } }], [first.objectId], ['feature']);
    expect(previewAgenticCanonicalCadCommand(plan(base, feature), feature, base, { currentLocks: [], evaluatedAt })).toMatchObject({
      ok: false, issues: expect.arrayContaining(['agent_preview_operation_hold:feature']),
    });

    const updated = command(base, [{ kind: 'update', objectId: first.objectId, expectedObjectContentSha256: first.contentSha256, payload: { width: 125 } }], [first.objectId], ['payload']);
    const forged = { ...updated, preconditions: { ...updated.preconditions, parameterPaths: ['payload.width'] }, commandSha256: '' };
    expect(previewAgenticCanonicalCadCommand(plan(base, updated), forged, base, { currentLocks: [], evaluatedAt })).toMatchObject({ ok: false });
    const liveLock = [{ lockId: 'lock-1', scope: 'object' as const, objectId: first.objectId, fieldPath: null, ownerActorId: 'reviewer-1', source: 'authority' as const }];
    const lockResult = previewAgenticCanonicalCadCommand(plan(base, updated), updated, base, { currentLocks: liveLock, evaluatedAt });
    expect(lockResult).toMatchObject({ ok: false, receipt: { status: 'HOLD' }, issues: expect.arrayContaining(['lock_snapshot_stale']) });
  });

  it('fails closed for plan/command binding drift and hostile objects', () => {
    const base = document();
    const created = object('building:wall-2', 300);
    const proposal = command(base, [{ kind: 'create', object: created }], [created.objectId], ['object']);
    const drifted = { ...plan(base, proposal), documentId: 'other' };
    expect(previewAgenticCanonicalCadCommand(drifted, proposal, base, { currentLocks: [], evaluatedAt })).toMatchObject({ ok: false });
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error('boom'); } });
    expect(() => previewAgenticCanonicalCadCommand(hostile, proposal, base, { currentLocks: [], evaluatedAt })).not.toThrow();
    expect(previewAgenticCanonicalCadCommand(hostile, proposal, base, { currentLocks: [], evaluatedAt })).toMatchObject({ ok: false });
    const valid = previewAgenticCanonicalCadCommand(plan(base, proposal), proposal, base, { currentLocks: [], evaluatedAt });
    expect(validateAgenticCadCanonicalPreviewResult({ ...valid, authority: 'TRUSTED' }, plan(base, proposal))).toContain('previewResult:contract');
    expect(() => validateAgenticCadCanonicalPreviewResult(hostile)).not.toThrow();
  });
});
