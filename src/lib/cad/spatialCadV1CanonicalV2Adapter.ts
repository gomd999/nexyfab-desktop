import { Sha256 } from '@aws-crypto/sha256-js';
import {
  applySpatialCadCommand,
  validateSpatialCadCommand,
  validateSpatialCadDocument,
  type SpatialCadCommand,
  type SpatialCadDocument,
  type SpatialCadDomain,
} from './spatialCadCommand';
import { stableSpatialCadDocumentJson } from './spatialCadHash';
import {
  createCanonicalCadDocumentV2,
  sealCanonicalCadCommandV2,
  sealCanonicalCadObjectV2,
  validateCanonicalCadDocumentV2,
  type CanonicalCadActor,
  type CanonicalCadArtifactBinding,
  type CanonicalCadAuthorization,
  type CanonicalCadCommandV2ConsumerDraft,
  type CanonicalCadCoordinateFrame,
  type CanonicalCadDocumentV2ConsumerDraft,
  type CanonicalCadJsonObject,
  type CanonicalCadPreconditions,
  type CanonicalCadResourceBudget,
  type CanonicalCadRevisionRef,
  type CanonicalCadTiming,
  type CanonicalCadTolerancePolicy,
  type CanonicalCadUnits,
  type CanonicalCadVerificationPlan,
} from './canonicalCadV2ConsumerDraft';

export const SPATIAL_CAD_V1_WRAPPER_KIND = 'legacy.spatial.parameters' as const;

export interface SpatialCadV1CanonicalContext {
  projectId: string;
  documentId: string;
  canonicalRevisionId: string;
  /** Authoritative v1 project head. Its hash is retained as a source binding. */
  projectRevision: CanonicalCadRevisionRef;
  /** Independently bound hash of the embedded spatial v1 document. */
  expectedSpatialDocumentSha256: string;
  units: CanonicalCadUnits;
  coordinateFrame: CanonicalCadCoordinateFrame;
  tolerancePolicy: CanonicalCadTolerancePolicy;
}

export interface SpatialCadV1CommandGovernance {
  nextRevisionId: string;
  idempotencyKey: string;
  actor: CanonicalCadActor;
  preconditions: CanonicalCadPreconditions;
  dependencies: string[];
  artifacts: { inputs: CanonicalCadArtifactBinding[]; expectedOutputs: CanonicalCadArtifactBinding[] };
  authorization: CanonicalCadAuthorization;
  resourceBudget: CanonicalCadResourceBudget;
  verification: CanonicalCadVerificationPlan;
  timing: CanonicalCadTiming;
}

export type SpatialCadV1CommandAdapterResult =
  | {
      ok: true;
      command: CanonicalCadCommandV2ConsumerDraft;
      expectedV1Document: SpatialCadDocument;
      changedPaths: string[];
    }
  | { ok: false; issues: string[] };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DOMAIN_MAP: Readonly<Record<SpatialCadDomain, SpatialCadDomain>> = {
  building: 'building',
  civil: 'civil',
  landscape: 'landscape',
  interior: 'interior',
  coordination: 'coordination',
};

