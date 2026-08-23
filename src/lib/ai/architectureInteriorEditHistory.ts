import {
  executeArchitectureInteriorConceptTransaction,
  type ConceptTransactionResult,
} from './architectureInteriorConceptTransaction';
import type { ArchitectureEdit } from './architectureInteriorDocuments';
import {
  hashArchitectureInteriorWorkspaceV2,
  validateArchitectureInteriorWorkspaceV2,
  type ArchitectureInteriorWorkspaceV2,
} from './architectureInteriorWorkspace';

/**
 * A small, immutable history envelope for the concept editor.
 *
 * The workspace store remains the source of truth for persistence.  This
 * module deliberately keeps the history as snapshots: replaying an old edit
 * against a changed wall/host is unsafe and would turn a stale command into a
 * valid-looking edit.  Snapshot rebasing gives undo/redo a new monotonic
 * revision while retaining the exact semantic state that was selected.
 */
export const ARCHITECTURE_INTERIOR_EDIT_HISTORY_SCHEMA =
  'nexyfab.architecture-interior-edit-history.v1' as const;

export type EditHistoryActorSource = 'user' | 'ai' | 'import' | 'catalog' | 'expert';
export type EditHistoryOperation = 'apply' | 'undo' | 'redo';

export type ArchitectureInteriorEditCommand = {
  commandId: string;
  actorSource: EditHistoryActorSource;
  edit: ArchitectureEdit;
  expectedRevision: number;
  expectedContentHash: string;
};

export type ArchitectureInteriorArtifactInvalidation = {
  reason: 'edit_applied' | 'edit_undone' | 'edit_redone';
  commandId: string;
  sourceRevision: number;
  sourceContentHash: string;
  targetRevision: number;
  targetContentHash: string;
  artifactIds: string[];
};

export type ArchitectureInteriorEditHistoryEntry = {
  schema: 'nexyfab.architecture-interior-edit-history-entry.v1';
  commandId: string;
  /** Stable lineage key; undo/redo entries remain tied to the command they reverse. */
  historyKey: string;
  actorSource: EditHistoryActorSource;
  operation: EditHistoryOperation;
  edit: ArchitectureEdit;
  before: { revision: number; contentHash: string };
  after: { revision: number; contentHash: string };
  affectedObjectIds: string[];
  invalidatedChecks: string[];
  artifactInvalidation: ArchitectureInteriorArtifactInvalidation;
  beforeWorkspace: ArchitectureInteriorWorkspaceV2;
  afterWorkspace: ArchitectureInteriorWorkspaceV2;
};

type FutureEntry = {
  entry: ArchitectureInteriorEditHistoryEntry;
  expectedRevision: number;
  expectedContentHash: string;
  undoneByCommandId: string;
};

export type ArchitectureInteriorEditHistory = {
  schema: typeof ARCHITECTURE_INTERIOR_EDIT_HISTORY_SCHEMA;
  projectId: string;
  current: ArchitectureInteriorWorkspaceV2;
  past: ArchitectureInteriorEditHistoryEntry[];
  future: FutureEntry[];
  actorHeads: Partial<Record<EditHistoryActorSource, {
    commandId: string;
    revision: number;
    contentHash: string;
  }>>;
};

export type EditHistoryFailureCode =
  | 'invalid_history'
  | 'stale_command'
  | 'duplicate_command'
  | 'actor_conflict'
  | 'nothing_to_undo'
  | 'nothing_to_redo'
  | 'transaction_failed'
  | 'invalid_snapshot'
  | 'serialization_invalid';

export type EditHistorySuccess = {
  committed: true;
  history: ArchitectureInteriorEditHistory;
  workspace: ArchitectureInteriorWorkspaceV2;
  entry: ArchitectureInteriorEditHistoryEntry;
};

export type EditHistoryFailure = {
  committed: false;
  history: ArchitectureInteriorEditHistory;
  workspace: ArchitectureInteriorWorkspaceV2;
  code: EditHistoryFailureCode;
};

export type EditHistoryResult = EditHistorySuccess | EditHistoryFailure;

