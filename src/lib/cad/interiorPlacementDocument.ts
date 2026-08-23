import type { InteriorFurnitureItem } from './interiorSpatialModel';

export const INTERIOR_PLACEMENT_DOCUMENT_SCHEMA = 'nexyfab.interior-placement-document.v1' as const;
export const INTERIOR_PLACEMENT_UNITS = 'mm' as const;
export type Vec3Mm = readonly [number, number, number];

/**
 * The one source of truth for placement dimensions.  The viewer and the
 * legacy furniture adapter both consume this catalog; they must not invent
 * a second set of footprints.
 */
export const INTERIOR_PLACEMENT_CATALOG = {
  table2: { dimensionsMm: [700, 700, 750] as Vec3Mm, seats: 2 },
  table4: { dimensionsMm: [1200, 1200, 750] as Vec3Mm, seats: 4 },
  sofa: { dimensionsMm: [1800, 850, 850] as Vec3Mm, seats: 3 },
} as const;

export interface InteriorPlacementObject {
  id: string;
  catalogType: string;
  spaceId: string;
  pose: { positionMm: Vec3Mm; rotationDeg: Vec3Mm };
  dimensionsMm: Vec3Mm;
  clearanceMm: Vec3Mm;
}

export interface InteriorPlacementDocument {
  schema: typeof INTERIOR_PLACEMENT_DOCUMENT_SCHEMA;
  documentId: string;
  roomDocumentId: string;
  revision: number;
  units: typeof INTERIOR_PLACEMENT_UNITS;
  roomSizeMm: Vec3Mm;
  objects: InteriorPlacementObject[];
}

const finiteVec3 = (value: unknown): value is Vec3Mm => Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item));
const positiveVec3 = (value: unknown): value is Vec3Mm => finiteVec3(value) && value.every(item => item > 0);

function rotatedHalfExtents(object: InteriorPlacementObject): Vec3Mm {
  const [rx, ry, rz] = object.pose.rotationDeg.map(value => value * Math.PI / 180);
  const [sx, cx] = [Math.sin(rx), Math.cos(rx)];
  const [sy, cy] = [Math.sin(ry), Math.cos(ry)];
  const [sz, cz] = [Math.sin(rz), Math.cos(rz)];
  // Rz * Ry * Rx. Absolute row values project a rotated local cuboid onto
  // the room's axis-aligned bounds without losing its dimensional extents.
  const rotation = [
    [cy * cz, cz * sx * sy - cx * sz, sx * sz + cx * cz * sy],
    [cy * sz, cx * cz + sx * sy * sz, cx * sy * sz - cz * sx],
    [-sy, cy * sx, cx * cy],
  ];
  const localHalf = object.dimensionsMm.map((size, index) => size / 2 + object.clearanceMm[index]);
  return rotation.map(row => row.reduce((sum, value, index) => sum + Math.abs(value) * localHalf[index], 0)) as unknown as Vec3Mm;
}

export function clampInteriorRotationDeg(rotationDeg: Vec3Mm): Vec3Mm {
  return rotationDeg.map(value => {
    const normalized = ((value + 180) % 360 + 360) % 360 - 180;
    return normalized === -180 ? 180 : normalized;
  }) as unknown as Vec3Mm;
}

export function clampInteriorClearanceMm(clearanceMm: Vec3Mm, maxMm: Vec3Mm = [10_000, 10_000, 10_000]): Vec3Mm {
  return clearanceMm.map((value, index) => Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), maxMm[index] ?? 10_000)) as unknown as Vec3Mm;
}

function extentsFor(dimensionsMm: Vec3Mm, rotationDeg: Vec3Mm, clearanceMm: Vec3Mm): Vec3Mm {
  return rotatedHalfExtents({
    id: 'coordinate-helper', catalogType: 'helper', spaceId: 'helper',
    pose: { positionMm: [0, 0, 0], rotationDeg: clampInteriorRotationDeg(rotationDeg) },
    dimensionsMm, clearanceMm: clampInteriorClearanceMm(clearanceMm),
  });
}

export function clampInteriorPlacementPositionMm(
  positionMm: Vec3Mm,
  roomSizeMm: Vec3Mm,
  dimensionsMm: Vec3Mm,
  rotationDeg: Vec3Mm = [0, 0, 0],
  clearanceMm: Vec3Mm = [0, 0, 0],
): Vec3Mm {
  const half = extentsFor(dimensionsMm, rotationDeg, clearanceMm);
  return positionMm.map((value, index) => {
    const limit = Math.max(0, roomSizeMm[index] / 2 - half[index]);
    return Math.min(Math.max(Number.isFinite(value) ? value : 0, -limit), limit);
  }) as unknown as Vec3Mm;
}

/** Convert legacy top-left UI coordinates to the document's room-centred object centre. */
export function topLeftToRoomCenteredMm(
  topLeftMm: readonly [number, number],
  roomSizeMm: Vec3Mm,
  dimensionsMm: Vec3Mm,
  rotationDeg: Vec3Mm = [0, 0, 0],
  clearanceMm: Vec3Mm = [0, 0, 0],
): Vec3Mm {
  const half = extentsFor(dimensionsMm, rotationDeg, clearanceMm);
  const clean = (value: number) => Math.abs(value) < 1e-9 ? 0 : value;
  return [clean(topLeftMm[0] + half[0] - roomSizeMm[0] / 2), clean(topLeftMm[1] + half[1] - roomSizeMm[1] / 2), 0];
}