function sha256(value: string): string {
  const hash = new Sha256();
  hash.update(value);
  return [...hash.digestSync()].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function hashSpatialCadV1Document(document: SpatialCadDocument): string {
  return sha256(stableSpatialCadDocumentJson(document));
}

export function spatialCadV1WrapperObjectId(domain: SpatialCadDomain, documentId: string): string {
  const direct = `legacy-spatial:${domain}:${documentId}`;
  return direct.length <= 128 ? direct : `legacy-spatial:${domain}:${sha256(documentId).slice(0, 32)}`;
}

function asJsonObject(value: unknown): CanonicalCadJsonObject {
  return structuredClone(value) as CanonicalCadJsonObject;
}

function validateContext(context: SpatialCadV1CanonicalContext, document: SpatialCadDocument): string[] {
  const issues: string[] = [];
  if (!ID.test(context.projectId)) issues.push('project_id_invalid');
  if (!ID.test(context.documentId)) issues.push('document_id_invalid');
  if (!ID.test(context.canonicalRevisionId)) issues.push('canonical_revision_id_invalid');
  if (!ID.test(context.projectRevision.revisionId)
    || !Number.isSafeInteger(context.projectRevision.sequence) || context.projectRevision.sequence < 0
    || !SHA256.test(context.projectRevision.contentSha256)) issues.push('project_revision_invalid');
  try {
    const currentHash = hashSpatialCadV1Document(document);
    if (!SHA256.test(context.expectedSpatialDocumentSha256) || context.expectedSpatialDocumentSha256 !== currentHash) issues.push('spatial_document_content_hash_mismatch');
  } catch {
    issues.push('spatial_document_hash_invalid');
  }
  return issues;
}

function boundedSourceRevision(value: string): string {
  return value.length <= 128 ? value : `sha256:${sha256(value)}`;
}

/**
 * Lossless compatibility projection. It deliberately creates one legacy
 * wrapper object and never infers walls, roads, features, or other semantics
 * from parameter names.
 */
export function spatialCadV1ToCanonicalCadV2(
  document: SpatialCadDocument,
  context: SpatialCadV1CanonicalContext,
): CanonicalCadDocumentV2ConsumerDraft {
  const issues = validateSpatialCadDocument(document);
  if (issues.length) throw new Error(issues.join(','));
  issues.push(...validateContext(context, document));
  if (issues.length) throw new Error(issues.join(','));
  const sourceHash = hashSpatialCadV1Document(document);
  const object = sealCanonicalCadObjectV2({
    objectId: spatialCadV1WrapperObjectId(document.domain, context.documentId),
    namespace: DOMAIN_MAP[document.domain],
    objectKind: SPATIAL_CAD_V1_WRAPPER_KIND,
    objectRevision: document.revision,
    payload: asJsonObject(document),
    transform: null,
  });
  return createCanonicalCadDocumentV2({
    projectId: context.projectId,
    documentId: context.documentId,
    domains: [DOMAIN_MAP[document.domain]],
    revision: { revisionId: context.canonicalRevisionId, sequence: context.projectRevision.sequence, contentSha256: '0'.repeat(64) },
    units: structuredClone(context.units),
    coordinateFrame: structuredClone(context.coordinateFrame),
    tolerancePolicy: structuredClone(context.tolerancePolicy),
    objects: [object],
    relationships: [],
    sourceBindings: [
      {
        schema: 'nexyfab.precision-cad.authoritative-project-revision-ref.v1',
        revision: boundedSourceRevision(`${context.projectRevision.revisionId}:${context.projectRevision.sequence}`),
        contentSha256: context.projectRevision.contentSha256,
      },
      { schema: document.schema, revision: `document:${document.revision}`, contentSha256: sourceHash },
    ],
  });
}

export function canonicalCadV2ToSpatialCadV1(
  document: CanonicalCadDocumentV2ConsumerDraft,
): SpatialCadDocument {
  const issues = validateCanonicalCadDocumentV2(document);
  if (issues.length) throw new Error(issues.join(','));
  if (document.objects.length !== 1 || document.relationships.length !== 0) throw new Error('legacy_wrapper_shape_required');
  const wrapper = document.objects[0];
  if (!wrapper || wrapper.objectKind !== SPATIAL_CAD_V1_WRAPPER_KIND || wrapper.transform !== null) throw new Error('legacy_wrapper_shape_required');
  const candidate = structuredClone(wrapper.payload) as unknown as SpatialCadDocument;
  const candidateIssues = validateSpatialCadDocument(candidate);
  if (candidateIssues.length || candidate.domain !== wrapper.namespace || candidate.revision !== wrapper.objectRevision) throw new Error(['legacy_payload_invalid', ...candidateIssues].join(','));
  if (!document.sourceBindings.some(binding => binding.schema === candidate.schema)) throw new Error('legacy_source_binding_missing');
  return candidate;
}

/**
 * Adapts a reviewed v1 command without weakening its document-revision guard.
 * The resulting v2 base binds the distinct authoritative project revision.
 */
export function spatialCadV1CommandToCanonicalCadV2(input: {
  document: SpatialCadDocument;
  canonicalDocument: CanonicalCadDocumentV2ConsumerDraft;
  command: SpatialCadCommand;
  governance: SpatialCadV1CommandGovernance;
}): SpatialCadV1CommandAdapterResult {
  const issues = [
    ...validateSpatialCadDocument(input.document),
    ...validateSpatialCadCommand(input.command),
    ...validateCanonicalCadDocumentV2(input.canonicalDocument),
  ];
  if (input.command.baseRevision !== input.document.revision) issues.push('legacy_document_revision_mismatch');
  if (input.command.domain !== input.document.domain) issues.push('legacy_domain_mismatch');
  if ((input.command.actor === 'human' && input.governance.actor.kind !== 'human')
    || (input.command.actor === 'ai' && input.governance.actor.kind !== 'agent')) issues.push('legacy_actor_mismatch');
  if (!ID.test(input.command.commandId)) issues.push('legacy_command_id_not_canonical');
  if (input.canonicalDocument.projectId.length === 0 || input.canonicalDocument.documentId.length === 0) issues.push('canonical_identity_invalid');
  if (issues.length) return { ok: false, issues: [...new Set(issues)] };
  let projected: SpatialCadDocument | null = null;
  try { projected = canonicalCadV2ToSpatialCadV1(input.canonicalDocument); }
  catch { issues.push('canonical_legacy_projection_invalid'); }
  if (projected && stableSpatialCadDocumentJson(projected) !== stableSpatialCadDocumentJson(input.document)) issues.push('canonical_legacy_projection_stale');
  if (!input.canonicalDocument.sourceBindings.some(binding => binding.schema === input.document.schema)) issues.push('legacy_source_binding_missing');
  if (issues.length) return { ok: false, issues: [...new Set(issues)] };

  const legacy = applySpatialCadCommand(input.document, input.command);
  if (!legacy.committed) return { ok: false, issues: legacy.issues };
  const wrapper = input.canonicalDocument.objects[0]!;
  try {
    const command = sealCanonicalCadCommandV2({
      commandId: input.command.commandId,
      idempotencyKey: input.governance.idempotencyKey,
      projectId: input.canonicalDocument.projectId,
      documentId: input.canonicalDocument.documentId,
      baseRevision: structuredClone(input.canonicalDocument.revision),
      nextRevisionId: input.governance.nextRevisionId,
      actor: structuredClone(input.governance.actor),
      units: structuredClone(input.canonicalDocument.units),
      coordinateFrame: structuredClone(input.canonicalDocument.coordinateFrame),
      tolerancePolicy: structuredClone(input.canonicalDocument.tolerancePolicy),
      preconditions: structuredClone(input.governance.preconditions),
      dependencies: structuredClone(input.governance.dependencies),
      compensationForCommandId: null,
      expectedChangedObjectIds: [wrapper.objectId],
      artifacts: structuredClone(input.governance.artifacts),
      authorization: structuredClone(input.governance.authorization),
      resourceBudget: structuredClone(input.governance.resourceBudget),
      sideEffects: { canonicalDocument: true, externalTransmission: false, quoteOrRfq: false },
      verification: structuredClone(input.governance.verification),
      timing: structuredClone(input.governance.timing),
      staleIf: { baseRevisionChanges: true, baseContentHashChanges: true },
      operations: [{
        kind: 'update',
        objectId: wrapper.objectId,
        expectedObjectContentSha256: wrapper.contentSha256,
        payload: asJsonObject(legacy.document),
      }],
    });
    return { ok: true, command, expectedV1Document: legacy.document, changedPaths: legacy.changedPaths };
  } catch (error) {
    return { ok: false, issues: [error instanceof Error ? error.message : 'canonical_command_invalid'] };
  }
}
