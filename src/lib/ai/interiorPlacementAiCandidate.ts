import { Sha256 } from '@aws-crypto/sha256-js';
import type { InteriorPlacementAiHandoff, InteriorPlacementAiLockProjection, InteriorPlacementParameterPath } from './interiorPlacementAiHandoff';
import { isInteriorPlacementParameterPath } from './interiorPlacementAiHandoff';
import type { InteriorPlacementObject } from '@/lib/cad/interiorPlacementDocument';
import type { InteriorPlacementOperation } from '@/lib/cad/interiorPlacementTransaction';
import { hasOnlyKeys, isPlainJsonRecord, isStrictInteriorPlacementOperation, isStrictLockProjectionArray } from '@/lib/cad/interiorPlacementRouteInput';
import { stableSpatialCadJson } from '@/lib/cad/spatialCadHash';

export const INTERIOR_PLACEMENT_AI_CANDIDATE_SCHEMA = 'nexyfab.interior-placement-ai-candidate.v1' as const;
export const INTERIOR_PLACEMENT_AI_CANDIDATE_EVENT = 'nexyfab:interior-placement-ai-candidate';

export interface InteriorPlacementAiCandidate {
  schema: typeof INTERIOR_PLACEMENT_AI_CANDIDATE_SCHEMA;
  id: string;
  projectId: string;
  placementDocumentId: string;
  roomDocumentId: string;
  baseDocumentRevision: number;
  projectRevision: number;
  baseContentHash: string;
  selectedObjectId: string;
  parameterPaths: readonly InteriorPlacementParameterPath[];
  locks: readonly InteriorPlacementAiLockProjection[];
  operation: Extract<InteriorPlacementOperation, { kind: 'patch_selected_object' }>;
  /** Fingerprint of exactly the reviewed proposal, excluding this field. */
  reviewFingerprint: string;
}

const clone = <T,>(value: T): T => structuredClone(value);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function material(candidate: Omit<InteriorPlacementAiCandidate, 'reviewFingerprint'>): unknown {
  return candidate;
}

export function interiorPlacementCandidateFingerprint(candidate: Omit<InteriorPlacementAiCandidate, 'reviewFingerprint'>): string {
  const hash = new Sha256();
  hash.update(stableSpatialCadJson(material(candidate)));
  return [...hash.digestSync()].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function isInteriorPlacementAiCandidate(value: unknown): value is InteriorPlacementAiCandidate {
  if (!isPlainJsonRecord(value) || !hasOnlyKeys(value, ['schema', 'id', 'projectId', 'placementDocumentId', 'roomDocumentId', 'baseDocumentRevision', 'projectRevision', 'baseContentHash', 'selectedObjectId', 'parameterPaths', 'locks', 'operation', 'reviewFingerprint'])) return false;
  const item = value as Partial<InteriorPlacementAiCandidate>;
  if (item.schema !== INTERIOR_PLACEMENT_AI_CANDIDATE_SCHEMA || typeof item.id !== 'string' || !item.id.trim()
    || typeof item.projectId !== 'string' || !item.projectId.trim() || typeof item.placementDocumentId !== 'string' || !item.placementDocumentId.trim()
    || typeof item.roomDocumentId !== 'string' || !item.roomDocumentId.trim() || typeof item.selectedObjectId !== 'string' || !item.selectedObjectId.trim()
    || !Number.isSafeInteger(item.baseDocumentRevision) || (item.baseDocumentRevision ?? -1) < 0 || !Number.isSafeInteger(item.projectRevision) || (item.projectRevision ?? -1) < 0
    || typeof item.baseContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.baseContentHash)
    || !Array.isArray(item.parameterPaths) || !item.parameterPaths.length || new Set(item.parameterPaths).size !== item.parameterPaths.length || item.parameterPaths.some(path => typeof path !== 'string' || !isInteriorPlacementParameterPath(path))
    || !isStrictLockProjectionArray(item.locks) || !isStrictInteriorPlacementOperation(item.operation, ['patch_selected_object'])
    || typeof item.reviewFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(item.reviewFingerprint)) return false;
  const { reviewFingerprint: _fingerprint, ...reviewed } = item as InteriorPlacementAiCandidate;
  return item.reviewFingerprint === interiorPlacementCandidateFingerprint(reviewed) && item.operation.objectId === item.selectedObjectId;
}

export function changedInteriorPlacementPaths(current: InteriorPlacementObject, proposed: InteriorPlacementObject): InteriorPlacementParameterPath[] {
  const paths: InteriorPlacementParameterPath[] = [];
  if (!equal(current.pose.positionMm, proposed.pose.positionMm)) paths.push('pose.positionMm');
  if (!equal(current.pose.rotationDeg, proposed.pose.rotationDeg)) paths.push('pose.rotationDeg');
  if (!equal(current.dimensionsMm, proposed.dimensionsMm)) paths.push('dimensionsMm');
  if (!equal(current.clearanceMm, proposed.clearanceMm)) paths.push('clearanceMm');
  return paths;
}

