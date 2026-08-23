import { Sha256 } from '@aws-crypto/sha256-js';
import { stableSpatialCadDocumentJson, stableSpatialCadJson } from './spatialCadHash';
import {
  validateInteriorPlacementDocument,
  type InteriorPlacementDocument,
  type InteriorPlacementObject,
  type Vec3Mm,
} from './interiorPlacementDocument';

export type InteriorPlacementOperation =
  | { kind: 'add_object'; object: InteriorPlacementObject }
  | { kind: 'move_object'; objectId: string; positionMm: Vec3Mm; rotationDeg?: Vec3Mm }
  | { kind: 'delete_object'; objectId: string }
  | { kind: 'reset_layout'; objects: readonly InteriorPlacementObject[] }
  | { kind: 'update_object'; objectId: string; changes: Partial<Pick<InteriorPlacementObject, 'pose' | 'dimensionsMm' | 'clearanceMm'>> }
  | { kind: 'patch_selected_object'; objectId: string; changes: Partial<Pick<InteriorPlacementObject, 'pose' | 'dimensionsMm' | 'clearanceMm'>> };

export interface InteriorPlacementGuards {
  baseRevision: number;
  baseContentHash: string;
  currentContentHash: string;
  selectedObjectId?: string;
  parameterPaths?: readonly string[];
  locks?: readonly { id: string; target: { kind: string; objectId: string; field?: string } }[];
}

export interface InteriorPlacementHistory {
  past: InteriorPlacementDocument[];
  future: InteriorPlacementDocument[];
}

export type InteriorPlacementTransactionResult =
  | { committed: true; document: InteriorPlacementDocument; changedObjectIds: string[]; history: InteriorPlacementHistory }
  | { committed: false; document: InteriorPlacementDocument; issues: string[]; history: InteriorPlacementHistory };

export function hashInteriorPlacementDocument(document: InteriorPlacementDocument): string {
  const hash = new Sha256();
  hash.update(stableSpatialCadDocumentJson(document as never));
  return [...hash.digestSync()].map(value => value.toString(16).padStart(2, '0')).join('');
}

function cloneHistory(history: InteriorPlacementHistory): InteriorPlacementHistory {
  return { past: structuredClone(history.past), future: structuredClone(history.future) };
}

type PlacementLock = NonNullable<InteriorPlacementGuards['locks']>[number];

function lockProtects(lock: PlacementLock, documentId: string, objectId: string, fields: readonly string[]): boolean {
  if (lock.target.kind === 'workspace') return true;
  if (lock.target.objectId !== objectId && lock.target.objectId !== documentId) return false;
  return lock.target.field === undefined || fields.some(field => field === lock.target.field
    || field.startsWith(`${lock.target.field}.`) || lock.target.field!.startsWith(`${field}.`));
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableSpatialCadJson(left) === stableSpatialCadJson(right);
}

function operationFields(document: InteriorPlacementDocument, operation: InteriorPlacementOperation): string[] {
  if (operation.kind === 'move_object') {
    const object = document.objects.find(candidate => candidate.id === operation.objectId);
    if (!object) return ['pose.positionMm', ...(operation.rotationDeg ? ['pose.rotationDeg'] : [])];
    return [
      ...(!sameValue(object.pose.positionMm, operation.positionMm) ? ['pose.positionMm'] : []),
      ...(operation.rotationDeg && !sameValue(object.pose.rotationDeg, operation.rotationDeg) ? ['pose.rotationDeg'] : []),
    ];
  }
  if (operation.kind === 'patch_selected_object' || operation.kind === 'update_object') {
    const object = document.objects.find(candidate => candidate.id === operation.objectId);
    if (!object) return Object.keys(operation.changes);
    return [
      ...(operation.changes.pose && !sameValue(object.pose.positionMm, operation.changes.pose.positionMm) ? ['pose.positionMm'] : []),
      ...(operation.changes.pose && !sameValue(object.pose.rotationDeg, operation.changes.pose.rotationDeg) ? ['pose.rotationDeg'] : []),
      ...(operation.changes.dimensionsMm && !sameValue(object.dimensionsMm, operation.changes.dimensionsMm) ? ['dimensionsMm'] : []),
      ...(operation.changes.clearanceMm && !sameValue(object.clearanceMm, operation.changes.clearanceMm) ? ['clearanceMm'] : []),
    ];
  }
  if (operation.kind === 'add_object') return ['object'];
  if (operation.kind === 'delete_object') return ['object'];
  return ['layout'];
}

