import type {
  ArchitectureCeiling,
  ArchitectureDocument,
  ArchitectureOpening,
  ArchitectureSpace,
  ArchitectureStorey,
  ArchitectureWall,
  InteriorCeilingSystem,
  InteriorDocument,
  InteriorFinish,
  InteriorFurniture,
  InteriorLight,
  InteriorMillwork,
} from './architectureInteriorDocuments';

/**
 * Stable semantic selection for the architecture/interior workspace.
 *
 * The selection intentionally carries document and revision identity.  An
 * object id alone is not enough: architecture and interior documents can be
 * reloaded independently and a stale edit must never be applied to a newer
 * revision by accident.
 */
export const ARCHITECTURE_INTERIOR_SELECTION_SCHEMA = 'nexyfab.architecture-interior-selection.v1' as const;

export type ArchitectureInteriorSelectionKind =
  | 'storey'
  | 'space'
  | 'wall'
  | 'opening'
  | 'ceiling'
  | 'furniture'
  | 'finish'
  | 'millwork'
  | 'light';

export type SelectionDocument = 'architecture' | 'interior';

export type ArchitectureInteriorSelection = {
  schema: typeof ARCHITECTURE_INTERIOR_SELECTION_SCHEMA;
  projectId: string;
  architectureDocumentId: string;
  interiorDocumentId: string;
  revision: number;
  document: SelectionDocument;
  kind: ArchitectureInteriorSelectionKind;
  objectId: string;
  /** Deterministic identity used by UI state and reconnect recovery. */
  selectionKey: string;
};

export type ArchitectureInteriorSelectionSource = {
  projectId: string;
  architectureDocumentId: string;
  interiorDocumentId: string;
  architecture: ArchitectureDocument;
  interior: InteriorDocument;
};

export type InspectorValueType = 'text' | 'number' | 'vector2' | 'vector3' | 'enum';

export type ArchitectureInteriorInspectorField = {
  key: string;
  value: unknown;
  valueType: InspectorValueType;
  unit?: 'mm' | 'deg' | 'lm' | 'K';
  /** Host and identity fields are deliberately not emitted here. */
  editable: boolean;
};

export type ArchitectureInteriorSelectionObject =
  | ArchitectureStorey
  | ArchitectureSpace
  | ArchitectureWall
  | ArchitectureOpening
  | ArchitectureCeiling
  | InteriorFurniture
  | InteriorFinish
  | InteriorMillwork
  | InteriorLight
  | InteriorCeilingSystem;

export type ResolvedArchitectureInteriorSelection = {
  selection: ArchitectureInteriorSelection;
  document: SelectionDocument;
  object: ArchitectureInteriorSelectionObject;
  storeyId?: string;
  spaceId?: string;
  /** All semantic hosts required to keep an edit in its owning context. */
  hostIds: readonly string[];
  editableFields: readonly ArchitectureInteriorInspectorField[];
};

export type SelectionFailureCode =
  | 'INVALID_SELECTION'
  | 'PROJECT_MISMATCH'
  | 'DOCUMENT_MISMATCH'
  | 'STALE_REVISION'
  | 'MISSING_OBJECT'
  | 'AMBIGUOUS_OBJECT'
  | 'KIND_MISMATCH'
  | 'INVALID_HOST';

export type SelectionResolution =
  | { ok: true; value: ResolvedArchitectureInteriorSelection }
  | { ok: false; code: SelectionFailureCode };

const architectureKinds = new Set<ArchitectureInteriorSelectionKind>(['storey', 'space', 'wall', 'opening', 'ceiling']);
const interiorKinds = new Set<ArchitectureInteriorSelectionKind>(['furniture', 'finish', 'millwork', 'light', 'ceiling']);

function validSelectionKind(value: unknown): value is ArchitectureInteriorSelectionKind {
  return typeof value === 'string' && [...architectureKinds, ...interiorKinds].includes(value as ArchitectureInteriorSelectionKind);
}

function validSelectionDocument(value: unknown): value is SelectionDocument {
  return value === 'architecture' || value === 'interior';
}

function validDocumentKind(document: SelectionDocument, kind: ArchitectureInteriorSelectionKind): boolean {
  return (document === 'architecture' ? architectureKinds : interiorKinds).has(kind);
}

