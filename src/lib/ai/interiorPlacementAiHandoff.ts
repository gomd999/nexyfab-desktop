
/** Placement AI is deliberately a separate packet from the scalar CAD brief. */
import { hasOnlyKeys, isPlainJsonRecord, isStrictLockProjectionArray } from '@/lib/cad/interiorPlacementRouteInput';
export const INTERIOR_PLACEMENT_AI_HANDOFF_KEY = 'nexyfab:interior-placement-ai-handoff:v1';
export const INTERIOR_PLACEMENT_AI_HANDOFF_SCHEMA = 'nexyfab.interior-placement-ai-handoff.v1' as const;
export const INTERIOR_PLACEMENT_AI_HANDOFF_MAX_AGE_MS = 15 * 60 * 1000;

export const INTERIOR_PLACEMENT_PARAMETER_PATHS = [
  'pose.positionMm', 'pose.rotationDeg', 'dimensionsMm', 'clearanceMm',
] as const;
export type InteriorPlacementParameterPath = typeof INTERIOR_PLACEMENT_PARAMETER_PATHS[number];

export interface InteriorPlacementAiLockProjection {
  id: string;
  target: { kind: string; objectId: string; field?: string };
}

export interface InteriorPlacementAiHandoff {
  schema: typeof INTERIOR_PLACEMENT_AI_HANDOFF_SCHEMA;
  createdAt: number;
  projectId: string;
  placementDocumentId: string;
  roomDocumentId: string;
  docRevision: number;
  projectRevision: number;
  contentHash: string;
  selectedObjectId: string;
  parameterPaths: readonly InteriorPlacementParameterPath[];
  currentLocks: readonly InteriorPlacementAiLockProjection[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const PATHS = new Set<string>(INTERIOR_PLACEMENT_PARAMETER_PATHS);

export function isInteriorPlacementParameterPath(value: string): value is InteriorPlacementParameterPath {
  return PATHS.has(value);
}

export function validateInteriorPlacementAiHandoff(value: unknown, now = Date.now()): string[] {
  if (!isPlainJsonRecord(value) || !hasOnlyKeys(value, ['schema', 'createdAt', 'projectId', 'placementDocumentId', 'roomDocumentId', 'docRevision', 'projectRevision', 'contentHash', 'selectedObjectId', 'parameterPaths', 'currentLocks'])) return ['invalid_placement_ai_handoff'];
  const item = value as Partial<InteriorPlacementAiHandoff>;
  const issues: string[] = [];
  if (item.schema !== INTERIOR_PLACEMENT_AI_HANDOFF_SCHEMA) issues.push('invalid_placement_ai_schema');
  if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt) || now - item.createdAt < 0 || now - item.createdAt > INTERIOR_PLACEMENT_AI_HANDOFF_MAX_AGE_MS) issues.push('expired_placement_ai_handoff');
  if (typeof item.projectId !== 'string' || !item.projectId.trim()) issues.push('placement_ai_auth_required');
  if (typeof item.placementDocumentId !== 'string' || !item.placementDocumentId.trim()) issues.push('missing_placement_document');
  if (typeof item.roomDocumentId !== 'string' || !item.roomDocumentId.trim()) issues.push('missing_room_document');
  if (!Number.isSafeInteger(item.docRevision) || (item.docRevision ?? -1) < 0) issues.push('invalid_placement_revision');
  if (!Number.isSafeInteger(item.projectRevision) || (item.projectRevision ?? -1) < 0) issues.push('invalid_project_revision');
  if (typeof item.contentHash !== 'string' || !SHA256.test(item.contentHash)) issues.push('missing_placement_content_hash');
  if (typeof item.selectedObjectId !== 'string' || !item.selectedObjectId.trim()) issues.push('placement_selection_required');
  if (!Array.isArray(item.parameterPaths) || item.parameterPaths.length === 0 || item.parameterPaths.some(path => typeof path !== 'string' || !isInteriorPlacementParameterPath(path))) issues.push('invalid_placement_parameter_scope');
  if (Array.isArray(item.parameterPaths) && new Set(item.parameterPaths).size !== item.parameterPaths.length) issues.push('duplicate_placement_parameter_scope');
  if (!isStrictLockProjectionArray(item.currentLocks)) issues.push('invalid_placement_locks');
  return [...new Set(issues)];
}

export function isInteriorPlacementAiHandoff(value: unknown, now = Date.now()): value is InteriorPlacementAiHandoff {
  return validateInteriorPlacementAiHandoff(value, now).length === 0;
}

function projectLocks(locks: readonly { id: string; target: { kind: string; objectId: string; field?: string } }[]): InteriorPlacementAiLockProjection[] {
  return locks.map(lock => ({ id: lock.id, target: { ...lock.target } })).sort((a, b) => a.id.localeCompare(b.id));
}

export function saveInteriorPlacementAiHandoff(storage: Storage, input: Omit<InteriorPlacementAiHandoff, 'schema' | 'createdAt' | 'currentLocks'> & { currentLocks: readonly { id: string; target: { kind: string; objectId: string; field?: string } }[] }): void {
  const payload: InteriorPlacementAiHandoff = { schema: INTERIOR_PLACEMENT_AI_HANDOFF_SCHEMA, createdAt: Date.now(), ...input, currentLocks: projectLocks(input.currentLocks) };
  const issues = validateInteriorPlacementAiHandoff(payload);
  if (issues.length) throw new Error(`Invalid interior placement AI handoff: ${issues.join(',')}`);
  storage.setItem(INTERIOR_PLACEMENT_AI_HANDOFF_KEY, JSON.stringify(payload));
}

export function takeInteriorPlacementAiHandoff(storage: Storage, now = Date.now()): InteriorPlacementAiHandoff | null {
  let parsed: unknown = null;
  try { parsed = JSON.parse(storage.getItem(INTERIOR_PLACEMENT_AI_HANDOFF_KEY) ?? 'null'); } catch { /* malformed one-shot payload */ }
  storage.removeItem(INTERIOR_PLACEMENT_AI_HANDOFF_KEY);
  return isInteriorPlacementAiHandoff(parsed, now) ? parsed : null;
}
