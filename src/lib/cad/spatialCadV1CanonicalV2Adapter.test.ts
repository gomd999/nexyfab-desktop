import { describe, expect, it } from 'vitest';
import {
  SPATIAL_CAD_COMMAND_SCHEMA,
  applySpatialCadCommand,
  createSpatialCadDocument,
  type SpatialCadCommand,
  type SpatialCadDocument,
} from './spatialCadCommand';
import { stableSpatialCadDocumentJson } from './spatialCadHash';
import { applyCanonicalCadCommandV2, hashCanonicalCadLockSet, validateCanonicalCadDocumentV2 } from './canonicalCadV2ConsumerDraft';
import {
  SPATIAL_CAD_V1_WRAPPER_KIND,
  canonicalCadV2ToSpatialCadV1,
  hashSpatialCadV1Document,
  spatialCadV1CommandToCanonicalCadV2,
  spatialCadV1ToCanonicalCadV2,
  type SpatialCadV1CanonicalContext,
  type SpatialCadV1CommandGovernance,
} from './spatialCadV1CanonicalV2Adapter';

const h = (character: string) => character.repeat(64);
const base = createSpatialCadDocument('civil', { lengthM: 120, lanes: 2 });

function context(document: SpatialCadDocument = base): SpatialCadV1CanonicalContext {
  return {
    projectId: 'project-1', documentId: 'civil-document-1', canonicalRevisionId: 'consumer-v2-r7',
    projectRevision: { revisionId: 'authoritative-v1-r7', sequence: 7, contentSha256: h('b') },
    expectedSpatialDocumentSha256: hashSpatialCadV1Document(document),
    units: { length: 'm', angle: 'deg' },
    coordinateFrame: { frameId: 'survey-frame', parentFrameId: null, origin: [0, 0, 0], rotationDeg: [0, 0, 0] },
    tolerancePolicy: { linear: 0.001, angularDeg: 0.01 },
  };
}

function governance(actor: 'human' | 'agent' = 'human'): SpatialCadV1CommandGovernance {
  return {
    nextRevisionId: 'consumer-v2-r8', idempotencyKey: 'spatial-command-1',
    actor: actor === 'human'
      ? { kind: 'human', actorId: 'user-1', agentIdentity: null }
      : { kind: 'agent', actorId: 'agent-actor-1', agentIdentity: { agentId: 'agent-1', modelId: 'model-1', promptSha256: h('a') } },
    preconditions: { lockSetSha256: hashCanonicalCadLockSet([]), locks: [], selectedObjectIds: ['legacy-spatial:civil:civil-document-1'], parameterPaths: ['payload.parameters'] },
    dependencies: [], artifacts: { inputs: [], expectedOutputs: [] },
    authorization: { permission: 'EDIT_DOCUMENT', riskClass: 'R2', approvalScope: 'civil-document-1', approvalReceiptSha256: null },
    resourceBudget: { timeoutMs: 10_000, memoryMb: 512, maxIterations: 10, maxRetries: 0 },
    verification: { verifierIds: ['spatial-v1-parity'], blockers: [] },
    timing: { issuedAt: '2026-08-24T00:00:00.000Z', expiresAt: '2026-08-24T01:00:00.000Z' },
  };
}

function setCommand(actor: 'human' | 'ai' = 'human'): SpatialCadCommand {
  return {
    schema: SPATIAL_CAD_COMMAND_SCHEMA, commandId: 'civil-command-1', domain: 'civil', baseRevision: 0, actor,
    operation: { kind: 'set_parameter', key: 'lengthM', value: 135 },
  };
}

function applyThroughV2(document: SpatialCadDocument, command: SpatialCadCommand, actor: 'human' | 'agent') {
  const canonical = spatialCadV1ToCanonicalCadV2(document, context(document));
  const adapted = spatialCadV1CommandToCanonicalCadV2({ document, canonicalDocument: canonical, command, governance: governance(actor) });
  if (!adapted.ok) throw new Error(adapted.issues.join(','));
  const applied = applyCanonicalCadCommandV2(canonical, adapted.command, {
    currentLocks: adapted.command.preconditions.locks,
    evaluatedAt: '2026-08-24T00:30:00.000Z',
  });
  if (!applied.committed) throw new Error(applied.issues.join(','));
  return { canonical, adapted, applied, projected: canonicalCadV2ToSpatialCadV1(applied.document) };
}

