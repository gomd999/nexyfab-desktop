import { describe, expect, it } from 'vitest';
import {
  applyCanonicalCadCommandV2,
  canonicalCadConsumerDraftJson,
  createCanonicalCadDocumentV2,
  hashCanonicalCadDocumentV2,
  hashCanonicalCadLockSet,
  sealCanonicalCadCommandV2,
  sealCanonicalCadObjectV2,
  sealCanonicalCadRelationshipV2,
  validateCanonicalCadCommandV2,
  validateCanonicalCadDocumentV2,
  type CanonicalCadCommandV2ConsumerDraft,
  type CanonicalCadDocumentV2ConsumerDraft,
  type CanonicalCadObjectV2,
  type CanonicalCadOperationV2,
} from './canonicalCadV2ConsumerDraft';

const h = (character: string) => character.repeat(64);
const units = { length: 'mm' as const, angle: 'deg' as const };
const coordinateFrame = { frameId: 'project-frame', parentFrameId: null, origin: [0, 0, 0] as const, rotationDeg: [0, 0, 0] as const };
const tolerancePolicy = { linear: 0.01, angularDeg: 0.1 };

function object(objectId = 'building:wall-1', payload = { width: 1000 }): CanonicalCadObjectV2 {
  return sealCanonicalCadObjectV2({ objectId, namespace: 'building', objectKind: 'building.wall', objectRevision: 0, payload, transform: null });
}

function document(objects: CanonicalCadObjectV2[] = [object()]): CanonicalCadDocumentV2ConsumerDraft {
  return createCanonicalCadDocumentV2({
    projectId: 'project-1', documentId: 'document-1', domains: ['building'],
    revision: { revisionId: 'revision-0', sequence: 0, contentSha256: h('0') },
    units, coordinateFrame, tolerancePolicy, objects, relationships: [],
    sourceBindings: [{ schema: 'nexyfab.source.v1', revision: 'source-1', contentSha256: h('a') }],
  });
}

function command(
  base: CanonicalCadDocumentV2ConsumerDraft,
  operations: CanonicalCadOperationV2[],
  expectedChangedObjectIds: string[],
  overrides: Partial<CanonicalCadCommandV2ConsumerDraft> = {},
): CanonicalCadCommandV2ConsumerDraft {
  const sealed = sealCanonicalCadCommandV2({
    commandId: 'command-1', idempotencyKey: 'idempotency-1', projectId: base.projectId, documentId: base.documentId,
    baseRevision: base.revision, nextRevisionId: 'revision-1',
    actor: { kind: 'human', actorId: 'user-1', agentIdentity: null },
    units: base.units, coordinateFrame: base.coordinateFrame, tolerancePolicy: base.tolerancePolicy,
    preconditions: { lockSetSha256: hashCanonicalCadLockSet([]), locks: [], selectedObjectIds: [], parameterPaths: [] },
    dependencies: [], compensationForCommandId: null, expectedChangedObjectIds, artifacts: { inputs: [], expectedOutputs: [] },
    authorization: { permission: 'EDIT_DOCUMENT', riskClass: 'R2', approvalScope: 'document-1', approvalReceiptSha256: null },
    resourceBudget: { timeoutMs: 10_000, memoryMb: 512, maxIterations: 10, maxRetries: 0 },
    sideEffects: { canonicalDocument: true, externalTransmission: false, quoteOrRfq: false },
    verification: { verifierIds: ['canonical-structure'], blockers: [] },
    timing: { issuedAt: '2026-08-24T00:00:00.000Z', expiresAt: '2026-08-24T01:00:00.000Z' },
    staleIf: { baseRevisionChanges: true, baseContentHashChanges: true }, operations,
  });
  if (!Object.keys(overrides).length) return sealed;
  const candidate = { ...sealed, ...structuredClone(overrides), commandSha256: '' } as CanonicalCadCommandV2ConsumerDraft;
  return sealCanonicalCadCommandV2(candidate as Omit<CanonicalCadCommandV2ConsumerDraft, 'schema' | 'contractVersion' | 'modelVersion' | 'commandSha256'>);
}

function applyDraft(
  base: CanonicalCadDocumentV2ConsumerDraft,
  draftCommand: CanonicalCadCommandV2ConsumerDraft,
  currentLocks = draftCommand.preconditions.locks,
  evaluatedAt = '2026-08-24T00:30:00.000Z',
) {
  return applyCanonicalCadCommandV2(base, draftCommand, { currentLocks, evaluatedAt });
}

