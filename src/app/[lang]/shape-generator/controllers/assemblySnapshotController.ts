import type { AssemblyMate } from '../assembly/AssemblyMates';
import type { PlacedPart } from '../assembly/PartPlacementPanel';
import type { BodyEntry } from '../panels/BodyPanel';
import type { NfabAssemblySnapshotV1 } from '../io/nfabFormat';

export interface AssemblySnapshotState {
  placedParts: PlacedPart[];
  mates: AssemblyMate[];
  bodies: BodyEntry[];
  activeBodyId: string | null;
  selectedBodyIds: string[];
  hiddenParts: ReadonlySet<string>;
  transparentParts: ReadonlySet<string>;
  partColors: Record<string, string>;
}

export interface AssemblyRestorePatch {
  placedParts: PlacedPart[];
  mates: AssemblyMate[];
  bodies: BodyEntry[];
  activeBodyId: string | null;
  selectedBodyIds: string[];
  hiddenParts: Set<string>;
  transparentParts: Set<string>;
  partColors: Record<string, string>;
}

const ownData = (value: unknown, key: string): unknown => {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  try {
    return Boolean(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
  } catch {
    return false;
  }
};

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function clonePlacedPart(value: unknown): PlacedPart | undefined {
  if (!isRecord(value)) return undefined;
  const id = ownData(value, 'id'); const name = ownData(value, 'name'); const shapeId = ownData(value, 'shapeId');
  const params = ownData(value, 'params'); const qty = ownData(value, 'qty');
  const position = ownData(value, 'position'); const rotation = ownData(value, 'rotation');
  if (typeof id !== 'string' || typeof name !== 'string' || typeof shapeId !== 'string' || !isRecord(params) ||
      !finiteNumber(qty) || !Array.isArray(position) || position.length !== 3 || !position.every(finiteNumber) ||
      !Array.isArray(rotation) || rotation.length !== 3 || !rotation.every(finiteNumber)) return undefined;
  const out: PlacedPart = { id, name, shapeId, params: {}, qty, position: [...position] as PlacedPart['position'], rotation: [...rotation] as PlacedPart['rotation'] };
  for (const key of Object.keys(params)) { const n = ownData(params, key); if (finiteNumber(n)) out.params[key] = n; }
  const materialId = ownData(value, 'materialId'); const color = ownData(value, 'color'); const fixed = ownData(value, 'fixed');
  if (typeof materialId === 'string') out.materialId = materialId;
  if (typeof color === 'string') out.color = color;
  if (typeof fixed === 'boolean') out.fixed = fixed;
  return out;
}

function cloneMate(value: unknown): AssemblyMate | undefined {
  if (!isRecord(value)) return undefined;
  const id = ownData(value, 'id'); const type = ownData(value, 'type'); const partA = ownData(value, 'partA');
  const partB = ownData(value, 'partB'); const locked = ownData(value, 'locked');
  if (typeof id !== 'string' || typeof type !== 'string' || typeof partA !== 'string' || typeof partB !== 'string' || typeof locked !== 'boolean') return undefined;
  const out = { id, type, partA, partB, locked } as AssemblyMate;
  for (const key of ['faceA', 'faceB', 'value', 'min', 'max', 'faceA2'] as const) { const n = ownData(value, key); if (finiteNumber(n)) out[key] = n; }
  return out;
}

function cloneBody(value: unknown): BodyEntry | undefined {
  if (!isRecord(value)) return undefined;
  const id = ownData(value, 'id'); const name = ownData(value, 'name'); const color = ownData(value, 'color');
  const visible = ownData(value, 'visible'); const locked = ownData(value, 'locked');
  if (typeof id !== 'string' || typeof name !== 'string' || typeof color !== 'string' || typeof visible !== 'boolean' || typeof locked !== 'boolean') return undefined;
  const out: BodyEntry = { id, name, color, visible, locked };
  const merged = ownData(value, 'mergedFrom');
  if (Array.isArray(merged) && merged.every((x): x is string => typeof x === 'string')) out.mergedFrom = [...merged];
  const split = ownData(value, 'splitFrom');
  if (isRecord(split) && typeof ownData(split, 'bodyId') === 'string' && finiteNumber(ownData(split, 'plane')) && finiteNumber(ownData(split, 'offset')))
    out.splitFrom = { bodyId: ownData(split, 'bodyId') as string, plane: ownData(split, 'plane') as number, offset: ownData(split, 'offset') as number };
  return out;
}

export function createAssemblySnapshot(state: AssemblySnapshotState): NfabAssemblySnapshotV1 {
  const snapshot: NfabAssemblySnapshotV1 = {
    placedParts: state.placedParts.map(clonePlacedPart).filter((x): x is PlacedPart => Boolean(x)),
    mates: state.mates.map(cloneMate).filter((x): x is AssemblyMate => Boolean(x)),
  };
  if (state.bodies.length > 0) {
    snapshot.bodies = state.bodies.map(cloneBody).filter((x): x is BodyEntry => Boolean(x));
    snapshot.activeBodyId = state.activeBodyId;
    if (state.selectedBodyIds.length > 0) snapshot.selectedBodyIds = [...state.selectedBodyIds];
  }
  if (state.hiddenParts.size > 0) snapshot.hiddenParts = [...state.hiddenParts];
  if (state.transparentParts.size > 0) snapshot.transparentParts = [...state.transparentParts];
  if (Object.keys(state.partColors).length > 0) snapshot.partColors = { ...state.partColors };
  return snapshot;
}

export function createAssemblyRestorePatch(snapshot?: unknown): AssemblyRestorePatch {
  if (!isRecord(snapshot)) return { placedParts: [], mates: [], bodies: [], activeBodyId: null, selectedBodyIds: [], hiddenParts: new Set(), transparentParts: new Set(), partColors: {} };
  const rawPlacedParts = ownData(snapshot, 'placedParts');
  const rawMates = ownData(snapshot, 'mates');
  const rawBodies = ownData(snapshot, 'bodies');
  const placedParts = Array.isArray(rawPlacedParts) ? rawPlacedParts.map(clonePlacedPart).filter((x): x is PlacedPart => Boolean(x)) : [];
  const mates = Array.isArray(rawMates) ? rawMates.map(cloneMate).filter((x): x is AssemblyMate => Boolean(x)) : [];
  const bodies = Array.isArray(rawBodies) ? rawBodies.map(cloneBody).filter((x): x is BodyEntry => Boolean(x)) : [];
  const bodyIds = new Set(bodies.map(body => body.id));
  const requestedActive = ownData(snapshot, 'activeBodyId');
  const activeBodyId = bodies.length === 0 ? null : (typeof requestedActive === 'string' && bodyIds.has(requestedActive) ? requestedActive : bodies[0]!.id);
  const selected = ownData(snapshot, 'selectedBodyIds');
  const selectedBodyIds = Array.isArray(selected) ? selected.filter((id): id is string => typeof id === 'string' && bodyIds.has(id)) : [];
  const strings = (key: 'hiddenParts' | 'transparentParts') => { const value = ownData(snapshot, key); return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []); };
  const colors: Record<string, string> = {}; const rawColors = ownData(snapshot, 'partColors');
  if (isRecord(rawColors)) for (const key of Object.keys(rawColors)) { const color = ownData(rawColors, key); if (typeof color === 'string') colors[key] = color; }
  return { placedParts, mates, bodies, activeBodyId, selectedBodyIds, hiddenParts: strings('hiddenParts'), transparentParts: strings('transparentParts'), partColors: colors };
}
