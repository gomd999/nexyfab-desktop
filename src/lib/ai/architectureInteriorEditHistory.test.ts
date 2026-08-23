import { describe, expect, it } from 'vitest';
import {
  applyArchitectureInteriorEditHistoryCommand,
  createArchitectureInteriorEditHistory,
  deserializeArchitectureInteriorEditHistory,
  redoArchitectureInteriorEditHistory,
  serializeArchitectureInteriorEditHistory,
  undoArchitectureInteriorEditHistory,
  validateArchitectureInteriorEditHistory,
} from './architectureInteriorEditHistory';
import { hashArchitectureInteriorEvidenceV2, hashArchitectureInteriorWorkspaceV2, type ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import type { ArchitectureDocument, ArchitectureEdit, InteriorDocument } from './architectureInteriorDocuments';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from './designArtifactGraph';

const architecture: ArchitectureDocument = {
  schema: 'nexyfab.architecture.v1', revision: 1,
  storeys: [{ id: 'st', name: 'Ground', elevationMm: 0, heightMm: 3000 }],
  walls: [
    { id: 'w1', kind: 'line', storeyId: 'st', startMm: [0, 0], endMm: [100, 0], thicknessMm: 10, heightMm: 3000 },
    { id: 'w2', kind: 'line', storeyId: 'st', startMm: [100, 0], endMm: [100, 100], thicknessMm: 10, heightMm: 3000 },
    { id: 'w3', kind: 'line', storeyId: 'st', startMm: [100, 100], endMm: [0, 0], thicknessMm: 10, heightMm: 3000 },
  ],
  slabs: [{ id: 'sl', storeyId: 'st', spaceId: 'sp', boundaryMm: [[0, 0], [100, 0], [100, 100]], thicknessMm: 10 }],
  ceilings: [{ id: 'ce', storeyId: 'st', spaceId: 'sp', boundaryMm: [[0, 0], [100, 0], [100, 100]], elevationMm: 2800 }],
  spaces: [{ id: 'sp', storeyId: 'st', name: 'Room', usage: 'office', boundaryMm: [[0, 0], [100, 0], [100, 100]], wallIds: ['w1', 'w2', 'w3'], slabId: 'sl', ceilingId: 'ce' }],
  openings: [],
};
const interior: InteriorDocument = { schema: 'nexyfab.interior.v1', revision: 1, architectureDocumentId: 'arch', lights: [], furniture: [], finishes: [] };
const frame = (id: string, kind: 'project' | 'site' | 'building' | 'storey' | 'object', parentId?: string, objectId?: string) => ({ id, kind, ...(parentId ? { parentId } : {}), ...(objectId ? { objectId, documentId: 'arch' } : {}), ...(kind === 'storey' ? { storeyId: 'st' } : {}), originMm: [0, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] });

function fixture(): ArchitectureInteriorWorkspaceV2 {
  const evidence = { revision: 1 };
  const draft = {
    schema: 'nexyfab.architecture-interior-workspace.v2', projectId: 'p',
    workspace: { projectId: 'p', revision: 1, contentHash: '', track: 'ai_design' as const, maturity: 'concept' as const }, contentHash: '',
    units: { sourceUnit: 'mm' as const, geometryUnit: 'mm' as const, analysisUnit: 'SI' as const },
    coordinates: [frame('project', 'project'), frame('site', 'site', 'project'), frame('building', 'building', 'site'), frame('storey', 'storey', 'building'), ...['st', 'w1', 'w2', 'w3', 'sl', 'ce', 'sp'].map(id => frame(`obj-${id}`, 'object', 'storey', id))],
    architecture: { documentId: 'arch', document: structuredClone(architecture), geometry: { representation: 'bim' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'seed', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'seed', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'seed-a', kind: 'user' as const, contentHash: 'a'.repeat(64) }] },
    interior: { documentId: 'int', document: structuredClone(interior), geometry: { representation: 'procedural' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'seed', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'seed', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'seed-i', kind: 'user' as const, contentHash: 'b'.repeat(64) }] },
    artifactGraph: { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'p', revision: 1, artifacts: [{ id: 'model', kind: 'model' as const, revision: 1, contentHash: 'c'.repeat(64), state: 'current' as const, inputs: [], verification: { status: 'passed' as const, verifierId: 'seed', evidenceHash: 'd'.repeat(64), issues: [] }, staleBecause: [] }], dependencies: [] },
  } as ArchitectureInteriorWorkspaceV2;
  const contentHash = hashArchitectureInteriorWorkspaceV2(draft);
  return { ...draft, contentHash, workspace: { ...draft.workspace, contentHash } };
}