function reduce(document: InteriorPlacementDocument, operation: InteriorPlacementOperation): { document: InteriorPlacementDocument; changedObjectIds: string[]; issues: string[] } {
  const next = structuredClone(document);
  const changedObjectIds: string[] = [];
  if (operation.kind === 'add_object') {
    if (next.objects.some(object => object.id === operation.object.id)) return { document, changedObjectIds: [], issues: ['object_id_exists'] };
    next.objects.push(structuredClone(operation.object)); changedObjectIds.push(operation.object.id);
  } else if (operation.kind === 'delete_object') {
    const index = next.objects.findIndex(object => object.id === operation.objectId);
    if (index < 0) return { document, changedObjectIds: [], issues: ['object_not_found'] };
    next.objects.splice(index, 1); changedObjectIds.push(operation.objectId);
  } else if (operation.kind === 'reset_layout') {
    const priorIds = next.objects.map(object => object.id);
    next.objects = structuredClone(operation.objects) as InteriorPlacementObject[];
    changedObjectIds.push(...new Set([...priorIds, ...next.objects.map(object => object.id)]));
  } else {
    const object = next.objects.find(candidate => candidate.id === operation.objectId);
    if (!object) return { document, changedObjectIds: [], issues: ['object_not_found'] };
    if (operation.kind === 'move_object') object.pose = { positionMm: [...operation.positionMm] as Vec3Mm, rotationDeg: operation.rotationDeg ? [...operation.rotationDeg] as Vec3Mm : object.pose.rotationDeg };
    else {
      object.pose = operation.changes.pose ? structuredClone(operation.changes.pose) : object.pose;
      object.dimensionsMm = operation.changes.dimensionsMm ? [...operation.changes.dimensionsMm] as Vec3Mm : object.dimensionsMm;
      object.clearanceMm = operation.changes.clearanceMm ? [...operation.changes.clearanceMm] as Vec3Mm : object.clearanceMm;
    }
    changedObjectIds.push(operation.objectId);
  }
  if (sameValue(next.objects, document.objects)) return { document, changedObjectIds: [], issues: ['no_effect'] };
  next.revision += 1;
  return { document: next, changedObjectIds, issues: validateInteriorPlacementDocument(next) };
}