/** Builds a reviewed patch from a proposed object. Identity and room membership are immutable. */
export function createInteriorPlacementAiCandidate(input: {
  handoff: InteriorPlacementAiHandoff;
  currentObject: InteriorPlacementObject;
  proposedObject: InteriorPlacementObject;
  id?: string;
}): InteriorPlacementAiCandidate {
  const { handoff, currentObject, proposedObject } = input;
  const paths = changedInteriorPlacementPaths(currentObject, proposedObject);
  const issues: string[] = [];
  if (currentObject.id !== proposedObject.id || currentObject.catalogType !== proposedObject.catalogType || currentObject.spaceId !== proposedObject.spaceId) issues.push('immutable_object_identity_changed');
  if (handoff.selectedObjectId !== currentObject.id) issues.push('placement_selection_mismatch');
  if (!paths.length) issues.push('no_effect');
  if (paths.some(path => !handoff.parameterPaths.includes(path))) issues.push('parameter_scope_mismatch');
  if (issues.length) throw new Error(`Invalid interior placement AI candidate: ${[...new Set(issues)].join(',')}`);
  const operation = {
    kind: 'patch_selected_object' as const,
    objectId: currentObject.id,
    changes: {
      ...(paths.some(path => path.startsWith('pose.')) ? { pose: clone(proposedObject.pose) } : {}),
      ...(paths.includes('dimensionsMm') ? { dimensionsMm: clone(proposedObject.dimensionsMm) } : {}),
      ...(paths.includes('clearanceMm') ? { clearanceMm: clone(proposedObject.clearanceMm) } : {}),
    },
  };
  const candidate = {
    schema: INTERIOR_PLACEMENT_AI_CANDIDATE_SCHEMA,
    id: input.id?.trim() || `interior-placement-${Date.now()}`,
    projectId: handoff.projectId,
    placementDocumentId: handoff.placementDocumentId,
    roomDocumentId: handoff.roomDocumentId,
    baseDocumentRevision: handoff.docRevision,
    projectRevision: handoff.projectRevision,
    baseContentHash: handoff.contentHash,
    selectedObjectId: handoff.selectedObjectId,
    parameterPaths: [...paths],
    locks: clone(handoff.currentLocks),
    operation,
  } satisfies Omit<InteriorPlacementAiCandidate, 'reviewFingerprint'>;
  return { ...candidate, reviewFingerprint: interiorPlacementCandidateFingerprint(candidate) };
}

export function guardInteriorPlacementAiCandidate(input: {
  candidate: InteriorPlacementAiCandidate;
  currentDocumentId: string;
  currentRoomDocumentId: string;
  currentRevision: number;
  currentProjectRevision: number;
  currentContentHash: string;
  selectedObjectId: string | null;
  currentObject?: InteriorPlacementObject;
  currentLocks: readonly InteriorPlacementAiLockProjection[];
}): string[] {
  const { candidate } = input;
  const issues: string[] = [];
  if (!isInteriorPlacementAiCandidate(candidate)) return ['candidate_tampered'];
  if (candidate.placementDocumentId !== input.currentDocumentId || candidate.roomDocumentId !== input.currentRoomDocumentId) issues.push('placement_document_scope_mismatch');
  if (candidate.baseDocumentRevision !== input.currentRevision || candidate.projectRevision !== input.currentProjectRevision || candidate.baseContentHash !== input.currentContentHash) issues.push('stale_placement_candidate');
  if (!input.selectedObjectId || candidate.selectedObjectId !== input.selectedObjectId || candidate.operation.objectId !== input.selectedObjectId) issues.push('placement_selection_required');
  if (input.currentObject) {
    const proposed = clone(input.currentObject);
    const changes = candidate.operation.changes;
    if (changes.pose) proposed.pose = clone(changes.pose);
    if (changes.dimensionsMm) proposed.dimensionsMm = clone(changes.dimensionsMm);
    if (changes.clearanceMm) proposed.clearanceMm = clone(changes.clearanceMm);
    const actualPaths = changedInteriorPlacementPaths(input.currentObject, proposed);
    if (actualPaths.length !== candidate.parameterPaths.length || actualPaths.some(path => !candidate.parameterPaths.includes(path))) issues.push('parameter_scope_mismatch');
  }
  const locks = JSON.stringify(input.currentLocks.map(lock => ({ id: lock.id, target: lock.target })).sort((a, b) => a.id.localeCompare(b.id)));
  const candidateLocks = JSON.stringify(candidate.locks.map(lock => ({ id: lock.id, target: lock.target })).sort((a, b) => a.id.localeCompare(b.id)));
  if (locks !== candidateLocks) issues.push('placement_locks_changed');
  return [...new Set(issues)];
}