const SHA256 = /^[a-f0-9]{64}$/;
const ACTORS = new Set<EditHistoryActorSource>(['user', 'ai', 'import', 'catalog', 'expert']);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validWorkspace(workspace: ArchitectureInteriorWorkspaceV2): boolean {
  try {
    return validateArchitectureInteriorWorkspaceV2(workspace).length === 0
      && SHA256.test(workspace.contentHash)
      && workspace.workspace.contentHash === workspace.contentHash
      && hashArchitectureInteriorWorkspaceV2(workspace) === workspace.contentHash;
  } catch {
    return false;
  }
}

function frameRebindObjectIds(before: ArchitectureInteriorWorkspaceV2, edit: ArchitectureEdit): Set<string> {
  const architecture = before.architecture.document;
  const interior = before.interior.document;
  const ids = new Set<string>();
  if (edit.kind === 'edit_stair') ids.add(edit.stairId);
  if (edit.kind === 'edit_shaft') ids.add(edit.shaftId);
  if (edit.kind === 'edit_elevator') ids.add(edit.elevatorId);
  if (edit.kind === 'edit_service_opening') ids.add(edit.serviceOpeningId);
  if (edit.kind === 'edit_space') {
    const space = architecture.spaces.find(item => item.id === edit.spaceId);
    if (space) {
      ids.add(space.id); ids.add(space.slabId); ids.add(space.ceilingId); space.wallIds.forEach(id => ids.add(id));
      architecture.openings.filter(opening => space.wallIds.includes(opening.hostWallId)).forEach(opening => ids.add(opening.id));
      architecture.serviceOpenings?.filter(opening => ids.has(opening.hostId)).forEach(opening => ids.add(opening.id));
      interior.lights.filter(item => item.spaceId === space.id).forEach(item => ids.add(item.id));
      interior.furniture.filter(item => item.spaceId === space.id).forEach(item => ids.add(item.id));
      interior.finishes.filter(item => item.spaceId === space.id).forEach(item => ids.add(item.id));
      interior.millwork?.filter(item => item.spaceId === space.id).forEach(item => ids.add(item.id));
      interior.ceilingSystems?.filter(item => item.spaceId === space.id).forEach(item => ids.add(item.id));
      interior.acousticZones?.filter(item => item.spaceId === space.id).forEach(item => ids.add(item.id));
    }
  }
  return ids;
}

/** Compare identity while allowing only the known host-frame rebindings that
 * a bounded edit is responsible for. Frame IDs, object IDs, and document
 * ownership remain immutable; arbitrary parent changes still fail closed. */
function identityCompatible(before: ArchitectureInteriorWorkspaceV2, after: ArchitectureInteriorWorkspaceV2, edit: ArchitectureEdit): boolean {
  const beforeArchitecture = before.architecture.document;
  const beforeInterior = before.interior.document;
  const beforeIds = [
    ...beforeArchitecture.storeys, ...beforeArchitecture.spaces, ...beforeArchitecture.walls,
    ...beforeArchitecture.slabs, ...beforeArchitecture.ceilings, ...beforeArchitecture.openings,
    ...(beforeArchitecture.serviceOpenings ?? []), ...(beforeArchitecture.grids ?? []), ...(beforeArchitecture.roofs ?? []),
    ...(beforeArchitecture.stairs ?? []), ...(beforeArchitecture.shafts ?? []), ...(beforeArchitecture.elevators ?? []), ...(beforeArchitecture.zones ?? []),
    ...beforeInterior.lights, ...beforeInterior.furniture, ...beforeInterior.finishes,
    ...(beforeInterior.millwork ?? []), ...(beforeInterior.ceilingSystems ?? []), ...(beforeInterior.acousticZones ?? []),
  ].map(item => item.id).sort();
  const afterArchitecture = after.architecture.document;
  const afterInterior = after.interior.document;
  const afterIds = [
    ...afterArchitecture.storeys, ...afterArchitecture.spaces, ...afterArchitecture.walls,
    ...afterArchitecture.slabs, ...afterArchitecture.ceilings, ...afterArchitecture.openings,
    ...(afterArchitecture.serviceOpenings ?? []), ...(afterArchitecture.grids ?? []), ...(afterArchitecture.roofs ?? []),
    ...(afterArchitecture.stairs ?? []), ...(afterArchitecture.shafts ?? []), ...(afterArchitecture.elevators ?? []), ...(afterArchitecture.zones ?? []),
    ...afterInterior.lights, ...afterInterior.furniture, ...afterInterior.finishes,
    ...(afterInterior.millwork ?? []), ...(afterInterior.ceilingSystems ?? []), ...(afterInterior.acousticZones ?? []),
  ].map(item => item.id).sort();
  if (JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) return false;
  const allowed = frameRebindObjectIds(before, edit);
  const beforeFrames = new Map(before.coordinates.map(frame => [frame.id, frame]));
  const afterFrames = new Map(after.coordinates.map(frame => [frame.id, frame]));
  if (beforeFrames.size !== afterFrames.size || [...beforeFrames.keys()].some(id => !afterFrames.has(id))) return false;
  for (const [id, oldFrame] of beforeFrames) {
    const nextFrame = afterFrames.get(id)!;
    if (oldFrame.kind !== nextFrame.kind || oldFrame.objectId !== nextFrame.objectId || oldFrame.documentId !== nextFrame.documentId || oldFrame.storeyId !== nextFrame.storeyId) return false;
    if (oldFrame.parentId !== nextFrame.parentId && (!nextFrame.objectId || !allowed.has(nextFrame.objectId))) return false;
  }
  return true;
}