/** Convert room-centred object centre coordinates back to top-left UI coordinates. */
export function roomCenteredToTopLeftMm(
  centeredMm: Vec3Mm,
  roomSizeMm: Vec3Mm,
  dimensionsMm: Vec3Mm,
  rotationDeg: Vec3Mm = [0, 0, 0],
  clearanceMm: Vec3Mm = [0, 0, 0],
): [number, number] {
  const half = extentsFor(dimensionsMm, rotationDeg, clearanceMm);
  const clean = (value: number) => Math.abs(value) < 1e-9 ? 0 : value;
  return [clean(centeredMm[0] + roomSizeMm[0] / 2 - half[0]), clean(centeredMm[1] + roomSizeMm[1] / 2 - half[1])];
}

export function validateInteriorPlacementDocument(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['invalid_document'];
  const document = value as Partial<InteriorPlacementDocument>;
  const issues: string[] = [];
  if (document.schema !== INTERIOR_PLACEMENT_DOCUMENT_SCHEMA) issues.push('invalid_schema');
  if (!document.documentId?.trim() || !document.roomDocumentId?.trim()) issues.push('document_identity_required');
  if (!Number.isSafeInteger(document.revision) || (document.revision ?? -1) < 0) issues.push('invalid_revision');
  if (document.units !== INTERIOR_PLACEMENT_UNITS) issues.push('invalid_units');
  if (!positiveVec3(document.roomSizeMm)) issues.push('invalid_room_size');
  if (!Array.isArray(document.objects)) issues.push('invalid_objects');
  else if (document.objects.length > 40) issues.push('object_limit_exceeded');
  const ids = new Set<string>();
  for (const object of Array.isArray(document.objects) ? document.objects : []) {
    if (!object || typeof object !== 'object' || !object.id?.trim() || ids.has(object.id)) { issues.push('duplicate_or_empty_object_id'); continue; }
    ids.add(object.id);
    if (!object.catalogType?.trim() || !object.spaceId?.trim()) issues.push(`object_identity_invalid:${object.id}`);
    if (!object.pose || !finiteVec3(object.pose.positionMm) || !finiteVec3(object.pose.rotationDeg)) issues.push(`object_pose_invalid:${object.id}`);
    if (!positiveVec3(object.dimensionsMm) || !finiteVec3(object.clearanceMm) || object.clearanceMm.some(item => item < 0)) issues.push(`object_dimensions_invalid:${object.id}`);
    if (positiveVec3(document.roomSizeMm) && finiteVec3(object.pose?.positionMm) && positiveVec3(object.dimensionsMm) && finiteVec3(object.clearanceMm)) {
      const half = rotatedHalfExtents(object);
      if (object.pose.positionMm.some((position, index) => Math.abs(position) + half[index] > document.roomSizeMm![index] / 2)) issues.push(`object_out_of_room:${object.id}`);
    }
  }
  return [...new Set(issues)];
}

export function createInteriorPlacementDocument(input: { documentId: string; roomDocumentId: string; roomSizeMm: Vec3Mm; objects?: InteriorPlacementObject[] }): InteriorPlacementDocument {
  const document: InteriorPlacementDocument = { schema: INTERIOR_PLACEMENT_DOCUMENT_SCHEMA, documentId: input.documentId, roomDocumentId: input.roomDocumentId, revision: 0, units: INTERIOR_PLACEMENT_UNITS, roomSizeMm: [...input.roomSizeMm] as Vec3Mm, objects: structuredClone(input.objects ?? []) };
  if (validateInteriorPlacementDocument(document).length) throw new Error('invalid_interior_placement_document');
  return document;
}

/** Explicit boundary adapter; the placement document remains independent of UI furniture arrays. */
export function placementObjectFromFurniture(item: InteriorFurnitureItem, objectId: string, roomDocumentId: string, roomSizeMm: Vec3Mm): InteriorPlacementObject {
  if (!objectId.trim()) throw new Error('placement_object_id_required');
  const catalog = INTERIOR_PLACEMENT_CATALOG[item.kind];
  const dimensionsMm = catalog?.dimensionsMm ?? [1000, 600, 750];
  return { id: objectId, catalogType: item.kind, spaceId: roomDocumentId, pose: { positionMm: topLeftToRoomCenteredMm([item.x, item.y], roomSizeMm, dimensionsMm), rotationDeg: [0, 0, 0] }, dimensionsMm, clearanceMm: [0, 0, 0] };
}

export function placementObjectsFromFurniture(items: readonly InteriorFurnitureItem[], objectIds: readonly string[], roomDocumentId: string, roomSizeMm: Vec3Mm): InteriorPlacementObject[] {
  if (items.length !== objectIds.length || new Set(objectIds).size !== objectIds.length) throw new Error('stable_placement_object_ids_required');
  return items.map((item, index) => placementObjectFromFurniture(item, objectIds[index] ?? '', roomDocumentId, roomSizeMm));
}