export function commitInteriorPlacementOperation(document: InteriorPlacementDocument, operation: InteriorPlacementOperation, history: InteriorPlacementHistory = { past: [], future: [] }, guards?: InteriorPlacementGuards): InteriorPlacementTransactionResult {
  const original = structuredClone(document);
  const originalHistory = cloneHistory(history);
  if (validateInteriorPlacementDocument(document).length) return { committed: false, document, issues: ['invalid_source_document'], history: originalHistory };
  if (operation.kind === 'patch_selected_object' && !guards) return { committed: false, document, issues: ['ai_guards_required'], history: originalHistory };
  if ((operation.kind === 'patch_selected_object' || operation.kind === 'update_object') && (!operation.changes || typeof operation.changes !== 'object' || Array.isArray(operation.changes))) return { committed: false, document, issues: ['invalid_parameter_scope'], history: originalHistory };
  if ((operation.kind === 'patch_selected_object' || operation.kind === 'update_object')
    && Object.keys(operation.changes).some(path => !['pose', 'dimensionsMm', 'clearanceMm'].includes(path))) {
    return { committed: false, document, issues: ['invalid_parameter_scope'], history: originalHistory };
  }
  if (guards) {
    if (guards.baseRevision !== document.revision || guards.baseContentHash !== hashInteriorPlacementDocument(document) || guards.currentContentHash !== guards.baseContentHash) return { committed: false, document, issues: ['stale_revision_or_hash'], history: originalHistory };
    if (operation.kind === 'patch_selected_object') {
      const allowed = ['pose', 'pose.positionMm', 'pose.rotationDeg', 'dimensionsMm', 'clearanceMm'];
      if (guards.selectedObjectId !== operation.objectId) return { committed: false, document, issues: ['selected_object_scope_required'], history: originalHistory };
      if (Object.keys(operation.changes).some(path => !['pose', 'dimensionsMm', 'clearanceMm'].includes(path))) return { committed: false, document, issues: ['invalid_parameter_scope'], history: originalHistory };
      const changedFields = operationFields(document, operation);
      const paths = guards.parameterPaths ?? [];
      const covers = (scope: string, field: string) => scope === field || (scope === 'pose' && field.startsWith('pose.'));
      if (!changedFields.length || !paths.length || new Set(paths).size !== paths.length
        || paths.some(path => !allowed.includes(path) || !changedFields.some(field => covers(path, field)))
        || changedFields.some(field => !paths.some(path => covers(path, field)))) return { committed: false, document, issues: ['invalid_parameter_scope'], history: originalHistory };
    }
    if (operation.kind === 'update_object') return { committed: false, document, issues: ['human_update_scope_only'], history: originalHistory };
    const locks = guards.locks ?? [];
    const lockIds = new Set<string>();
    if (locks.some(lock => typeof lock?.id !== 'string' || !lock.id.trim() || lockIds.has(lock.id)
      || typeof lock.target?.kind !== 'string' || !['workspace', 'occurrence', 'parameter'].includes(lock.target.kind)
      || typeof lock.target.objectId !== 'string' || !lock.target.objectId.trim()
      || (lock.target.field !== undefined && (typeof lock.target.field !== 'string' || !lock.target.field.trim()))
      || (lockIds.add(lock.id), false))) return { committed: false, document, issues: ['invalid_locks'], history: originalHistory };
    if (locks.some(lock => lockProtects(lock, document.documentId, operation.kind === 'add_object' ? operation.object.id : operation.kind === 'reset_layout' ? document.documentId : operation.objectId, operationFields(document, operation)))) return { committed: false, document, issues: ['protected_object'], history: originalHistory };
  }
  const reduced = reduce(document, operation);
  if (reduced.issues.length) return { committed: false, document, issues: reduced.issues, history: originalHistory };
  const nextHistory = { past: [...history.past, original].slice(-100), future: [] };
  return { committed: true, document: reduced.document, changedObjectIds: reduced.changedObjectIds, history: nextHistory };
}

export function previewInteriorPlacementMove(document: InteriorPlacementDocument, objectId: string, positionMm: Vec3Mm, rotationDeg?: Vec3Mm): InteriorPlacementDocument {
  const result = reduce({ ...structuredClone(document), objects: structuredClone(document.objects) }, { kind: 'move_object', objectId, positionMm, rotationDeg });
  if (result.issues.length) return structuredClone(document);
  result.document.revision = document.revision;
  return result.document;
}

export function undoInteriorPlacement(document: InteriorPlacementDocument, history: InteriorPlacementHistory): { document: InteriorPlacementDocument; history: InteriorPlacementHistory } {
  const previous = history.past.at(-1);
  if (!previous || validateInteriorPlacementDocument(previous).length || previous.documentId !== document.documentId || previous.roomDocumentId !== document.roomDocumentId) return { document: structuredClone(document), history: cloneHistory(history) };
  return { document: { ...structuredClone(previous), revision: document.revision + 1 }, history: { past: history.past.slice(0, -1).map(item => structuredClone(item)), future: [structuredClone(document), ...history.future] } };
}

export function redoInteriorPlacement(document: InteriorPlacementDocument, history: InteriorPlacementHistory): { document: InteriorPlacementDocument; history: InteriorPlacementHistory } {
  const next = history.future[0];
  if (!next || validateInteriorPlacementDocument(next).length || next.documentId !== document.documentId || next.roomDocumentId !== document.roomDocumentId) return { document: structuredClone(document), history: cloneHistory(history) };
  return { document: { ...structuredClone(next), revision: document.revision + 1 }, history: { past: [...history.past, structuredClone(document)], future: history.future.slice(1).map(item => structuredClone(item)) } };
}