type CreateTransitionDirection = 'add' | 'remove';

function objectIdList(workspace: ArchitectureInteriorWorkspaceV2): string[] {
  const architecture = workspace.architecture.document;
  const interior = workspace.interior.document;
  return [
    ...architecture.storeys, ...architecture.spaces, ...architecture.walls,
    ...architecture.slabs, ...architecture.ceilings, ...architecture.openings,
    ...(architecture.serviceOpenings ?? []), ...(architecture.grids ?? []),
    ...(architecture.roofs ?? []), ...(architecture.stairs ?? []), ...(architecture.shafts ?? []), ...(architecture.elevators ?? []), ...(architecture.zones ?? []),
    ...interior.lights, ...interior.furniture, ...interior.finishes,
    ...(interior.millwork ?? []), ...(interior.ceilingSystems ?? []), ...(interior.acousticZones ?? []),
  ].map(item => item.id);
}

function frameSignature(frame: ArchitectureInteriorWorkspaceV2['coordinates'][number]): string {
  return [frame.id, frame.kind, frame.parentId ?? '', frame.objectId ?? '', frame.documentId ?? ''].join('|');
}

function frameSignatures(workspace: ArchitectureInteriorWorkspaceV2): string[] {
  return workspace.coordinates.map(frameSignature);
}

function createdObjectIds(edit: ArchitectureInteriorEditCommand['edit']): string[] | null {
  switch (edit.kind) {
    case 'create_storey': return [edit.storey.id];
    case 'create_wall': return [edit.wall.id];
    case 'create_space': return [edit.space.id, edit.slab.id, edit.ceiling.id];
    case 'create_opening': return [edit.opening.id];
    case 'create_grid': return [edit.grid.id];
    case 'create_furniture': return [edit.furniture.id];
    case 'create_light': return [edit.light.id];
    case 'create_finish': return [edit.finish.id];
    case 'create_millwork': return [edit.millwork.id];
    case 'create_ceiling_system': return [edit.ceilingSystem.id];
    default: return null;
  }
}

/**
 * Creation is the one permitted identity-changing transaction.  Keep this
 * check deliberately structural: a successful transaction may only add (or
 * remove on undo) the exact semantic bundle and its coordinate frames named
 * by the command.  This prevents a forged snapshot from hiding extra IDs.
 */