function command(history: ReturnType<typeof createArchitectureInteriorEditHistory>, commandId: string, actorSource: 'user' | 'ai', endX: number) {
  return { commandId, actorSource, expectedRevision: history.current.workspace.revision, expectedContentHash: history.current.contentHash, edit: { kind: 'move_line_wall' as const, wallId: 'w1', startMm: [0, 0] as [number, number], endMm: [endX, 0] as [number, number] } };
}

describe('architecture/interior edit history', () => {
  function applyCreate(edit: ArchitectureEdit, expectedCreatedIds: string[]) {
    const initial = createArchitectureInteriorEditHistory(fixture());
    const applied = applyArchitectureInteriorEditHistoryCommand(initial, {
      commandId: `create-${expectedCreatedIds.join('-')}`,
      actorSource: 'user',
      expectedRevision: initial.current.workspace.revision,
      expectedContentHash: initial.current.contentHash,
      edit,
    });
    expect(applied.committed).toBe(true);
    if (!applied.committed) return;
    expect(applied.entry.affectedObjectIds).toEqual([...expectedCreatedIds].sort());
    for (const id of expectedCreatedIds) {
      expect(applied.workspace.coordinates.some(frame => frame.kind === 'object' && frame.objectId === id)).toBe(true);
    }
    const undone = undoArchitectureInteriorEditHistory(applied.history, {
      actorSource: 'user', expectedRevision: applied.workspace.workspace.revision,
      expectedContentHash: applied.workspace.contentHash,
    });
    expect(undone.committed).toBe(true);
    if (!undone.committed) return;
    for (const id of expectedCreatedIds) {
      expect(undone.workspace.architecture.document.storeys.some(item => item.id === id)
        || undone.workspace.architecture.document.spaces.some(item => item.id === id)
        || undone.workspace.architecture.document.walls.some(item => item.id === id)
        || undone.workspace.architecture.document.slabs.some(item => item.id === id)
        || undone.workspace.architecture.document.ceilings.some(item => item.id === id)
        || undone.workspace.architecture.document.openings.some(item => item.id === id)
        || undone.workspace.architecture.document.grids?.some(item => item.id === id)
        || undone.workspace.interior.document.furniture.some(item => item.id === id)
        || undone.workspace.interior.document.lights.some(item => item.id === id)
        || undone.workspace.interior.document.finishes.some(item => item.id === id)
        || undone.workspace.interior.document.millwork?.some(item => item.id === id)
        || Boolean(undone.workspace.interior.document.ceilingSystems?.some(item => item.id === id))).toBe(false);
    }
    const reconnected = deserializeArchitectureInteriorEditHistory(serializeArchitectureInteriorEditHistory(undone.history));
    const redone = redoArchitectureInteriorEditHistory(reconnected, {
      actorSource: 'user', expectedRevision: reconnected.current.workspace.revision,
      expectedContentHash: reconnected.current.contentHash,
    });
    expect(redone.committed).toBe(true);
    if (!redone.committed) return;
    for (const id of expectedCreatedIds) {
      expect(redone.entry.affectedObjectIds).toContain(id);
      expect(redone.workspace.coordinates.some(frame => frame.kind === 'object' && frame.objectId === id)).toBe(true);
    }
  }

  it('applies and recovers architecture create operations with exact semantic/frame deltas', () => {
    applyCreate({ kind: 'create_storey', storey: { id: 'st2', name: 'Upper', elevationMm: 3000, heightMm: 2800 } }, ['st2']);
    applyCreate({ kind: 'create_wall', wall: { id: 'w4', kind: 'line', storeyId: 'st', startMm: [0, 100], endMm: [100, 100], thicknessMm: 10, heightMm: 3000 } }, ['w4']);
    applyCreate({ kind: 'create_opening', opening: { id: 'op1', kind: 'window', hostWallId: 'w1', offsetMm: 20, widthMm: 20, heightMm: 1200, sillMm: 900, positionMm: [0, 0, 0] } }, ['op1']);
    applyCreate({ kind: 'create_grid', grid: { id: 'g1', name: 'A', axis: 'x', startMm: [0, 0], endMm: [100, 0] } }, ['g1']);
    applyCreate({
      kind: 'create_space',
      space: { id: 'sp2', storeyId: 'st', name: 'Meeting', usage: 'meeting', boundaryMm: [[0, 0], [100, 0], [100, 100]], wallIds: ['w1', 'w2', 'w3'], slabId: 'sl2', ceilingId: 'ce2' },
      slab: { id: 'sl2', storeyId: 'st', spaceId: 'sp2', boundaryMm: [[0, 0], [100, 0], [100, 100]], thicknessMm: 120 },
      ceiling: { id: 'ce2', storeyId: 'st', spaceId: 'sp2', boundaryMm: [[0, 0], [100, 0], [100, 100]], elevationMm: 2800, thicknessMm: 20 },
    }, ['ce2', 'sl2', 'sp2']);
  });

  it('applies and recovers each supported interior create operation without losing hosts', () => {
    applyCreate({ kind: 'create_furniture', furniture: { id: 'fur1', spaceId: 'sp', positionMm: [70, 30, 100], sizeMm: [10, 10, 10], clearanceMm: 1 } }, ['fur1']);
    applyCreate({ kind: 'create_light', light: { id: 'light1', spaceId: 'sp', hostCeilingId: 'ce', positionMm: [50, 50, 2800], suspensionMm: 0, lumens: 1000, cctK: 4000 } }, ['light1']);
    applyCreate({ kind: 'create_finish', finish: { id: 'finish1', spaceId: 'sp', hostId: 'sl', surface: 'floor', material: 'oak' } }, ['finish1']);
    applyCreate({ kind: 'create_millwork', millwork: { id: 'mw1', spaceId: 'sp', hostWallId: 'w1', positionMm: [70, 30, 100], sizeMm: [20, 10, 100], material: 'oak', clearanceMm: 0 } }, ['mw1']);
    applyCreate({ kind: 'create_ceiling_system', ceilingSystem: { id: 'rcp1', spaceId: 'sp', hostCeilingId: 'ce', kind: 'grid', elevationMm: 2750, moduleMm: [600, 600] } }, ['rcp1']);
  });

  it('rejects forged create snapshots during reconnect', () => {
    const initial = createArchitectureInteriorEditHistory(fixture());
    const applied = applyArchitectureInteriorEditHistoryCommand(initial, {
      commandId: 'create-tamper-wall', actorSource: 'user',
      expectedRevision: initial.current.workspace.revision,
      expectedContentHash: initial.current.contentHash,
      edit: { kind: 'create_wall', wall: { id: 'tamper-w1', kind: 'line', storeyId: 'st', startMm: [0, 100], endMm: [100, 100], thicknessMm: 10, heightMm: 3000 } },
    });
    expect(applied.committed).toBe(true);
    if (!applied.committed) return;
    const undone = undoArchitectureInteriorEditHistory(applied.history, {
      actorSource: 'user', expectedRevision: applied.workspace.workspace.revision,
      expectedContentHash: applied.workspace.contentHash,
    });
    expect(undone.committed).toBe(true);
    if (!undone.committed) return;
    const forged = JSON.parse(serializeArchitectureInteriorEditHistory(undone.history)) as typeof undone.history;
    forged.future[0]!.entry.afterWorkspace.coordinates = forged.future[0]!.entry.afterWorkspace.coordinates.filter(frame => frame.objectId !== 'tamper-w1');
    expect(() => deserializeArchitectureInteriorEditHistory(JSON.stringify(forged))).toThrow('serialization_invalid');
  });

  it('applies atomically, preserves ids, and records artifact invalidation provenance', () => {
    const initial = fixture();
    const history = createArchitectureInteriorEditHistory(initial);
    const result = applyArchitectureInteriorEditHistoryCommand(history, command(history, 'manual-1', 'user', 120));
    expect(result.committed).toBe(true);
    if (!result.committed) return;
    expect(result.workspace.workspace.revision).toBe(2);
    expect(result.workspace.architecture.document.walls[0]?.id).toBe('w1');
    expect(result.entry.actorSource).toBe('user');
    expect(result.entry.artifactInvalidation).toMatchObject({ reason: 'edit_applied', artifactIds: ['model'] });
    expect(initial).toEqual(history.current);
  });

  it('rejects stale and duplicate commands without mutating history', () => {
    const history = createArchitectureInteriorEditHistory(fixture());
    const first = applyArchitectureInteriorEditHistoryCommand(history, command(history, 'manual-1', 'user', 120));
    expect(first.committed).toBe(true);
    if (!first.committed) return;
    const stale = applyArchitectureInteriorEditHistoryCommand(first.history, { ...command(history, 'stale', 'ai', 130), expectedRevision: 1, expectedContentHash: history.current.contentHash });
    expect(stale).toMatchObject({ committed: false, code: 'stale_command' });
    const duplicate = applyArchitectureInteriorEditHistoryCommand(first.history, command(first.history, 'manual-1', 'user', 130));
    expect(duplicate).toMatchObject({ committed: false, code: 'duplicate_command' });
    expect(first.history.current.architecture.document.walls[0]).toMatchObject({ endMm: [120, 0] });
  });

  it('keeps AI/manual ownership separate and fails closed on an interleaved undo', () => {
    const initial = createArchitectureInteriorEditHistory(fixture());
    const manual = applyArchitectureInteriorEditHistoryCommand(initial, command(initial, 'manual-1', 'user', 120));
    expect(manual.committed).toBe(true);
    if (!manual.committed) return;
    const ai = applyArchitectureInteriorEditHistoryCommand(manual.history, command(manual.history, 'ai-1', 'ai', 130));
    expect(ai.committed).toBe(true);
    if (!ai.committed) return;
    const undoManual = undoArchitectureInteriorEditHistory(ai.history, { actorSource: 'user', expectedRevision: 3, expectedContentHash: ai.workspace.contentHash });
    expect(undoManual).toMatchObject({ committed: false, code: 'actor_conflict' });
    const undoAi = undoArchitectureInteriorEditHistory(ai.history, { actorSource: 'ai', expectedRevision: 3, expectedContentHash: ai.workspace.contentHash });
    expect(undoAi).toMatchObject({ committed: true, workspace: { workspace: { revision: 4 } } });
  });

  it('undoes, redoes, and survives serialized reconnect with monotonic revisions', () => {
    const initial = createArchitectureInteriorEditHistory(fixture());
    const applied = applyArchitectureInteriorEditHistoryCommand(initial, command(initial, 'manual-1', 'user', 120));
    expect(applied.committed).toBe(true);
    if (!applied.committed) return;
    const undone = undoArchitectureInteriorEditHistory(applied.history, { actorSource: 'user', expectedRevision: 2, expectedContentHash: applied.workspace.contentHash });
    expect(undone.committed).toBe(true);
    if (!undone.committed) return;
    expect(undone.workspace.workspace.revision).toBe(3);
    expect(undone.workspace.artifactGraph.artifacts[0]?.state).toBe('stale');
    const reconnected = deserializeArchitectureInteriorEditHistory(serializeArchitectureInteriorEditHistory(undone.history));
    const redone = redoArchitectureInteriorEditHistory(reconnected, { actorSource: 'user', expectedRevision: 3, expectedContentHash: reconnected.current.contentHash });
    expect(redone).toMatchObject({ committed: true, workspace: { workspace: { revision: 4 } } });
    if (redone.committed) {
      expect(redone.workspace.architecture.document.walls[0]).toMatchObject({ id: 'w1', endMm: [120, 0] });
      expect(redone.entry.artifactInvalidation.reason).toBe('edit_redone');
    }
  });

  it('rejects reordered/current-swapped snapshots and forged future preconditions on reconnect', () => {
    const initial = createArchitectureInteriorEditHistory(fixture());
    const first = applyArchitectureInteriorEditHistoryCommand(initial, command(initial, 'manual-1', 'user', 120));
    expect(first.committed).toBe(true);
    if (!first.committed) return;
    const second = applyArchitectureInteriorEditHistoryCommand(first.history, command(first.history, 'manual-2', 'user', 130));
    expect(second.committed).toBe(true);
    if (!second.committed) return;
    const encoded = JSON.parse(serializeArchitectureInteriorEditHistory(second.history)) as typeof second.history;
    expect(() => deserializeArchitectureInteriorEditHistory(JSON.stringify({ ...encoded, past: [...encoded.past].reverse() }))).toThrow('serialization_invalid');
    expect(() => deserializeArchitectureInteriorEditHistory(JSON.stringify({ ...encoded, current: encoded.past[0]!.beforeWorkspace }))).toThrow('serialization_invalid');

    const undone = undoArchitectureInteriorEditHistory(second.history, { actorSource: 'user', expectedRevision: 3, expectedContentHash: second.workspace.contentHash });
    expect(undone.committed).toBe(true);
    if (!undone.committed) return;
    const forged = JSON.parse(serializeArchitectureInteriorEditHistory(undone.history)) as typeof undone.history;
    forged.future[0]!.expectedContentHash = 'f'.repeat(64);
    expect(() => deserializeArchitectureInteriorEditHistory(JSON.stringify(forged))).toThrow('serialization_invalid');
  });

  it('rejects a reordered multi-undo future stack before reconnect', () => {
    const initial = createArchitectureInteriorEditHistory(fixture());
    const first = applyArchitectureInteriorEditHistoryCommand(initial, command(initial, 'manual-1', 'user', 120));
    expect(first.committed).toBe(true);
    if (!first.committed) return;
    const second = applyArchitectureInteriorEditHistoryCommand(first.history, command(first.history, 'manual-2', 'user', 130));
    expect(second.committed).toBe(true);
    if (!second.committed) return;
    const undoSecond = undoArchitectureInteriorEditHistory(second.history, { actorSource: 'user', expectedRevision: 3, expectedContentHash: second.workspace.contentHash });
    expect(undoSecond.committed).toBe(true);
    if (!undoSecond.committed) return;
    const undoFirst = undoArchitectureInteriorEditHistory(undoSecond.history, { actorSource: 'user', expectedRevision: 4, expectedContentHash: undoSecond.workspace.contentHash });
    expect(undoFirst.committed).toBe(true);
    if (!undoFirst.committed) return;
    expect(undoFirst.history.future).toHaveLength(2);
    const encoded = JSON.parse(serializeArchitectureInteriorEditHistory(undoFirst.history)) as typeof undoFirst.history;
    expect(() => deserializeArchitectureInteriorEditHistory(JSON.stringify({ ...encoded, future: [...encoded.future].reverse() }))).toThrow('serialization_invalid');
  });

  it('fails closed instead of throwing for malformed nested reconnect history', () => {
    const initial = createArchitectureInteriorEditHistory(fixture());
    const malformed = {
      ...initial,
      past: [{ beforeWorkspace: { architecture: undefined } }],
    } as unknown as ReturnType<typeof createArchitectureInteriorEditHistory>;
    expect(validateArchitectureInteriorEditHistory(malformed)).toEqual(['invalid_history']);
    expect(applyArchitectureInteriorEditHistoryCommand(malformed, command(initial, 'malformed', 'user', 120)))
      .toMatchObject({ committed: false, code: 'invalid_history' });
    expect(() => deserializeArchitectureInteriorEditHistory(JSON.stringify(malformed))).toThrow('serialization_invalid');
  });

  it('rejects a re-hashed apply snapshot whose geometry no longer matches its edit', () => {
    const initial = createArchitectureInteriorEditHistory(fixture());
    const applied = applyArchitectureInteriorEditHistoryCommand(initial, command(initial, 'semantic-tamper', 'user', 120));
    expect(applied.committed).toBe(true);
    if (!applied.committed) return;
    const forged = JSON.parse(serializeArchitectureInteriorEditHistory(applied.history)) as typeof applied.history;
    const entry = forged.past[0]!;
    const after = entry.afterWorkspace;
    const forgedWall = after.architecture.document.walls[0]!;
    if (forgedWall.kind !== 'line') throw new Error('fixture_wall_kind_changed');
    forgedWall.endMm = [999, 0];
    const geometryPayload = after.architecture.geometry.payload as Record<string, unknown>;
    geometryPayload.walls = structuredClone(after.architecture.document.walls);
    after.architecture.geometry.contentHash = hashArchitectureInteriorEvidenceV2(geometryPayload);
    const semanticPayload = after.architecture.semantic.payload as Record<string, unknown>;
    semanticPayload.document = structuredClone(after.architecture.document);
    after.architecture.semantic.contentHash = hashArchitectureInteriorEvidenceV2(semanticPayload);
    after.contentHash = '';
    after.workspace.contentHash = '';
    after.contentHash = hashArchitectureInteriorWorkspaceV2(after);
    after.workspace.contentHash = after.contentHash;
    entry.after.contentHash = after.contentHash;
    entry.artifactInvalidation.targetContentHash = after.contentHash;
    forged.current = structuredClone(after);
    expect(() => deserializeArchitectureInteriorEditHistory(JSON.stringify(forged))).toThrow('serialization_invalid');
  });

  it('records checked storey/space edits with frame rebinds through history and undo/redo', () => {
    const before = fixture();
    before.architecture.document.storeys.push({ id: 'st2', name: 'Upper', elevationMm: 4000, heightMm: 3000 });
    before.coordinates.push({ id: 'storey-st2', kind: 'storey', parentId: 'building', storeyId: 'st2', originMm: [0, 0, 4000], rotationDeg: [0, 0, 0] }, { id: 'obj-st2', kind: 'object', parentId: 'storey-st2', objectId: 'st2', documentId: 'arch', originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
    const hash = hashArchitectureInteriorWorkspaceV2(before); before.contentHash = hash; before.workspace.contentHash = hash;
    const history = createArchitectureInteriorEditHistory(before);
    const applied = applyArchitectureInteriorEditHistoryCommand(history, { commandId: 'move-space-to-st2', actorSource: 'user', expectedRevision: 1, expectedContentHash: history.current.contentHash, edit: { kind: 'edit_space', spaceId: 'sp', storeyId: 'st2' } });
    expect(applied.committed).toBe(true);
    if (!applied.committed) return;
    expect(applied.workspace.coordinates.find(item => item.objectId === 'sp')?.parentId).toBe('storey-st2');
    const undone = undoArchitectureInteriorEditHistory(applied.history, { actorSource: 'user', expectedRevision: 2, expectedContentHash: applied.workspace.contentHash });
    expect(undone.committed).toBe(true);
    if (!undone.committed) return;
    expect(undone.workspace.coordinates.find(item => item.objectId === 'sp')?.parentId).toBe('storey');
    const redone = redoArchitectureInteriorEditHistory(undone.history, { actorSource: 'user', expectedRevision: 3, expectedContentHash: undone.workspace.contentHash });
    expect(redone.committed).toBe(true);
    if (redone.committed) expect(redone.workspace.coordinates.find(item => item.objectId === 'sp')?.parentId).toBe('storey-st2');
  });
});
