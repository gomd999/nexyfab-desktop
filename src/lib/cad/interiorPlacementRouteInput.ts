import type { InteriorPlacementDocument, InteriorPlacementObject } from './interiorPlacementDocument';
import type { InteriorPlacementOperation } from './interiorPlacementTransaction';

export function isPlainJsonRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.every(key => allowed.includes(key));
}

const string = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const vec3 = (value: unknown): value is [number, number, number] => Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item));

function placementObject(value: unknown): value is InteriorPlacementObject {
  if (!isPlainJsonRecord(value) || !hasOnlyKeys(value, ['id', 'catalogType', 'spaceId', 'pose', 'dimensionsMm', 'clearanceMm'])
    || !string(value.id) || !string(value.catalogType) || !string(value.spaceId) || !isPlainJsonRecord(value.pose)
    || !hasOnlyKeys(value.pose, ['positionMm', 'rotationDeg'])) return false;
  return vec3(value.pose.positionMm) && vec3(value.pose.rotationDeg) && vec3(value.dimensionsMm) && vec3(value.clearanceMm);
}

export function isStrictInteriorPlacementDocument(value: unknown): value is InteriorPlacementDocument {
  if (!isPlainJsonRecord(value) || !hasOnlyKeys(value, ['schema', 'documentId', 'roomDocumentId', 'revision', 'units', 'roomSizeMm', 'objects'])
    || value.schema !== 'nexyfab.interior-placement-document.v1' || !string(value.documentId) || !string(value.roomDocumentId)
    || !Number.isSafeInteger(value.revision) || value.units !== 'mm' || !vec3(value.roomSizeMm) || !Array.isArray(value.objects) || value.objects.length > 40) return false;
  return value.objects.every(placementObject);
}

export function isStrictInteriorPlacementOperation(value: unknown, allowedKinds?: readonly InteriorPlacementOperation['kind'][]): value is InteriorPlacementOperation {
  if (!isPlainJsonRecord(value) || typeof value.kind !== 'string' || (allowedKinds && !allowedKinds.includes(value.kind as InteriorPlacementOperation['kind']))) return false;
  if (value.kind === 'add_object') return hasOnlyKeys(value, ['kind', 'object']) && placementObject(value.object);
  if (value.kind === 'move_object') return hasOnlyKeys(value, ['kind', 'objectId', 'positionMm', 'rotationDeg']) && string(value.objectId) && vec3(value.positionMm) && (value.rotationDeg === undefined || vec3(value.rotationDeg));
  if (value.kind === 'delete_object') return hasOnlyKeys(value, ['kind', 'objectId']) && string(value.objectId);
  if (value.kind === 'reset_layout') return hasOnlyKeys(value, ['kind', 'objects']) && Array.isArray(value.objects) && value.objects.length <= 40 && value.objects.every(placementObject);
  if (value.kind === 'update_object') {
    if (!hasOnlyKeys(value, ['kind', 'objectId', 'changes']) || !string(value.objectId) || !isPlainJsonRecord(value.changes) || !hasOnlyKeys(value.changes, ['pose', 'dimensionsMm', 'clearanceMm'])) return false;
    if (value.changes.pose !== undefined && (!isPlainJsonRecord(value.changes.pose) || !hasOnlyKeys(value.changes.pose, ['positionMm', 'rotationDeg']) || !vec3(value.changes.pose.positionMm) || !vec3(value.changes.pose.rotationDeg))) return false;
    return (value.changes.dimensionsMm === undefined || vec3(value.changes.dimensionsMm)) && (value.changes.clearanceMm === undefined || vec3(value.changes.clearanceMm));
  }
  if (value.kind !== 'patch_selected_object' || !hasOnlyKeys(value, ['kind', 'objectId', 'changes']) || !string(value.objectId) || !isPlainJsonRecord(value.changes)
    || !hasOnlyKeys(value.changes, ['pose', 'dimensionsMm', 'clearanceMm'])) return false;
  if (value.changes.pose !== undefined && (!isPlainJsonRecord(value.changes.pose) || !hasOnlyKeys(value.changes.pose, ['positionMm', 'rotationDeg']) || !vec3(value.changes.pose.positionMm) || !vec3(value.changes.pose.rotationDeg))) return false;
  return (value.changes.dimensionsMm === undefined || vec3(value.changes.dimensionsMm)) && (value.changes.clearanceMm === undefined || vec3(value.changes.clearanceMm));
}

export function isStrictLockProjectionArray(value: unknown): value is Array<{ id: string; target: { kind: string; objectId: string; field?: string } }> {
  return Array.isArray(value) && value.length <= 64 && value.every(lock => isPlainJsonRecord(lock) && hasOnlyKeys(lock, ['id', 'target']) && string(lock.id)
    && isPlainJsonRecord(lock.target) && hasOnlyKeys(lock.target, ['kind', 'objectId', 'field'])
    && ['workspace', 'occurrence', 'parameter'].includes(String(lock.target.kind)) && string(lock.target.objectId)
    && (lock.target.field === undefined || string(lock.target.field)));
}