function createTransitionValid(
  before: ArchitectureInteriorWorkspaceV2,
  after: ArchitectureInteriorWorkspaceV2,
  edit: ArchitectureInteriorEditCommand['edit'],
  direction: CreateTransitionDirection,
): boolean {
  const expected = createdObjectIds(edit);
  if (!expected || new Set(expected).size !== expected.length) return false;
  const beforeIds = new Set(objectIdList(before));
  const afterIds = new Set(objectIdList(after));
  const addedIds = [...afterIds].filter(id => !beforeIds.has(id)).sort();
  const removedIds = [...beforeIds].filter(id => !afterIds.has(id)).sort();
  const expectedIds = [...expected].sort();
  if (direction === 'add'
    ? JSON.stringify(addedIds) !== JSON.stringify(expectedIds) || removedIds.length !== 0
    : JSON.stringify(removedIds) !== JSON.stringify(expectedIds) || addedIds.length !== 0) return false;

  const beforeFrames = new Set(frameSignatures(before));
  const afterFrames = new Set(frameSignatures(after));
  const addedFrames = after.coordinates.filter(frame => !beforeFrames.has(frameSignature(frame)));
  const removedFrames = before.coordinates.filter(frame => !afterFrames.has(frameSignature(frame)));
  const changedFrames = direction === 'add' ? addedFrames : removedFrames;
  const untouchedFrames = direction === 'add' ? removedFrames : addedFrames;
  const expectedFrameCount = edit.kind === 'create_storey' ? 2 : expected.length;
  if (untouchedFrames.length !== 0 || changedFrames.length !== expectedFrameCount) return false;
  if (edit.kind === 'create_storey') {
    const storeyFrame = changedFrames.find(frame => frame.kind === 'storey');
    const objectFrame = changedFrames.find(frame => frame.kind === 'object');
    return changedFrames.length === 2
      && storeyFrame?.storeyId === edit.storey.id
      && storeyFrame.objectId === undefined
      && objectFrame?.objectId === edit.storey.id
      && objectFrame.documentId === before.architecture.documentId;
  }
  const architectureKind = edit.kind === 'create_wall' || edit.kind === 'create_space'
    || edit.kind === 'create_opening' || edit.kind === 'create_grid';
  const frameIds = changedFrames.map(frame => frame.objectId).sort();
  return changedFrames.every(frame => frame.kind === 'object'
      && frame.objectId
      && frame.documentId === (architectureKind ? before.architecture.documentId : before.interior.documentId))
    && JSON.stringify(frameIds) === JSON.stringify(expectedIds);
}

function staleArtifacts(
  workspace: ArchitectureInteriorWorkspaceV2,
  commandId: string,
): ArchitectureInteriorWorkspaceV2['artifactGraph'] {
  return {
    ...clone(workspace.artifactGraph),
    artifacts: workspace.artifactGraph.artifacts.map(artifact => ({
      ...clone(artifact),
      state: 'stale' as const,
      verification: {
        ...clone(artifact.verification),
        status: 'not_run' as const,
        evidenceHash: undefined,
        issues: ['edit_history_changed'],
      },
      staleBecause: [...new Set([...artifact.staleBecause, commandId])],
    })),
  };
}

function rebaseSnapshot(
  source: ArchitectureInteriorWorkspaceV2,
  revision: number,
  commandId: string,
): ArchitectureInteriorWorkspaceV2 | null {
  const result = clone(source);
  result.workspace.revision = revision;
  result.architecture.document.revision = revision;
  result.interior.document.revision = revision;
  result.artifactGraph.revision = revision;
  result.artifactGraph = staleArtifacts(result, commandId);
  result.contentHash = '';
  result.workspace.contentHash = '';
  try {
    const contentHash = hashArchitectureInteriorWorkspaceV2(result);
    result.contentHash = contentHash;
    result.workspace.contentHash = contentHash;
    return validWorkspace(result) ? result : null;
  } catch {
    return null;
  }
}

function artifactInvalidation(
  source: ArchitectureInteriorWorkspaceV2,
  target: ArchitectureInteriorWorkspaceV2,
  reason: ArchitectureInteriorArtifactInvalidation['reason'],
  commandId: string,
): ArchitectureInteriorArtifactInvalidation {
  return {
    reason, commandId,
    sourceRevision: source.workspace.revision,
    sourceContentHash: source.contentHash,
    targetRevision: target.workspace.revision,
    targetContentHash: target.contentHash,
    artifactIds: target.artifactGraph.artifacts.map(artifact => artifact.id).sort(),
  };
}

function actorHeads(past: readonly ArchitectureInteriorEditHistoryEntry[], current: ArchitectureInteriorWorkspaceV2) {
  const result: ArchitectureInteriorEditHistory['actorHeads'] = {};
  for (const entry of past) {
    result[entry.actorSource] = {
      commandId: entry.commandId,
      revision: current.workspace.revision,
      contentHash: current.contentHash,
    };
  }
  return result;
}

