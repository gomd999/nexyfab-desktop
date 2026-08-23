import {
  aiCandidateChangedTargets,
  createAiCanonicalCandidate,
  guardAiCanonicalCandidate,
  markAiCanonicalCandidateApplied,
  type AiCanonicalCandidate,
  type AiCandidateLock,
} from './aiCanonicalCandidate';
import {
  applySpatialCadCommand,
  type SpatialCadCommand,
  type SpatialCadDocument,
  type SpatialCadDomain,
  type SpatialCadParameters,
  type SpatialCadTransaction,
  type SpatialCadValue,
} from '@/lib/cad/spatialCadCommand';
import type { SpatialDesignBriefHandoffV2 } from './spatialDesignBriefHandoff';
import { modelContentRevision } from './selectionContext';

export const SPATIAL_AI_CANDIDATE_SCHEMA = 'nexyfab.spatial-ai-candidate.v1' as const;
// Spatial workspaces use stable unit-labelled identities such as
// `building width (mm)` and `cross slope (%)`.
const PATH = /^[A-Za-z0-9_.%() -]+$/;
const FORBIDDEN_PATHS = new Set(['__proto__', 'prototype', 'constructor']);
const SHA256 = /^[a-f0-9]{64}$/;

export type SpatialAiCandidateOperation =
  | { kind: 'set_parameter'; path: string; value: SpatialCadValue }
  | { kind: 'replace_parameters'; parameters: SpatialCadParameters };

export interface SpatialAiCandidate {
  schema: typeof SPATIAL_AI_CANDIDATE_SCHEMA;
  id: string;
  domain: SpatialCadDomain;
  documentId: string;
  baseDocumentRevision: number;
  contentHash: string;
  parameterPaths: string[];
  locks: AiCandidateLock[];
  mode: 'new_design' | 'request_only_edit';
  operation: SpatialAiCandidateOperation;
  canonical: AiCanonicalCandidate;
  /** Content token for the exact proposal shown during review. */
  reviewRevision: string;
}

export interface SpatialAiCandidateGuardResult {
  allowed: boolean;
  issues: string[];
  blockedLockIds: string[];
}

export function isSpatialAiCandidate(value: unknown): value is SpatialAiCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<SpatialAiCandidate>;
  if (item.schema !== SPATIAL_AI_CANDIDATE_SCHEMA || typeof item.id !== 'string' || !item.id.trim()
    || typeof item.documentId !== 'string' || !item.documentId.trim() || typeof item.contentHash !== 'string' || !SHA256.test(item.contentHash)
    || !Number.isSafeInteger(item.baseDocumentRevision) || (item.baseDocumentRevision ?? -1) < 0
    || !Array.isArray(item.parameterPaths) || item.parameterPaths.some(path => typeof path !== 'string' || !validPath(path))
    || (item.mode !== 'new_design' && item.mode !== 'request_only_edit') || !item.operation || typeof item.operation !== 'object'
    || !item.canonical || typeof item.canonical !== 'object') return false;
  const operation = item.operation as Partial<SpatialAiCandidateOperation>;
  if (operation.kind === 'set_parameter') {
    if (typeof operation.path !== 'string' || !validPath(operation.path) || !isScalar(operation.value)) return false;
  } else if (operation.kind === 'replace_parameters') {
    if (!operation.parameters || typeof operation.parameters !== 'object' || Array.isArray(operation.parameters)
      || Object.entries(operation.parameters).some(([path, value]) => !validPath(path) || !isScalar(value))) return false;
  } else return false;
  const canonical = item.canonical as Partial<AiCanonicalCandidate>;
  const { reviewRevision, ...reviewedCandidate } = item as SpatialAiCandidate;
  return typeof reviewRevision === 'string'
    && reviewRevision === modelContentRevision(reviewMaterial(reviewedCandidate as Omit<SpatialAiCandidate, 'reviewRevision'>))
    && canonical.schema === 'nexyfab.ai-canonical-candidate.v1'
    && typeof canonical.id === 'string' && canonical.id === item.id
    && canonical.state === 'PREVIEW';
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function validPath(path: string): boolean {
  return path.length > 0 && path.length <= 160 && path === path.trim() && PATH.test(path)
    && !path.includes('[') && !FORBIDDEN_PATHS.has(path);
}