function selectionKey(document: SelectionDocument, kind: ArchitectureInteriorSelectionKind, objectId: string): string {
  return `${document}:${kind}:${objectId}`;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function field(key: string, value: unknown, valueType: InspectorValueType, unit?: ArchitectureInteriorInspectorField['unit'], editable = true): ArchitectureInteriorInspectorField {
  return { key, value: structuredClone(value), valueType, ...(unit ? { unit } : {}), editable };
}

function fieldsFor(kind: ArchitectureInteriorSelectionKind, object: ArchitectureInteriorSelectionObject): ArchitectureInteriorInspectorField[] {
  switch (kind) {
    case 'storey': {
      const item = object as ArchitectureStorey;
      return [field('name', item.name, 'text', undefined, false), field('elevationMm', item.elevationMm, 'number', 'mm', false), field('heightMm', item.heightMm, 'number', 'mm', false)];
    }
    case 'space': {
      const item = object as ArchitectureSpace;
      // A polygon is not a single vector2. Keep boundary editing out of the
      // scalar Inspector until a topology-aware polygon editor can preserve
      // the wall/slab/ceiling bundle atomically.
      return [field('name', item.name, 'text', undefined, false), field('usage', item.usage, 'text', undefined, false)];
    }
    case 'wall': {
      const item = object as ArchitectureWall;
      return item.kind === 'line'
        ? [field('startMm', item.startMm, 'vector2', 'mm'), field('endMm', item.endMm, 'vector2', 'mm'), field('thicknessMm', item.thicknessMm, 'number', 'mm'), field('heightMm', item.heightMm, 'number', 'mm')]
        : [field('centerMm', item.centerMm, 'vector2', 'mm'), field('radiusMm', item.radiusMm, 'number', 'mm'), field('startAngleDeg', item.startAngleDeg, 'number', 'deg'), field('endAngleDeg', item.endAngleDeg, 'number', 'deg'), field('thicknessMm', item.thicknessMm, 'number', 'mm'), field('heightMm', item.heightMm, 'number', 'mm')];
    }
    case 'opening': {
      const item = object as ArchitectureOpening;
      return [field('offsetMm', item.offsetMm, 'number', 'mm'), field('widthMm', item.widthMm, 'number', 'mm'), field('heightMm', item.heightMm, 'number', 'mm'), field('sillMm', item.sillMm, 'number', 'mm')];
    }
    case 'ceiling': {
      if ('hostCeilingId' in object) {
        const item = object as InteriorCeilingSystem;
        return [field('kind', item.kind, 'enum'), field('elevationMm', item.elevationMm, 'number', 'mm'), ...(item.moduleMm ? [field('moduleMm', item.moduleMm, 'vector2', 'mm')] : [])];
      }
      const item = object as ArchitectureCeiling;
      return [field('elevationMm', item.elevationMm, 'number', 'mm'), ...(item.thicknessMm !== undefined ? [field('thicknessMm', item.thicknessMm, 'number', 'mm')] : [])];
    }
    case 'furniture': {
      const item = object as InteriorFurniture;
      return [field('positionMm', item.positionMm, 'vector3', 'mm'), field('sizeMm', item.sizeMm, 'vector3', 'mm'), field('clearanceMm', item.clearanceMm, 'number', 'mm'), field('rotationDeg', item.rotationDeg ?? 0, 'number', 'deg')];
    }
    case 'finish': {
      const item = object as InteriorFinish;
      return [field('surface', item.surface, 'enum'), field('material', item.material, 'text')];
    }
    case 'millwork': {
      const item = object as InteriorMillwork;
      return [field('positionMm', item.positionMm, 'vector3', 'mm'), field('sizeMm', item.sizeMm, 'vector3', 'mm'), field('material', item.material, 'text'), field('clearanceMm', item.clearanceMm, 'number', 'mm')];
    }
    case 'light': {
      const item = object as InteriorLight;
      return [field('positionMm', item.positionMm, 'vector3', 'mm'), field('suspensionMm', item.suspensionMm, 'number', 'mm'), field('lumens', item.lumens, 'number', 'lm'), field('cctK', item.cctK, 'number', 'K')];
    }
  }
}

type Candidate = { document: SelectionDocument; kind: ArchitectureInteriorSelectionKind; object: ArchitectureInteriorSelectionObject; storeyId?: string; spaceId?: string; hostIds: string[] };

function candidates(source: ArchitectureInteriorSelectionSource): Candidate[] {
  const { architecture: a, interior: i } = source;
  const storeyById = new Map(a.storeys.map(item => [item.id, item]));
  const spaceById = new Map(a.spaces.map(item => [item.id, item]));
  const wallById = new Map(a.walls.map(item => [item.id, item]));
  const ceilingById = new Map(a.ceilings.map(item => [item.id, item]));
  const result: Candidate[] = [];
  a.storeys.forEach(object => result.push({ document: 'architecture', kind: 'storey', object, storeyId: object.id, hostIds: [] }));
  a.spaces.forEach(object => result.push({ document: 'architecture', kind: 'space', object, storeyId: object.storeyId, spaceId: object.id, hostIds: [object.storeyId, ...object.wallIds, object.slabId, object.ceilingId] }));
  a.walls.forEach(object => result.push({ document: 'architecture', kind: 'wall', object, storeyId: object.storeyId, hostIds: [object.storeyId] }));
  a.openings.forEach(object => { const wall = wallById.get(object.hostWallId); result.push({ document: 'architecture', kind: 'opening', object, storeyId: wall?.storeyId, hostIds: [object.hostWallId, ...(wall ? [wall.storeyId] : [])] }); });
  a.ceilings.forEach(object => result.push({ document: 'architecture', kind: 'ceiling', object, storeyId: object.storeyId, spaceId: object.spaceId, hostIds: [object.storeyId, object.spaceId] }));
  i.furniture.forEach(object => { const space = spaceById.get(object.spaceId); result.push({ document: 'interior', kind: 'furniture', object, storeyId: space?.storeyId, spaceId: object.spaceId, hostIds: [object.spaceId, ...(space ? [space.storeyId] : [])] }); });
  i.finishes.forEach(object => { const space = spaceById.get(object.spaceId); result.push({ document: 'interior', kind: 'finish', object, storeyId: space?.storeyId, spaceId: object.spaceId, hostIds: [object.spaceId, object.hostId, ...(space ? [space.storeyId] : [])] }); });
  (i.millwork ?? []).forEach(object => { const space = spaceById.get(object.spaceId); result.push({ document: 'interior', kind: 'millwork', object, storeyId: space?.storeyId, spaceId: object.spaceId, hostIds: [object.spaceId, ...(object.hostWallId ? [object.hostWallId] : []), ...(space ? [space.storeyId] : [])] }); });
  i.lights.forEach(object => { const space = spaceById.get(object.spaceId); result.push({ document: 'interior', kind: 'light', object, storeyId: space?.storeyId, spaceId: object.spaceId, hostIds: [object.spaceId, object.hostCeilingId, ...(space ? [space.storeyId] : [])] }); });
  (i.ceilingSystems ?? []).forEach(object => { const space = spaceById.get(object.spaceId); result.push({ document: 'interior', kind: 'ceiling', object, storeyId: space?.storeyId, spaceId: object.spaceId, hostIds: [object.spaceId, object.hostCeilingId, ...(space ? [space.storeyId] : [])] }); });
  // Keep the map reads above explicit: a malformed host must be rejected by
  // resolveSelection rather than silently repaired or guessed.
  void storeyById;
  void ceilingById;
  return result;
}

function validHost(candidate: Candidate, source: ArchitectureInteriorSelectionSource): boolean {
  const a = source.architecture;
  const i = source.interior;
  const storeyIds = new Set(a.storeys.map(item => item.id));
  const spaceById = new Map(a.spaces.map(item => [item.id, item]));
  const wallById = new Map(a.walls.map(item => [item.id, item]));
  const slabById = new Map(a.slabs.map(item => [item.id, item]));
  const ceilingById = new Map(a.ceilings.map(item => [item.id, item]));
  if (candidate.storeyId && !storeyIds.has(candidate.storeyId)) return false;
  if (candidate.kind === 'opening') return wallById.has((candidate.object as ArchitectureOpening).hostWallId);
  if (candidate.kind === 'space') {
    const item = candidate.object as ArchitectureSpace;
    return storeyIds.has(item.storeyId) && item.wallIds.every(id => wallById.has(id)) && slabById.get(item.slabId)?.spaceId === item.id && ceilingById.get(item.ceilingId)?.spaceId === item.id;
  }
  if (candidate.kind === 'ceiling' && candidate.document === 'architecture') {
    const item = candidate.object as ArchitectureCeiling;
    return storeyIds.has(item.storeyId) && spaceById.get(item.spaceId)?.storeyId === item.storeyId;
  }
  if (candidate.kind === 'furniture') return spaceById.has((candidate.object as InteriorFurniture).spaceId);
  if (candidate.kind === 'finish') {
    const item = candidate.object as InteriorFinish;
    const space = spaceById.get(item.spaceId);
    return Boolean(space && (item.surface === 'wall' ? space.wallIds.includes(item.hostId) : item.surface === 'floor' ? slabById.get(item.hostId)?.spaceId === item.spaceId : ceilingById.get(item.hostId)?.spaceId === item.spaceId));
  }
  if (candidate.kind === 'millwork') {
    const item = candidate.object as InteriorMillwork;
    const space = spaceById.get(item.spaceId);
    return Boolean(space && (!item.hostWallId || (space.wallIds.includes(item.hostWallId) && wallById.get(item.hostWallId)?.storeyId === space.storeyId)));
  }
  if (candidate.kind === 'light') {
    const item = candidate.object as InteriorLight;
    return spaceById.has(item.spaceId) && ceilingById.get(item.hostCeilingId)?.spaceId === item.spaceId;
  }
  if (candidate.kind === 'ceiling' && candidate.document === 'interior') {
    const item = candidate.object as InteriorCeilingSystem;
    return spaceById.has(item.spaceId) && ceilingById.get(item.hostCeilingId)?.spaceId === item.spaceId;
  }
  void i;
  return true;
}

export function createArchitectureInteriorSelection(
  source: ArchitectureInteriorSelectionSource,
  kind: ArchitectureInteriorSelectionKind,
  objectId: string,
  document?: SelectionDocument,
): SelectionResolution {
  try {
    if (!validId(source.projectId) || !validId(source.architectureDocumentId) || !validId(source.interiorDocumentId) || source.interior.architectureDocumentId !== source.architectureDocumentId || !Number.isSafeInteger(source.architecture.revision) || source.architecture.revision < 0 || source.interior.revision !== source.architecture.revision || !validSelectionKind(kind) || (document !== undefined && (!validSelectionDocument(document) || !validDocumentKind(document, kind))) || !validId(objectId)) return { ok: false, code: 'INVALID_SELECTION' };
    const matches = candidates(source).filter(item => item.kind === kind && item.object.id === objectId && (!document || item.document === document));
    if (matches.length === 0) return { ok: false, code: 'MISSING_OBJECT' };
    if (matches.length > 1) return { ok: false, code: 'AMBIGUOUS_OBJECT' };
    const candidate = matches[0]!;
    if (!validHost(candidate, source)) return { ok: false, code: 'INVALID_HOST' };
    const selection: ArchitectureInteriorSelection = { schema: ARCHITECTURE_INTERIOR_SELECTION_SCHEMA, projectId: source.projectId, architectureDocumentId: source.architectureDocumentId, interiorDocumentId: source.interiorDocumentId, revision: source.architecture.revision, document: candidate.document, kind, objectId, selectionKey: selectionKey(candidate.document, kind, objectId) };
    return { ok: true, value: { selection, document: candidate.document, object: structuredClone(candidate.object), storeyId: candidate.storeyId, spaceId: candidate.spaceId, hostIds: [...candidate.hostIds], editableFields: fieldsFor(kind, candidate.object) } };
  } catch {
    // Runtime payloads can come from a reconnect/local-storage boundary and
    // may not satisfy the TypeScript source shape. Never let malformed data
    // escape as an exception or become an editable selection.
    return { ok: false, code: 'INVALID_SELECTION' };
  }
}

export function resolveArchitectureInteriorSelection(selection: unknown, source: ArchitectureInteriorSelectionSource): SelectionResolution {
  try {
    if (!selection || typeof selection !== 'object') return { ok: false, code: 'INVALID_SELECTION' };
    const value = selection as Partial<ArchitectureInteriorSelection>;
    if (value.schema !== ARCHITECTURE_INTERIOR_SELECTION_SCHEMA || !validId(value.projectId) || !validId(value.architectureDocumentId) || !validId(value.interiorDocumentId) || !validId(value.objectId) || !validSelectionKind(value.kind) || !validSelectionDocument(value.document) || !validDocumentKind(value.document, value.kind) || !Number.isSafeInteger(value.revision) || !validId(value.selectionKey)) return { ok: false, code: 'INVALID_SELECTION' };
    if (value.projectId !== source.projectId) return { ok: false, code: 'PROJECT_MISMATCH' };
    if (value.architectureDocumentId !== source.architectureDocumentId || value.interiorDocumentId !== source.interiorDocumentId) return { ok: false, code: 'DOCUMENT_MISMATCH' };
    if (value.revision !== source.architecture.revision || source.interior.revision !== source.architecture.revision) return { ok: false, code: 'STALE_REVISION' };
    if (value.selectionKey !== selectionKey(value.document, value.kind, value.objectId)) return { ok: false, code: 'INVALID_SELECTION' };
    const created = createArchitectureInteriorSelection(source, value.kind, value.objectId, value.document);
    if (!created.ok) return created;
    return created.value.selection.selectionKey === value.selectionKey ? created : { ok: false, code: 'KIND_MISMATCH' };
  } catch {
    return { ok: false, code: 'INVALID_SELECTION' };
  }
}