function sameSnapshot(left: ArchitectureInteriorWorkspaceV2, right: ArchitectureInteriorWorkspaceV2): boolean {
  return left.projectId === right.projectId
    && left.workspace.revision === right.workspace.revision
    && left.contentHash === right.contentHash;
}

function sortedUniqueStrings(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(item => typeof item === 'string' && item.trim())
    && new Set(value).size === value.length
    && JSON.stringify(value) === JSON.stringify([...value].sort());
}

function artifactInvalidationValid(entry: ArchitectureInteriorEditHistoryEntry): boolean {
  const invalidation = entry.artifactInvalidation;
  if (!invalidation || invalidation.commandId !== entry.commandId
    || invalidation.reason !== ({ apply: 'edit_applied', undo: 'edit_undone', redo: 'edit_redone' } as const)[entry.operation]
    || invalidation.sourceRevision !== entry.before.revision
    || invalidation.targetRevision !== entry.after.revision
    || invalidation.sourceContentHash !== entry.before.contentHash
    || invalidation.targetContentHash !== entry.after.contentHash
    || !sortedUniqueStrings(invalidation.artifactIds)) return false;
  const targetIds = entry.afterWorkspace.artifactGraph.artifacts.map(artifact => artifact.id).sort();
  return JSON.stringify(invalidation.artifactIds) === JSON.stringify(targetIds);
}

/** Apply entries must remain tied to the edit that produced their snapshot.
 * Hashes prove integrity, but a reconnect payload can still be re-hashed after
 * changing geometry. Replaying the bounded concept transaction closes that
 * semantic forgery path without replaying undo/redo snapshots. */
function appliedSnapshotMatchesCommand(entry: ArchitectureInteriorEditHistoryEntry): boolean {
  if (entry.operation !== 'apply') return true;
  try {
    const transaction = executeArchitectureInteriorConceptTransaction({
      workspace: entry.beforeWorkspace,
      edit: entry.edit,
      actorSource: entry.actorSource,
    });
    return transaction.committed && JSON.stringify(transaction.workspace) === JSON.stringify(entry.afterWorkspace);
  } catch {
    return false;
  }
}

function snapshotTransitionMatchesHistory(
  history: ArchitectureInteriorEditHistory,
  index: number,
  entry: ArchitectureInteriorEditHistoryEntry,
): boolean {
  if (entry.operation === 'apply') return appliedSnapshotMatchesCommand(entry);
  const previous = history.past.slice(0, index);
  const source = [...previous].reverse().find(item => item.historyKey === entry.historyKey && (item.operation === 'apply' || item.operation === 'redo'));
  if (!source) return false;
  const snapshot = entry.operation === 'undo'
    ? rebaseSnapshot(source.beforeWorkspace, entry.after.revision, entry.commandId)
    : rebaseSnapshot(source.afterWorkspace, entry.after.revision, entry.commandId);
  return Boolean(snapshot && JSON.stringify(snapshot) === JSON.stringify(entry.afterWorkspace));
}

function historyValidUnchecked(history: ArchitectureInteriorEditHistory): boolean {
  if (!history || history.schema !== ARCHITECTURE_INTERIOR_EDIT_HISTORY_SCHEMA
    || typeof history.projectId !== 'string' || history.current?.projectId !== history.projectId
    || !Array.isArray(history.past) || !Array.isArray(history.future) || !validWorkspace(history.current)) return false;
  const ids = new Set<string>();
  for (let index = 0; index < history.past.length; index += 1) {
    const entry = history.past[index]!;
    if (!validEntry(entry) || ids.has(entry.commandId) || entry.afterWorkspace.projectId !== history.projectId) return false;
    if (!snapshotTransitionMatchesHistory(history, index, entry)) return false;
    ids.add(entry.commandId);
    if (index > 0) {
      const previous = history.past[index - 1]!;
      if (previous.after.revision !== entry.before.revision
        || previous.after.contentHash !== entry.before.contentHash) return false;
    }
  }
  const last = history.past.at(-1);
  if (last && (!sameSnapshot(last.afterWorkspace, history.current)
    || last.afterWorkspace.contentHash !== history.current.contentHash)) return false;
  const futureIds = new Set<string>();
  for (let index = 0; index < history.future.length; index += 1) {
    const item = history.future[index]!;
    if (!item || !validEntry(item.entry) || futureIds.has(item.entry.commandId)
      || !Number.isSafeInteger(item.expectedRevision) || item.expectedRevision < 0
      || !SHA256.test(item.expectedContentHash)
      || typeof item.undoneByCommandId !== 'string' || !item.undoneByCommandId.trim()) return false;
    futureIds.add(item.entry.commandId);
    const sourceEntry = history.past.find(entry => entry.commandId === item.entry.commandId);
    const undoEntry = history.past.find(entry => entry.commandId === item.undoneByCommandId);
    if (!sourceEntry || JSON.stringify(sourceEntry) !== JSON.stringify(item.entry)
      || !undoEntry || undoEntry.operation !== 'undo' || undoEntry.historyKey !== item.entry.historyKey
      || undoEntry.after.revision !== item.expectedRevision
      || undoEntry.after.contentHash !== item.expectedContentHash) return false;
    const previous = history.future[index - 1];
    if (previous && previous.expectedRevision >= item.expectedRevision) return false;
  }
  const nextRedo = history.future.at(-1);
  if (nextRedo && (nextRedo.expectedRevision !== history.current.workspace.revision
    || nextRedo.expectedContentHash !== history.current.contentHash)) return false;
  const heads = actorHeads(history.past, history.current);
  if (JSON.stringify(heads) !== JSON.stringify(history.actorHeads ?? {})) return false;
  return true;
}