function canonicalPayload(operation: SpatialAiCandidateOperation, documentId: string, paths: string[]): Record<string, unknown> {
  if (operation.kind === 'set_parameter') {
    return { intents: [{ kind: 'update_param', featureId: documentId, paramKey: operation.path, value: operation.value }] };
  }
  return { intents: paths.map(path => ({ kind: 'update_param', featureId: documentId, paramKey: path, value: operation.parameters[path] })) };
}

function lockList(locks: SpatialDesignBriefHandoffV2['locks']): AiCandidateLock[] {
  return locks.map(lock => ({ id: lock.id, target: lock.target }));
}

function reviewMaterial(candidate: Omit<SpatialAiCandidate, 'reviewRevision'>): unknown {
  return candidate;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createSpatialAiCandidate(input: {
  handoff: SpatialDesignBriefHandoffV2;
  operation: SpatialAiCandidateOperation;
  id: string;
  summary: string;
  now?: string;
}): SpatialAiCandidate {
  const { handoff, operation } = input;
  const paths = [...new Set(handoff.parameterPaths)];
  const issues: string[] = [];
  if (!input.id.trim()) issues.push('missing_candidate_id');
  if (handoff.mode === 'request_only_edit' && operation.kind !== 'set_parameter') issues.push('request_only_requires_set_parameter');
  if (handoff.mode === 'new_design' && operation.kind !== 'replace_parameters') issues.push('new_design_requires_replace_parameters');
  if (!paths.length) issues.push('missing_parameter_paths');
  if (paths.some(path => !validPath(path))) issues.push('invalid_parameter_path');
  if (operation.kind === 'set_parameter') {
    if (!validPath(operation.path) || !paths.includes(operation.path)) issues.push('parameter_path_outside_explicit_scope');
    if (!isScalar(operation.value)) issues.push('object_or_array_parameter_blocked');
    if (handoff.mode === 'request_only_edit' && paths.length !== 1) issues.push('request_only_scope_must_name_one_parameter');
  } else {
    const keys = Object.keys(operation.parameters);
    if (keys.some(path => !paths.includes(path) || !validPath(path))) issues.push('replacement_path_outside_explicit_scope');
    if (Object.values(operation.parameters).some(value => !isScalar(value))) issues.push('object_or_array_parameter_blocked');
  }
  const locks = lockList(handoff.locks);
  const canonical = createAiCanonicalCandidate({
    id: input.id,
    kind: 'intent',
    baseRevision: String(handoff.baseDocumentRevision),
    summary: input.summary,
    payload: canonicalPayload(operation, handoff.documentId, paths),
    locks,
    scope: { mode: handoff.mode, featureId: handoff.documentId },
    now: input.now,
  });
  if (issues.length) {
    canonical.issues = [...new Set([...canonical.issues, ...issues])];
    canonical.state = 'BLOCKED';
  }
  const candidate = { schema: SPATIAL_AI_CANDIDATE_SCHEMA, id: input.id, domain: handoff.domain, documentId: handoff.documentId, baseDocumentRevision: handoff.baseDocumentRevision, contentHash: handoff.contentHash, parameterPaths: paths, locks, mode: handoff.mode, operation: structuredClone(operation), canonical } satisfies Omit<SpatialAiCandidate, 'reviewRevision'>;
  return { ...candidate, reviewRevision: modelContentRevision(reviewMaterial(candidate)) };
}

export function guardSpatialAiCandidate(input: {
  candidate: SpatialAiCandidate;
  currentDocument: SpatialCadDocument;
  currentDocumentId: string;
  currentContentHash: string;
  currentLocks?: readonly AiCandidateLock[];
}): SpatialAiCandidateGuardResult {
  const { candidate, currentDocument } = input;
  const issues: string[] = [];
  if (candidate.schema !== SPATIAL_AI_CANDIDATE_SCHEMA) issues.push('invalid_spatial_candidate_schema');
  if (candidate.domain !== currentDocument.domain) issues.push('spatial_candidate_domain_mismatch');
  if (candidate.documentId.trim() === '') issues.push('missing_spatial_document_id');
  if (candidate.documentId !== input.currentDocumentId) issues.push('spatial_candidate_document_mismatch');
  if (candidate.baseDocumentRevision !== currentDocument.revision) issues.push('stale_spatial_document_revision');
  if (candidate.contentHash !== input.currentContentHash) issues.push('stale_spatial_document_hash');
  if (!SHA256.test(candidate.contentHash)) issues.push('invalid_spatial_document_hash');
  const { reviewRevision: _reviewRevision, ...reviewedCandidate } = candidate;
  if (candidate.reviewRevision !== modelContentRevision(reviewMaterial(reviewedCandidate))) issues.push('spatial_candidate_changed_after_review');
  if (!candidate.parameterPaths.length || candidate.parameterPaths.some(path => !validPath(path))) issues.push('invalid_parameter_path');
  const explicitPaths = new Set(candidate.parameterPaths);
  if (candidate.mode === 'request_only_edit' && candidate.parameterPaths.length !== 1) issues.push('request_only_scope_must_name_one_parameter');
  if (candidate.mode === 'request_only_edit' && candidate.operation.kind !== 'set_parameter') issues.push('request_only_requires_set_parameter');
  if (candidate.mode === 'new_design' && candidate.operation.kind !== 'replace_parameters') issues.push('new_design_requires_replace_parameters');
  if (candidate.operation.kind === 'set_parameter') {
    if (!validPath(candidate.operation.path) || !explicitPaths.has(candidate.operation.path)) issues.push('parameter_path_outside_explicit_scope');
    if (!isScalar(candidate.operation.value)) issues.push('object_or_array_parameter_blocked');
  } else {
    const replacementPaths = Object.keys(candidate.operation.parameters);
    if (replacementPaths.some(path => !validPath(path) || !explicitPaths.has(path))) issues.push('replacement_path_outside_explicit_scope');
    if (Object.values(candidate.operation.parameters).some(value => !isScalar(value))) issues.push('object_or_array_parameter_blocked');
  }
  const expectedPayload = canonicalPayload(candidate.operation, candidate.documentId, candidate.parameterPaths);
  if (!sameJson(candidate.canonical.payload, expectedPayload)
    || !sameJson(candidate.canonical.changedTargets, aiCandidateChangedTargets('intent', expectedPayload))
    || candidate.canonical.id !== candidate.id
    || candidate.canonical.kind !== 'intent'
    || candidate.canonical.baseRevision !== String(candidate.baseDocumentRevision)
    || candidate.canonical.scope?.mode !== candidate.mode
    || candidate.canonical.scope?.featureId !== candidate.documentId) {
    issues.push('spatial_candidate_canonical_binding_mismatch');
  }
  const canonical = guardAiCanonicalCandidate(candidate.canonical, String(currentDocument.revision), input.currentLocks ?? candidate.locks);
  issues.push(...canonical.issues);
  return { allowed: issues.length === 0, issues: [...new Set(issues)], blockedLockIds: [...new Set([...canonical.blockedLockIds, ...candidate.locks.filter(lock => canonical.blockedLockIds.includes(lock.id)).map(lock => lock.id)])].sort() };
}

export function applySpatialAiCandidate(input: {
  candidate: SpatialAiCandidate;
  document: SpatialCadDocument;
  currentDocumentId: string;
  currentContentHash: string;
  commandId: string;
  currentLocks?: readonly AiCandidateLock[];
}): { applied: boolean; candidate: SpatialAiCandidate; document: SpatialCadDocument; transaction?: SpatialCadTransaction; issues: string[] } {
  const guard = guardSpatialAiCandidate({ candidate: input.candidate, currentDocument: input.document, currentDocumentId: input.currentDocumentId, currentContentHash: input.currentContentHash, currentLocks: input.currentLocks });
  if (!guard.allowed) return { applied: false, candidate: input.candidate, document: input.document, issues: guard.issues };
  const operation = input.candidate.operation.kind === 'set_parameter'
    ? { kind: 'set_parameter' as const, key: input.candidate.operation.path, value: input.candidate.operation.value }
    : { kind: 'replace_parameters' as const, parameters: input.candidate.operation.parameters };
  const command: SpatialCadCommand = { schema: 'nexyfab.spatial-cad-command.v1', commandId: input.commandId, domain: input.document.domain, baseRevision: input.document.revision, actor: 'ai', operation };
  const transaction = applySpatialCadCommand(input.document, command);
  if (!transaction.committed) return { applied: false, candidate: input.candidate, document: input.document, transaction, issues: transaction.issues };
  return { applied: true, candidate: { ...input.candidate, canonical: markAiCanonicalCandidateApplied(input.candidate.canonical) }, document: transaction.document, transaction, issues: [] };
}