describe('spatial CAD v1 to canonical CAD v2 consumer-draft adapter', () => {
  it('round-trips the complete v1 document without inventing semantic objects', () => {
    const canonical = spatialCadV1ToCanonicalCadV2(base, context());
    expect(canonical).toMatchObject({
      authority: 'CONSUMER_DRAFT', modelVersion: 2, projectId: 'project-1', documentId: 'civil-document-1',
      revision: { revisionId: 'consumer-v2-r7', sequence: 7 }, verification: 'NOT_RUN', release: 'HOLD',
      objects: [{ objectId: 'legacy-spatial:civil:civil-document-1', namespace: 'civil', objectKind: SPATIAL_CAD_V1_WRAPPER_KIND, objectRevision: 0 }],
      relationships: [],
      sourceBindings: expect.arrayContaining([
        { schema: 'nexyfab.precision-cad.authoritative-project-revision-ref.v1', revision: 'authoritative-v1-r7:7', contentSha256: h('b') },
        { schema: base.schema, revision: 'document:0', contentSha256: hashSpatialCadV1Document(base) },
      ]),
    });
    const projected = canonicalCadV2ToSpatialCadV1(canonical);
    expect(stableSpatialCadDocumentJson(projected)).toBe(stableSpatialCadDocumentJson(base));
    expect(canonical.objects).toHaveLength(1);
  });

  it('keeps authoritative project revision and v1 document revision distinct', () => {
    const canonical = spatialCadV1ToCanonicalCadV2(base, context());
    expect(canonical.revision.sequence).toBe(7);
    expect(canonical.objects[0]?.objectRevision).toBe(0);
    expect((canonical.objects[0]?.payload as unknown as SpatialCadDocument).revision).toBe(0);
    expect(canonical.revision.contentSha256).not.toBe(hashSpatialCadV1Document(base));
    expect(canonical.sourceBindings.map(binding => binding.contentSha256)).toEqual(expect.arrayContaining([h('b'), hashSpatialCadV1Document(base)]));
  });

  it('matches direct v1 set_parameter application, changed paths, revision, ID, and actor', () => {
    const direct = applySpatialCadCommand(base, setCommand());
    if (!direct.committed) throw new Error(direct.issues.join(','));
    const through = applyThroughV2(base, setCommand(), 'human');
    expect(stableSpatialCadDocumentJson(through.projected)).toBe(stableSpatialCadDocumentJson(direct.document));
    expect(through.adapted.changedPaths).toEqual(direct.changedPaths);
    expect(through.adapted.command.commandId).toBe(setCommand().commandId);
    expect(through.adapted.command.actor).toMatchObject({ kind: 'human', actorId: 'user-1', agentIdentity: null });
    expect(through.applied.changedObjectIds).toEqual(['legacy-spatial:civil:civil-document-1']);
    expect(through.projected).toMatchObject({ revision: 1, updatedBy: 'human', parameters: { lengthM: 135, lanes: 2 } });
  });

  it('matches direct v1 replace_parameters application and maps AI only to an identified agent', () => {
    const replace: SpatialCadCommand = { ...setCommand('ai'), commandId: 'civil-command-replace', operation: { kind: 'replace_parameters', parameters: { lengthM: 150, lanes: 3 } } };
    const direct = applySpatialCadCommand(base, replace);
    if (!direct.committed) throw new Error(direct.issues.join(','));
    const through = applyThroughV2(base, replace, 'agent');
    expect(stableSpatialCadDocumentJson(through.projected)).toBe(stableSpatialCadDocumentJson(direct.document));
    expect(through.adapted.changedPaths).toEqual(direct.changedPaths);
    expect(through.adapted.command.actor).toMatchObject({ kind: 'agent', agentIdentity: { agentId: 'agent-1', modelId: 'model-1', promptSha256: h('a') } });
    expect(through.projected.updatedBy).toBe('ai');
  });

  it('supports two consecutive adapted v1 commands without collapsing source and live payload hashes', () => {
    const first = applyThroughV2(base, setCommand(), 'human');
    const secondCommand: SpatialCadCommand = {
      ...setCommand(), commandId: 'civil-command-2', baseRevision: 1,
      operation: { kind: 'set_parameter', key: 'lanes', value: 4 },
    };
    const adapted = spatialCadV1CommandToCanonicalCadV2({
      document: first.projected,
      canonicalDocument: first.applied.document,
      command: secondCommand,
      governance: { ...governance(), nextRevisionId: 'consumer-v2-r9', idempotencyKey: 'spatial-command-2' },
    });
    if (!adapted.ok) throw new Error(adapted.issues.join(','));
    const applied = applyCanonicalCadCommandV2(first.applied.document, adapted.command, {
      currentLocks: adapted.command.preconditions.locks,
      evaluatedAt: '2026-08-24T00:30:00.000Z',
    });
    if (!applied.committed) throw new Error(applied.issues.join(','));
    expect(canonicalCadV2ToSpatialCadV1(applied.document)).toMatchObject({ revision: 2, parameters: { lengthM: 135, lanes: 4 } });
    expect(applied.document.sourceBindings.map(binding => binding.contentSha256)).toContain(hashSpatialCadV1Document(base));
  });

  it('uses bounded deterministic derived IDs for maximum-length legacy identities', () => {
    const longContext = {
      ...context(), documentId: `d${'x'.repeat(127)}`,
      projectRevision: { ...context().projectRevision, revisionId: `r${'y'.repeat(127)}` },
    };
    const canonical = spatialCadV1ToCanonicalCadV2(base, longContext);
    expect(canonical.objects[0]!.objectId.length).toBeLessThanOrEqual(128);
    expect(canonical.sourceBindings[0]!.revision.length).toBeLessThanOrEqual(128);
    expect(validateCanonicalCadDocumentV2(canonical)).toEqual([]);
  });

  it('fails closed for stale document revision, tampered spatial hash, projection drift, and actor disguise', () => {
    const canonical = spatialCadV1ToCanonicalCadV2(base, context());
    const stale = { ...setCommand(), baseRevision: 2 };
    expect(spatialCadV1CommandToCanonicalCadV2({ document: base, canonicalDocument: canonical, command: stale, governance: governance() })).toMatchObject({ ok: false, issues: expect.arrayContaining(['legacy_document_revision_mismatch']) });
    expect(() => spatialCadV1ToCanonicalCadV2(base, { ...context(), expectedSpatialDocumentSha256: h('f') })).toThrow('spatial_document_content_hash_mismatch');
    const drifted = structuredClone(canonical); (drifted.objects[0]!.payload.parameters as Record<string, unknown>).lengthM = 999;
    expect(spatialCadV1CommandToCanonicalCadV2({ document: base, canonicalDocument: drifted, command: setCommand(), governance: governance() })).toMatchObject({ ok: false, issues: expect.arrayContaining(['document_hash_mismatch']) });
    expect(spatialCadV1CommandToCanonicalCadV2({ document: base, canonicalDocument: canonical, command: setCommand('ai'), governance: governance('human') })).toMatchObject({ ok: false, issues: expect.arrayContaining(['legacy_actor_mismatch']) });
    expect(spatialCadV1CommandToCanonicalCadV2({ document: base, canonicalDocument: canonical, command: { ...setCommand(), commandId: 'legacy command with spaces' }, governance: governance() })).toMatchObject({ ok: false, issues: expect.arrayContaining(['legacy_command_id_not_canonical']) });
    const cyclicParameters: Record<string, unknown> = {}; cyclicParameters.self = cyclicParameters;
    const cyclicDocument = { ...base, parameters: cyclicParameters } as SpatialCadDocument;
    expect(() => spatialCadV1CommandToCanonicalCadV2({ document: cyclicDocument, canonicalDocument: canonical, command: setCommand(), governance: governance() })).not.toThrow();
    expect(spatialCadV1CommandToCanonicalCadV2({ document: cyclicDocument, canonicalDocument: canonical, command: setCommand(), governance: governance() })).toMatchObject({ ok: false, issues: expect.arrayContaining(['invalid_document_parameters']) });
  });
});