/**
 * History may be supplied by local storage or a reconnect response. Keep all
 * structural inspection behind a total predicate: malformed runtime data
 * must fail closed, rather than throwing while reading a nested document.
 */
function historyValid(history: ArchitectureInteriorEditHistory): boolean {
  try {
    return historyValidUnchecked(history);
  } catch {
    return false;
  }
}

function validEntry(entry: ArchitectureInteriorEditHistoryEntry): boolean {
  if (!entry || entry.schema !== 'nexyfab.architecture-interior-edit-history-entry.v1'
    || typeof entry.commandId !== 'string' || !entry.commandId.trim()
    || typeof entry.historyKey !== 'string' || !entry.historyKey.trim()
    || !ACTORS.has(entry.actorSource) || !['apply', 'undo', 'redo'].includes(entry.operation)
    || !entry.before || !entry.after || !entry.beforeWorkspace || !entry.afterWorkspace) return false;
  const objectIds = new Set([...objectIdList(entry.beforeWorkspace), ...objectIdList(entry.afterWorkspace)]);
  const createEdit = createdObjectIds(entry.edit);
  const transitionDirection: CreateTransitionDirection = entry.operation === 'undo' ? 'remove' : 'add';
  return SHA256.test(entry.before.contentHash) && SHA256.test(entry.after.contentHash)
    && entry.before.revision === entry.beforeWorkspace.workspace.revision
    && entry.after.revision === entry.afterWorkspace.workspace.revision
    && entry.after.revision === entry.before.revision + 1
    && validWorkspace(entry.beforeWorkspace) && validWorkspace(entry.afterWorkspace)
      && (createEdit
      ? createTransitionValid(entry.beforeWorkspace, entry.afterWorkspace, entry.edit, transitionDirection)
      : identityCompatible(entry.beforeWorkspace, entry.afterWorkspace, entry.edit))
     && entry.beforeWorkspace.contentHash === entry.before.contentHash
     && entry.afterWorkspace.contentHash === entry.after.contentHash
     && artifactInvalidationValid(entry)
     && appliedSnapshotMatchesCommand(entry)
     && sortedUniqueStrings(entry.affectedObjectIds)
    && entry.affectedObjectIds.every(id => objectIds.has(id))
    && (!createEdit || JSON.stringify(entry.affectedObjectIds) === JSON.stringify([...createEdit].sort()))
    && sortedUniqueStrings(entry.invalidatedChecks);
}

export function createArchitectureInteriorEditHistory(
  workspace: ArchitectureInteriorWorkspaceV2,
): ArchitectureInteriorEditHistory {
  if (!validWorkspace(workspace)) throw new Error('invalid_workspace');
  return {
    schema: ARCHITECTURE_INTERIOR_EDIT_HISTORY_SCHEMA,
    projectId: workspace.projectId,
    current: clone(workspace),
    past: [], future: [], actorHeads: {},
  };
}