describe('canonical CAD v2 Precision consumer draft', () => {
  it('uses stable object-key canonicalization while preserving authored array order', () => {
    expect(canonicalCadConsumerDraftJson({ b: 2, a: { d: 4, c: 3 } })).toBe(canonicalCadConsumerDraftJson({ a: { c: 3, d: 4 }, b: 2 }));
    expect(canonicalCadConsumerDraftJson({ values: [1, 2] })).not.toBe(canonicalCadConsumerDraftJson({ values: [2, 1] }));
  });

  it('applies an atomic structural update, advances one revision, and stays draft/HOLD', () => {
    const base = document(); const before = structuredClone(base);
    const update = command(base, [{ kind: 'update', objectId: base.objects[0]!.objectId, expectedObjectContentSha256: base.objects[0]!.contentSha256, payload: { width: 1250 } }], ['building:wall-1']);
    const result = applyDraft(base, update);
    expect(result).toMatchObject({ committed: true, authority: 'CONSUMER_DRAFT', changedObjectIds: ['building:wall-1'], document: { revision: { revisionId: 'revision-1', sequence: 1 }, verification: 'NOT_RUN', release: 'HOLD' } });
    if (!result.committed) throw new Error('expected commit');
    expect(result.document.objects[0]?.payload).toEqual({ width: 1250 });
    expect(result.document.revision.contentSha256).toBe(hashCanonicalCadDocumentV2(result.document));
    expect(base).toEqual(before);
  });

  it('fails closed for stale revision, object hash conflict, no-op, and changed-set mismatch', () => {
    const base = document(); const target = base.objects[0]!;
    const operation: CanonicalCadOperationV2 = { kind: 'update', objectId: target.objectId, expectedObjectContentSha256: target.contentSha256, payload: { width: 1250 } };
    expect(applyDraft(base, command(base, [operation], [target.objectId], { baseRevision: { ...base.revision, sequence: 9 } }))).toMatchObject({ committed: false, issues: expect.arrayContaining(['stale_base_revision']) });
    expect(applyDraft(base, command(base, [{ ...operation, expectedObjectContentSha256: h('f') }], [target.objectId]))).toMatchObject({ committed: false, issues: ['object_hash_conflict'] });
    expect(applyDraft(base, command(base, [{ ...operation, payload: target.payload }], [target.objectId]))).toMatchObject({ committed: false, issues: ['no_effect'] });
    expect(applyDraft(base, command(base, [operation], ['building:other']))).toMatchObject({ committed: false, issues: ['changed_object_set_mismatch'] });
    const transient = object('building:transient');
    expect(applyDraft(base, command(base, [
      { kind: 'create', object: transient },
      { kind: 'delete', objectId: transient.objectId, expectedObjectContentSha256: transient.contentSha256 },
    ], [transient.objectId]))).toMatchObject({ committed: false, issues: ['no_effect'] });
  });

  it('binds the lock snapshot and blocks authority or another actor lock', () => {
    const base = document(); const target = base.objects[0]!;
    const operation: CanonicalCadOperationV2 = { kind: 'update', objectId: target.objectId, expectedObjectContentSha256: target.contentSha256, payload: { width: 1250 } };
    const locks = [{ lockId: 'lock-1', scope: 'object' as const, objectId: target.objectId, fieldPath: null, ownerActorId: 'reviewer-1', source: 'human' as const }];
    const blocked = command(base, [operation], [target.objectId], { preconditions: { lockSetSha256: hashCanonicalCadLockSet(locks), locks, selectedObjectIds: [target.objectId], parameterPaths: ['payload.width'] } });
    expect(applyDraft(base, blocked)).toMatchObject({ committed: false, issues: ['protected_by_lock'] });
    const fieldLocks = [{ lockId: 'lock-field', scope: 'field' as const, objectId: target.objectId, fieldPath: 'payload.width', ownerActorId: 'reviewer-1', source: 'authority' as const }];
    const blockedDelete = command(base, [{ kind: 'delete', objectId: target.objectId, expectedObjectContentSha256: target.contentSha256 }], [target.objectId], { preconditions: { lockSetSha256: hashCanonicalCadLockSet(fieldLocks), locks: fieldLocks, selectedObjectIds: [target.objectId], parameterPaths: ['object'] } });
    expect(applyDraft(base, blockedDelete)).toMatchObject({ committed: false, issues: ['protected_by_lock'] });
    expect(validateCanonicalCadCommandV2({ ...blocked, preconditions: { ...blocked.preconditions, lockSetSha256: h('f') } })).toEqual(expect.arrayContaining(['lock_set_hash_mismatch', 'command_hash_mismatch']));
  });

  it('binds live lock/time context and enforces mutation risk policy', () => {
    const base = document(); const target = base.objects[0]!;
    const operation: CanonicalCadOperationV2 = { kind: 'update', objectId: target.objectId, expectedObjectContentSha256: target.contentSha256, payload: { width: 1250 } };
    const draft = command(base, [operation], [target.objectId]);
    const liveLocks = [{ lockId: 'lock-live', scope: 'object' as const, objectId: target.objectId, fieldPath: null, ownerActorId: 'reviewer-1', source: 'authority' as const }];
    expect(applyDraft(base, draft, liveLocks)).toMatchObject({ committed: false, issues: expect.arrayContaining(['lock_snapshot_stale']) });
    expect(applyDraft(base, draft, [], '2026-08-24T01:00:00.000Z')).toMatchObject({ committed: false, issues: expect.arrayContaining(['command_expired']) });
    const lowRisk = command(base, [operation], [target.objectId], { authorization: { ...draft.authorization, riskClass: 'R1' } });
    expect(applyDraft(base, lowRisk)).toMatchObject({ committed: false, issues: expect.arrayContaining(['mutation_risk_class_too_low']) });
    const unapproved = command(base, [operation], [target.objectId], { authorization: { ...draft.authorization, riskClass: 'R3', approvalReceiptSha256: null } });
    expect(applyDraft(base, unapproved)).toMatchObject({ committed: false, issues: expect.arrayContaining(['trusted_approval_boundary_required']) });
    const forgedApproval = command(base, [operation], [target.objectId], { authorization: { ...draft.authorization, riskClass: 'R3', approvalReceiptSha256: h('c') } });
    expect(applyDraft(base, forgedApproval)).toMatchObject({ committed: false, issues: expect.arrayContaining(['trusted_approval_boundary_required']) });
  });

  it('rolls back a whole batch when a domain handler is required', () => {
    const base = document();
    const created = object('building:wall-2', { width: 500 });
    const result = applyDraft(base, command(base, [
      { kind: 'create', object: created },
      { kind: 'feature', targetObjectId: created.objectId, payload: { featureKind: 'extrude' } },
    ], [created.objectId]));
    expect(result).toMatchObject({ committed: false, document: base, issues: ['domain_handler_required:feature'] });
    expect(base.objects.map(item => item.objectId)).toEqual(['building:wall-1']);
  });

  it('moves with object-hash CAS and can explicitly unlink before deleting an object', () => {
    const first = object('building:wall-1'); const second = object('building:space-1');
    const relation = sealCanonicalCadRelationshipV2({ relationshipId: 'relation-1', kind: 'RELATES', fromObjectId: first.objectId, toObjectId: second.objectId, relationshipRevision: 0, payload: {} });
    const base = createCanonicalCadDocumentV2({
      projectId: 'project-1', documentId: 'document-1', domains: ['building'], revision: { revisionId: 'revision-0', sequence: 0, contentSha256: h('0') },
      units, coordinateFrame, tolerancePolicy, objects: [first, second], relationships: [relation],
      sourceBindings: [{ schema: 'source', revision: '1', contentSha256: h('a') }],
    });
    const moved = applyDraft(base, command(base, [{ kind: 'move', objectId: first.objectId, expectedObjectContentSha256: first.contentSha256, transform: { translation: [10, 0, 0], rotationDeg: [0, 0, 0] } }], [first.objectId]));
    expect(moved.committed).toBe(true);
    expect(moved.document.objects.find(item => item.objectId === first.objectId)?.transform?.translation).toEqual([10, 0, 0]);
    const removed = applyDraft(base, command(base, [
      { kind: 'relate', mode: 'delete', relationshipId: relation.relationshipId, expectedRelationshipContentSha256: relation.contentSha256 },
      { kind: 'delete', objectId: first.objectId, expectedObjectContentSha256: first.contentSha256 },
    ], [first.objectId, second.objectId]));
    expect(removed).toMatchObject({ committed: true, changedRelationshipIds: ['relation-1'], document: { objects: [{ objectId: second.objectId }], relationships: [] } });
  });

  it('rejects dangling and cyclic HOST/UPSTREAM relationships without exposing a candidate', () => {
    const first = object('building:wall-1'); const second = object('building:space-1');
    const host = sealCanonicalCadRelationshipV2({ relationshipId: 'host-1', kind: 'HOST', fromObjectId: first.objectId, toObjectId: second.objectId, relationshipRevision: 0, payload: {} });
    const base = createCanonicalCadDocumentV2({
      projectId: 'project-1', documentId: 'document-1', domains: ['building'], revision: { revisionId: 'revision-0', sequence: 0, contentSha256: h('0') },
      units, coordinateFrame, tolerancePolicy, objects: [first, second], relationships: [host],
      sourceBindings: [{ schema: 'source', revision: '1', contentSha256: h('a') }],
    });
    const reverse = sealCanonicalCadRelationshipV2({ relationshipId: 'host-2', kind: 'HOST', fromObjectId: second.objectId, toObjectId: first.objectId, relationshipRevision: 0, payload: {} });
    expect(applyDraft(base, command(base, [{ kind: 'host', relationship: reverse }], [first.objectId, second.objectId]))).toMatchObject({ committed: false, document: base, issues: expect.arrayContaining([expect.stringContaining('result:relationship_cycle:')]) });
    const dangling = { ...reverse, relationshipId: 'host-3', toObjectId: 'building:missing', contentSha256: '' };
    const sealedDangling = sealCanonicalCadRelationshipV2(dangling);
    expect(applyDraft(base, command(base, [{ kind: 'host', relationship: sealedDangling }], [second.objectId]))).toMatchObject({ committed: false, issues: ['relationship_object_missing'] });
  });

  it('detects document and command tampering and blocks authority promotion', () => {
    const base = document();
    const promoted = { ...base, authority: 'AUTHORITATIVE', verification: 'PASS', release: 'RELEASED' };
    expect(validateCanonicalCadDocumentV2(promoted)).toEqual(expect.arrayContaining(['authority_invalid', 'verification_promotion_blocked', 'release_promotion_blocked']));
    const update = command(base, [{ kind: 'update', objectId: base.objects[0]!.objectId, expectedObjectContentSha256: base.objects[0]!.contentSha256, payload: { width: 1250 } }], ['building:wall-1']);
    expect(validateCanonicalCadCommandV2({ ...update, projectId: 'tampered' })).toContain('command_hash_mismatch');
    expect(validateCanonicalCadCommandV2({ ...update, unexpected: true })).toEqual(['command_keys_invalid']);
  });

  it('rejects dangerous, undefined, non-finite, and cyclic JSON values', () => {
    expect(() => canonicalCadConsumerDraftJson({ value: Number.NaN })).toThrow('invalid_canonical_json');
    expect(() => canonicalCadConsumerDraftJson({ value: undefined })).toThrow('invalid_canonical_json');
    const poisoned = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(poisoned, '__proto__', { value: 1, enumerable: true });
    expect(() => canonicalCadConsumerDraftJson(poisoned)).toThrow('invalid_canonical_json');
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => canonicalCadConsumerDraftJson(cyclic)).toThrow('invalid_canonical_json');
    const symbolKeyed = { value: 1 } as Record<PropertyKey, unknown>; symbolKeyed[Symbol('hidden')] = 2;
    expect(() => canonicalCadConsumerDraftJson(symbolKeyed)).toThrow('invalid_canonical_json');
    const nonEnumerable = { value: 1 }; Object.defineProperty(nonEnumerable, 'hidden', { value: 2, enumerable: false });
    expect(() => canonicalCadConsumerDraftJson(nonEnumerable)).toThrow('invalid_canonical_json');
  });

  it('returns validation issues instead of throwing for malformed or oversized arrays', () => {
    const base = document();
    expect(() => validateCanonicalCadDocumentV2({ ...base, relationships: [null] })).not.toThrow();
    expect(validateCanonicalCadDocumentV2({ ...base, relationships: [null] })).toEqual(expect.arrayContaining(['relationships[0]_keys_invalid']));
    expect(() => validateCanonicalCadDocumentV2({ ...base, domains: {} })).not.toThrow();
    const draft = command(base, [{ kind: 'update', objectId: base.objects[0]!.objectId, expectedObjectContentSha256: base.objects[0]!.contentSha256, payload: { width: 1250 } }], [base.objects[0]!.objectId]);
    expect(() => validateCanonicalCadCommandV2({ ...draft, dependencies: {} })).not.toThrow();
    expect(validateCanonicalCadCommandV2({ ...draft, verification: { verifierIds: Array.from({ length: 1001 }, (_, index) => `verifier-${index}`), blockers: [] } })).toContain('verification_plan_invalid');
  });
});