function failure(history: ArchitectureInteriorEditHistory, code: EditHistoryFailureCode): EditHistoryFailure {
  return { committed: false, history, workspace: history.current, code };
}

function preconditionMatches(history: ArchitectureInteriorEditHistory, revision: number, contentHash: string): boolean {
  return Number.isSafeInteger(revision) && revision === history.current.workspace.revision
    && contentHash === history.current.contentHash;
}

function commandValid(command: ArchitectureInteriorEditCommand): boolean {
  return Boolean(command && typeof command.commandId === 'string' && command.commandId.trim()
    && ACTORS.has(command.actorSource) && Number.isSafeInteger(command.expectedRevision)
    && command.expectedRevision >= 0 && SHA256.test(command.expectedContentHash) && command.edit);
}

export function applyArchitectureInteriorEditHistoryCommand(
  history: ArchitectureInteriorEditHistory,
  command: ArchitectureInteriorEditCommand,
): EditHistoryResult {
  if (!historyValid(history) || !commandValid(command)) return failure(history, 'invalid_history');
  if (!preconditionMatches(history, command.expectedRevision, command.expectedContentHash)) return failure(history, 'stale_command');
  if ([...history.past, ...history.future.map(item => item.entry)].some(item => item.commandId === command.commandId)) return failure(history, 'duplicate_command');
  let transaction: ConceptTransactionResult;
  try {
    transaction = executeArchitectureInteriorConceptTransaction({ workspace: history.current, edit: command.edit, actorSource: command.actorSource });
  } catch {
    return failure(history, 'transaction_failed');
  }
  if (!transaction.committed || !validWorkspace(transaction.workspace)) return failure(history, 'transaction_failed');
  const createEdit = createdObjectIds(command.edit);
  if (createEdit) {
    const transitionValid = createTransitionValid(history.current, transaction.workspace, command.edit, 'add');
    if (!transitionValid) return failure(history, 'transaction_failed');
  } else if (!identityCompatible(history.current, transaction.workspace, command.edit)) return failure(history, 'transaction_failed');
  const entry: ArchitectureInteriorEditHistoryEntry = {
    schema: 'nexyfab.architecture-interior-edit-history-entry.v1', commandId: command.commandId,
    historyKey: command.commandId,
    actorSource: command.actorSource, operation: 'apply', edit: clone(command.edit),
    before: { revision: history.current.workspace.revision, contentHash: history.current.contentHash },
    after: { revision: transaction.workspace.workspace.revision, contentHash: transaction.workspace.contentHash },
    affectedObjectIds: [...transaction.affectedObjectIds].sort(), invalidatedChecks: [...transaction.invalidatedChecks].sort(),
    artifactInvalidation: artifactInvalidation(history.current, transaction.workspace, 'edit_applied', command.commandId),
    beforeWorkspace: clone(history.current), afterWorkspace: clone(transaction.workspace),
  };
  const next: ArchitectureInteriorEditHistory = {
    ...history, current: clone(transaction.workspace), past: [...history.past, entry], future: [],
    actorHeads: actorHeads([...history.past, entry], transaction.workspace),
  };
  return { committed: true, history: next, workspace: next.current, entry };
}

export function undoArchitectureInteriorEditHistory(
  history: ArchitectureInteriorEditHistory,
  input: { actorSource: EditHistoryActorSource; expectedRevision: number; expectedContentHash: string },
): EditHistoryResult {
  if (!historyValid(history) || !ACTORS.has(input?.actorSource)) return failure(history, 'invalid_history');
  if (!preconditionMatches(history, input.expectedRevision, input.expectedContentHash)) return failure(history, 'stale_command');
  const undoneLineages = new Set(history.future.map(item => item.entry.historyKey));
  const source = [...history.past].reverse().find(entry => (entry.operation === 'apply' || entry.operation === 'redo') && !undoneLineages.has(entry.historyKey));
  if (!source) return failure(history, 'nothing_to_undo');
  if (source.actorSource !== input.actorSource) return failure(history, 'actor_conflict');
  const commandId = `${source.commandId}:undo:${history.current.workspace.revision + 1}`;
  const restored = rebaseSnapshot(source.beforeWorkspace, history.current.workspace.revision + 1, commandId);
  if (!restored) return failure(history, 'invalid_snapshot');
  if (createdObjectIds(source.edit)
    ? !createTransitionValid(restored, history.current, source.edit, 'add')
    : !identityCompatible(history.current, restored, source.edit)) return failure(history, 'invalid_snapshot');
  const entry: ArchitectureInteriorEditHistoryEntry = {
    ...clone(source), commandId, operation: 'undo',
    before: { revision: history.current.workspace.revision, contentHash: history.current.contentHash },
    after: { revision: restored.workspace.revision, contentHash: restored.contentHash },
    artifactInvalidation: artifactInvalidation(history.current, restored, 'edit_undone', commandId),
    beforeWorkspace: clone(history.current), afterWorkspace: clone(restored),
  };
  const nextPast = [...history.past, entry];
  const next: ArchitectureInteriorEditHistory = {
    ...history, current: restored, past: nextPast,
    future: [...history.future, { entry: source, expectedRevision: restored.workspace.revision, expectedContentHash: restored.contentHash, undoneByCommandId: commandId }],
    actorHeads: actorHeads(nextPast, restored),
  };
  return { committed: true, history: next, workspace: next.current, entry };
}

export function redoArchitectureInteriorEditHistory(
  history: ArchitectureInteriorEditHistory,
  input: { actorSource: EditHistoryActorSource; expectedRevision: number; expectedContentHash: string },
): EditHistoryResult {
  if (!historyValid(history) || !ACTORS.has(input?.actorSource)) return failure(history, 'invalid_history');
  if (!preconditionMatches(history, input.expectedRevision, input.expectedContentHash)) return failure(history, 'stale_command');
  const available = history.future.at(-1);
  if (!available) return failure(history, 'nothing_to_redo');
  if (available.entry.actorSource !== input.actorSource) return failure(history, 'actor_conflict');
  if (available.expectedRevision !== history.current.workspace.revision || available.expectedContentHash !== history.current.contentHash) return failure(history, 'stale_command');
  const commandId = `${available.entry.commandId}:redo:${history.current.workspace.revision + 1}`;
  const restored = rebaseSnapshot(available.entry.afterWorkspace, history.current.workspace.revision + 1, commandId);
  if (!restored) return failure(history, 'invalid_snapshot');
  if (createdObjectIds(available.entry.edit)
    ? !createTransitionValid(history.current, restored, available.entry.edit, 'add')
    : !identityCompatible(history.current, restored, available.entry.edit)) return failure(history, 'invalid_snapshot');
  const entry: ArchitectureInteriorEditHistoryEntry = {
    ...clone(available.entry), commandId, operation: 'redo',
    historyKey: available.entry.historyKey,
    before: { revision: history.current.workspace.revision, contentHash: history.current.contentHash },
    after: { revision: restored.workspace.revision, contentHash: restored.contentHash },
    artifactInvalidation: artifactInvalidation(history.current, restored, 'edit_redone', commandId),
    beforeWorkspace: clone(history.current), afterWorkspace: clone(restored),
  };
  const nextPast = [...history.past, entry];
  const next: ArchitectureInteriorEditHistory = {
    ...history, current: restored, past: nextPast, future: history.future.slice(0, -1),
    actorHeads: actorHeads(nextPast, restored),
  };
  return { committed: true, history: next, workspace: next.current, entry };
}

export function serializeArchitectureInteriorEditHistory(history: ArchitectureInteriorEditHistory): string {
  if (!historyValid(history)) throw new Error('invalid_history');
  return JSON.stringify(history);
}

export function deserializeArchitectureInteriorEditHistory(serialized: string): ArchitectureInteriorEditHistory {
  if (typeof serialized !== 'string' || serialized.length === 0) throw new Error('serialization_invalid');
  try {
    const parsed = JSON.parse(serialized) as ArchitectureInteriorEditHistory;
    if (!historyValid(parsed)) throw new Error('serialization_invalid');
    return clone(parsed);
  } catch {
    throw new Error('serialization_invalid');
  }
}

/** Reconnect is intentionally a decode + full hash/identity validation. */
export const recoverArchitectureInteriorEditHistory = deserializeArchitectureInteriorEditHistory;

export function validateArchitectureInteriorEditHistory(history: unknown): string[] {
  return historyValid(history as ArchitectureInteriorEditHistory) ? [] : ['invalid_history'];
}
