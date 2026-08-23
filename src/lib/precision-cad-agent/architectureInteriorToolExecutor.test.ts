import { describe, expect, it } from 'vitest';
import { executeArchitectureInteriorTool } from './architectureInteriorToolExecutor';
import { hashArchitectureInteriorEvidenceV2, hashArchitectureInteriorWorkspaceV2, type ArchitectureInteriorWorkspaceV2 } from '@/lib/ai/architectureInteriorWorkspace';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from '@/lib/ai/designArtifactGraph';
import { applyArchitectureInteriorEdit, type ArchitectureDocument, type InteriorDocument } from '@/lib/ai/architectureInteriorDocuments';

const architecture: ArchitectureDocument = {
  schema: 'nexyfab.architecture.v1', revision: 1, storeys: [{ id: 'st', name: 'Ground', elevationMm: 0, heightMm: 3000 }],
  walls: [
    { id: 'w1', kind: 'line', storeyId: 'st', startMm: [0, 0], endMm: [100, 0], thicknessMm: 10, heightMm: 3000 },
    { id: 'w2', kind: 'line', storeyId: 'st', startMm: [100, 0], endMm: [100, 100], thicknessMm: 10, heightMm: 3000 },
    { id: 'w3', kind: 'line', storeyId: 'st', startMm: [100, 100], endMm: [0, 0], thicknessMm: 10, heightMm: 3000 },
  ],
  slabs: [{ id: 'sl', storeyId: 'st', spaceId: 'sp', boundaryMm: [[0, 0], [100, 0], [100, 100]], thicknessMm: 10 }],
  ceilings: [{ id: 'ce', storeyId: 'st', spaceId: 'sp', boundaryMm: [[0, 0], [100, 0], [100, 100]], elevationMm: 2800 }],
  spaces: [{ id: 'sp', storeyId: 'st', name: 'Room', usage: 'office', boundaryMm: [[0, 0], [100, 0], [100, 100]], wallIds: ['w1', 'w2', 'w3'], slabId: 'sl', ceilingId: 'ce' }], openings: [],
};
const interior: InteriorDocument = { schema: 'nexyfab.interior.v1', revision: 1, architectureDocumentId: 'arch', lights: [], furniture: [], finishes: [] };
const frame = (id: string, kind: 'project' | 'site' | 'building' | 'storey' | 'object', parentId?: string, objectId?: string) => ({ id, kind, ...(parentId ? { parentId } : {}), ...(objectId ? { objectId, documentId: 'arch' } : {}), ...(kind === 'storey' ? { storeyId: 'st' } : {}), originMm: [0, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] });
function workspace(): ArchitectureInteriorWorkspaceV2 {
  const evidence = { revision: 1 };
  const draft = { schema: 'nexyfab.architecture-interior-workspace.v2', projectId: 'p', workspace: { projectId: 'p', revision: 1, contentHash: '', track: 'ai_design' as const, maturity: 'concept' as const }, contentHash: '', units: { sourceUnit: 'mm', geometryUnit: 'mm', analysisUnit: 'SI' }, coordinates: [frame('project', 'project'), frame('site', 'site', 'project'), frame('building', 'building', 'site'), frame('storey', 'storey', 'building'), ...['st', 'w1', 'w2', 'w3', 'sl', 'ce', 'sp'].map(id => frame(`obj-${id}`, 'object', 'storey', id))], architecture: { documentId: 'arch', document: architecture, geometry: { representation: 'bim', units: 'mm', fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'concept-gate', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 's', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'src', kind: 'user' as const, contentHash: 'a'.repeat(64) }] }, interior: { documentId: 'int', document: interior, geometry: { representation: 'procedural', units: 'mm', fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'concept-gate', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 's', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'src2', kind: 'user' as const, contentHash: 'b'.repeat(64) }] }, artifactGraph: { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'p', revision: 1, artifacts: [], dependencies: [] } } as ArchitectureInteriorWorkspaceV2;
  const contentHash = hashArchitectureInteriorWorkspaceV2(draft);
  return { ...draft, contentHash, workspace: { ...draft.workspace, contentHash } };
}
const binding = (value: ArchitectureInteriorWorkspaceV2) => ({ projectId: 'p', revision: 1, contentHash: value.contentHash });
function stairWorkspace(): ArchitectureInteriorWorkspaceV2 {
  const value = workspace();
  value.architecture.document = structuredClone(value.architecture.document);
  value.architecture.document.storeys.push({ id: 'st2', name: 'Upper', elevationMm: 3000, heightMm: 3000 });
  value.coordinates.push({ id: 'storey-st2', kind: 'storey', parentId: 'building', storeyId: 'st2', originMm: [0, 0, 3000], rotationDeg: [0, 0, 0] }, { id: 'obj-st2', kind: 'object', parentId: 'storey-st2', objectId: 'st2', documentId: 'arch', originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
  const contentHash = hashArchitectureInteriorWorkspaceV2(value);
  return { ...value, contentHash, workspace: { ...value.workspace, contentHash } };
}

describe('architecture/interior deterministic executor', () => {
  it('executes existing read/verify functions and returns no mutation', () => {
    const value = workspace();
    const result = executeArchitectureInteriorTool({ workspace: value, binding: binding(value), tool: 'verify_architecture', arguments: { revision: 1, documentId: 'arch', checkCode: 'basic' } });
    expect(result).toMatchObject({ ok: true, result: { pass: true } });
    expect(value.workspace.revision).toBe(1);
  });
  it('commits supported concept edits only after geometry and artifact evidence regenerate atomically', () => {
    const value = workspace();
    const result = executeArchitectureInteriorTool({ workspace: value, binding: binding(value), tool: 'edit_wall', approved: true, arguments: { revision: 1, documentId: 'arch', objectId: 'w1', parameterPaths: ['startMm', 'endMm', 'kind'], patch: { kind: 'line', startMm: [0, 0], endMm: [120, 0] } } });
    expect(result).toMatchObject({ ok: true, workspace: { workspace: { revision: 2 }, architecture: { geometry: { fidelity: 'conceptual', verification: { status: 'not_run' } } } } });
    expect(value.architecture.document.walls[0]).toMatchObject({ endMm: [100, 0] });
  });
  it('creates a wall with a stable identity and coordinate frame after approval', () => {
    const value = workspace();
    const result = executeArchitectureInteriorTool({ workspace: value, binding: { ...binding(value), objectId: 'w4' }, tool: 'create_wall', approved: true, arguments: { revision: 1, documentId: 'arch', objectId: 'w4', parameterPaths: ['storeyId', 'kind', 'startMm', 'endMm', 'thicknessMm', 'heightMm'], patch: { storeyId: 'st', kind: 'line', startMm: [0, 100], endMm: [100, 100], thicknessMm: 10, heightMm: 3000 } } });
    expect(result).toMatchObject({ ok: true, workspace: { workspace: { revision: 2 } } });
    if (result.ok && result.workspace) {
      expect(result.workspace.architecture.document.walls.some(wall => wall.id === 'w4')).toBe(true);
      expect(result.workspace.coordinates.some(frame => frame.objectId === 'w4' && frame.documentId === 'arch')).toBe(true);
    }
  });

  it('creates a complete explicit space/slab/ceiling bundle from a valid workspace', () => {
    const value = workspace();
    const result = executeArchitectureInteriorTool({ workspace: value, binding: { ...binding(value), objectId: 'sp2' }, tool: 'create_space', approved: true, arguments: { revision: 1, documentId: 'arch', objectId: 'sp2', parameterPaths: ['storeyId', 'name', 'usageCode', 'boundaryMm', 'wallIds', 'slabId', 'ceilingId', 'slabThicknessMm', 'ceilingElevationMm', 'ceilingThicknessMm'], patch: { storeyId: 'st', name: 'Room 2', usageCode: 'office', boundaryMm: [[0, 0], [100, 0], [100, 100]], wallIds: ['w1', 'w2', 'w3'], slabId: 'sl2', ceilingId: 'ce2', slabThicknessMm: 10, ceilingElevationMm: 2800, ceilingThicknessMm: 10 } } });
    expect(result).toMatchObject({ ok: true, workspace: { workspace: { revision: 2 } } });
    if (result.ok && result.workspace) {
      expect(result.workspace.architecture.document.spaces.some(space => space.id === 'sp2')).toBe(true);
      expect(result.workspace.architecture.document.slabs.some(slab => slab.id === 'sl2' && slab.spaceId === 'sp2')).toBe(true);
      expect(result.workspace.architecture.document.ceilings.some(ceiling => ceiling.id === 'ce2' && ceiling.spaceId === 'sp2')).toBe(true);
      expect(result.workspace.coordinates.filter(frame => ['sp2', 'sl2', 'ce2'].includes(frame.objectId ?? '')).length).toBe(3);
    }
  });

  it('rejects architecture creates bound to the interior document', () => {
    const value = workspace();
    const result = executeArchitectureInteriorTool({ workspace: value, binding: { ...binding(value), documentId: 'int', objectId: 'w4' }, tool: 'create_wall', approved: true, arguments: { revision: 1, documentId: 'int', objectId: 'w4', parameterPaths: ['storeyId', 'kind', 'startMm', 'endMm', 'thicknessMm', 'heightMm'], patch: { storeyId: 'st', kind: 'line', startMm: [0, 100], endMm: [100, 100], thicknessMm: 10, heightMm: 3000 } } });
    expect(result).toEqual({ ok: false, code: 'document_binding_mismatch' });
  });

  it('rejects mixed wall geometry and resize patches without partial application', () => {
    const value = workspace();
    const result = executeArchitectureInteriorTool({ workspace: value, binding: binding(value), tool: 'edit_wall', approved: true, arguments: { revision: 1, documentId: 'arch', objectId: 'w1', parameterPaths: ['kind', 'startMm', 'endMm', 'thicknessMm'], patch: { kind: 'line', startMm: [0, 0], endMm: [120, 0], thicknessMm: 20 } } });
    expect(result).toEqual({ ok: false, code: 'tool_not_executable' });
    expect(value.architecture.document.walls[0]).toMatchObject({ endMm: [100, 0], thicknessMm: 10 });
  });

  it('rejects create-space loops that cross storeys or do not match ordered boundary edges', () => {
    const crossStorey = structuredClone(architecture);
    crossStorey.storeys.push({ id: 'st2', name: 'Upper', elevationMm: 3000, heightMm: 3000 });
    crossStorey.walls.push({ id: 'w4', kind: 'line', storeyId: 'st2', startMm: [100, 100], endMm: [0, 0], thicknessMm: 10, heightMm: 3000 });
    const bundle = (wallIds: string[], boundaryMm = [[0, 0], [100, 0], [100, 100]] as [number, number][]) => ({ kind: 'create_space' as const, space: { id: 'sp2', storeyId: 'st', name: 'Room 2', usage: 'office', boundaryMm, wallIds, slabId: 'sl2', ceilingId: 'ce2' }, slab: { id: 'sl2', storeyId: 'st', spaceId: 'sp2', boundaryMm: structuredClone(boundaryMm), thicknessMm: 10 }, ceiling: { id: 'ce2', storeyId: 'st', spaceId: 'sp2', boundaryMm: structuredClone(boundaryMm), elevationMm: 2800, thicknessMm: 10 } });
    expect(() => applyArchitectureInteriorEdit(crossStorey, interior, bundle(['w1', 'w2', 'w4']))).toThrow('share the space storey');
    expect(() => applyArchitectureInteriorEdit(architecture, interior, bundle(['w1', 'w3', 'w2']))).toThrow('ordered closed line loop');
  });

  it('rejects a create with an unknown host storey and leaves the workspace untouched', () => {
    const value = workspace();
    const result = executeArchitectureInteriorTool({ workspace: value, binding: { ...binding(value), objectId: 'w4' }, tool: 'create_wall', approved: true, arguments: { revision: 1, documentId: 'arch', objectId: 'w4', parameterPaths: ['storeyId', 'kind', 'startMm', 'endMm', 'thicknessMm', 'heightMm'], patch: { storeyId: 'missing', kind: 'line', startMm: [0, 100], endMm: [100, 100], thicknessMm: 10, heightMm: 3000 } } });
    expect(result).toEqual({ ok: false, code: 'edit_failed' });
    expect(value.workspace.revision).toBe(1);
  });
  it('fails closed for contract-only tools, stale/tampered bindings, and missing approval', () => {
    const value = workspace();
    expect(executeArchitectureInteriorTool({ workspace: value, binding: binding(value), tool: 'render_plan', arguments: { revision: 1, documentId: 'arch', viewCode: 'plan' } })).toEqual({ ok: false, code: 'tool_not_executable' });
    expect(executeArchitectureInteriorTool({ workspace: value, binding: { ...binding(value), revision: 0 }, tool: 'verify_architecture', arguments: { revision: 1, documentId: 'arch', checkCode: 'basic' } })).toEqual({ ok: false, code: 'stale_revision' });
    expect(executeArchitectureInteriorTool({ workspace: value, binding: binding(value), tool: 'edit_wall', arguments: { revision: 1, documentId: 'arch', objectId: 'w1', parameterPaths: ['kind', 'startMm', 'endMm'], patch: { kind: 'line', startMm: [0, 0], endMm: [120, 0] } } })).toEqual({ ok: false, code: 'approval_required' });
  });

  it('does not run a verifier against the wrong domain document', () => {
    const value = workspace();
    expect(executeArchitectureInteriorTool({ workspace: value, binding: binding(value), tool: 'verify_interior', arguments: { revision: 1, documentId: 'arch', checkCode: 'basic' } })).toEqual({ ok: false, code: 'tool_not_executable' });
  });

  it('creates bounded furniture, light, finish, millwork, and ceiling/RCP objects atomically', () => {
    const value = workspace();
    const calls = [
      ['create_furniture', 'chair-1', ['spaceId', 'positionMm', 'sizeMm', 'clearanceMm'], { spaceId: 'sp', positionMm: [65, 25, 1], sizeMm: [10, 10, 10], clearanceMm: 1 }],
      ['create_light', 'light-1', ['spaceId', 'hostCeilingId', 'positionMm', 'suspensionMm', 'lumens', 'cctK'], { spaceId: 'sp', hostCeilingId: 'ce', positionMm: [20, 20, 2700], suspensionMm: 100, lumens: 3000, cctK: 4000 }],
      ['create_finish', 'finish-1', ['spaceId', 'hostId', 'surfaceCode', 'materialCode'], { spaceId: 'sp', hostId: 'sl', surfaceCode: 'floor', materialCode: 'oak' }],
      ['create_millwork', 'case-1', ['spaceId', 'positionMm', 'sizeMm', 'materialCode', 'clearanceMm'], { spaceId: 'sp', positionMm: [50, 20, 0], sizeMm: [10, 10, 10], materialCode: 'oak', clearanceMm: 1 }],
      ['create_ceiling_system', 'rcp-1', ['spaceId', 'hostCeilingId', 'kind', 'elevationMm', 'moduleMm'], { spaceId: 'sp', hostCeilingId: 'ce', kind: 'grid', elevationMm: 2700, moduleMm: [10, 10] }],
    ] as const;
    let current = value;
    for (const [tool, objectId, parameterPaths, patch] of calls) {
      const result = executeArchitectureInteriorTool({ workspace: current, binding: { projectId: 'p', revision: current.workspace.revision, contentHash: current.contentHash, documentId: 'int', objectId }, tool, approved: true, arguments: { revision: current.workspace.revision, documentId: 'int', objectId, parameterPaths, patch } });
      expect(result).toMatchObject({ ok: true });
      if (!result.ok || !result.workspace) throw new Error(`expected ${tool} to commit`);
      current = result.workspace;
    }
    expect(current.interior.document.furniture).toHaveLength(1);
    expect(current.interior.document.lights).toHaveLength(1);
    expect(current.interior.document.finishes).toHaveLength(1);
    expect(current.interior.document.millwork).toHaveLength(1);
    expect(current.interior.document.ceilingSystems).toHaveLength(1);
    expect(current.coordinates.filter(frame => frame.documentId === 'int')).toHaveLength(5);
  });

  it('rejects an interior create with a mismatched host and preserves the workspace', () => {
    const value = workspace();
    const result = executeArchitectureInteriorTool({ workspace: value, binding: { ...binding(value), documentId: 'int', objectId: 'finish-1' }, tool: 'create_finish', approved: true, arguments: { revision: 1, documentId: 'int', objectId: 'finish-1', parameterPaths: ['spaceId', 'hostId', 'surfaceCode', 'materialCode'], patch: { spaceId: 'sp', hostId: 'ce', surfaceCode: 'floor', materialCode: 'oak' } } });
    expect(result).toEqual({ ok: false, code: 'edit_failed' });
    expect(value.workspace.revision).toBe(1);
    expect(value.interior.document.finishes).toHaveLength(0);
  });

  it('rejects cross-space wall hosts, unbound light elevations, and escaped millwork envelopes', () => {
    const foreignWallArchitecture = structuredClone(architecture);
    foreignWallArchitecture.walls.push({ id: 'foreign-wall', kind: 'line', storeyId: 'st', startMm: [200, 0], endMm: [200, 100], thicknessMm: 10, heightMm: 3000 });
    expect(() => applyArchitectureInteriorEdit(foreignWallArchitecture, interior, { kind: 'create_finish', finish: { id: 'bad-finish', spaceId: 'sp', hostId: 'foreign-wall', surface: 'wall', material: 'oak' } })).toThrow('Finish host');
    expect(() => applyArchitectureInteriorEdit(architecture, interior, { kind: 'create_light', light: { id: 'bad-light', spaceId: 'sp', hostCeilingId: 'ce', positionMm: [20, 20, 2800], suspensionMm: 100, lumens: 3000, cctK: 4000 } })).toThrow('Invalid light placement');
    expect(() => applyArchitectureInteriorEdit(architecture, interior, { kind: 'create_millwork', millwork: { id: 'bad-case', spaceId: 'sp', positionMm: [1, 1, 0], sizeMm: [20, 20, 100], material: 'oak', clearanceMm: 10 } })).toThrow('Invalid millwork placement');
  });

  it('moves and rotates existing furniture through the same approved atomic edit path', () => {
    const value = workspace();
    const seed = executeArchitectureInteriorTool({ workspace: value, binding: { ...binding(value), documentId: 'int', objectId: 'chair-1' }, tool: 'create_furniture', approved: true, arguments: { revision: 1, documentId: 'int', objectId: 'chair-1', parameterPaths: ['spaceId', 'positionMm', 'sizeMm', 'clearanceMm'], patch: { spaceId: 'sp', positionMm: [65, 25, 1], sizeMm: [10, 10, 10], clearanceMm: 1 } } });
    if (!seed.ok || !seed.workspace) throw new Error('expected furniture seed');
    const move = executeArchitectureInteriorTool({ workspace: seed.workspace, binding: { projectId: 'p', revision: 2, contentHash: seed.workspace.contentHash, documentId: 'int', objectId: 'chair-1' }, tool: 'edit_furniture', approved: true, arguments: { revision: 2, documentId: 'int', objectId: 'chair-1', parameterPaths: ['positionMm', 'rotationDeg'], patch: { positionMm: [65, 25, 1], rotationDeg: 45 } } });
    expect(move).toMatchObject({ ok: true, workspace: { workspace: { revision: 3 } } });
    if (move.ok && move.workspace) expect(move.workspace.interior.document.furniture[0]).toMatchObject({ positionMm: [65, 25, 1], rotationDeg: 45 });
  });
  it('supports bounded finish and millwork edits while rejecting no-ops', () => {
    let value = workspace();
    const finishCreate = executeArchitectureInteriorTool({ workspace: value, binding: { ...binding(value), documentId: 'int', objectId: 'finish-1' }, tool: 'create_finish', approved: true, arguments: { revision: 1, documentId: 'int', objectId: 'finish-1', parameterPaths: ['spaceId', 'hostId', 'surfaceCode', 'materialCode'], patch: { spaceId: 'sp', hostId: 'sl', surfaceCode: 'floor', materialCode: 'oak' } } });
    if (!finishCreate.ok || !finishCreate.workspace) throw new Error('expected finish seed');
    value = finishCreate.workspace;
    const finishEdit = executeArchitectureInteriorTool({ workspace: value, binding: { projectId: 'p', revision: value.workspace.revision, contentHash: value.contentHash, documentId: 'int', objectId: 'finish-1' }, tool: 'edit_finish', approved: true, arguments: { revision: value.workspace.revision, documentId: 'int', objectId: 'finish-1', parameterPaths: ['materialCode'], patch: { materialCode: 'tile' } } });
    expect(finishEdit).toMatchObject({ ok: true, workspace: { workspace: { revision: 3 } } });
    if (!finishEdit.ok || !finishEdit.workspace) throw new Error('expected finish edit');
    value = finishEdit.workspace;
    expect(executeArchitectureInteriorTool({ workspace: value, binding: { projectId: 'p', revision: value.workspace.revision, contentHash: value.contentHash, documentId: 'int', objectId: 'finish-1' }, tool: 'edit_finish', approved: true, arguments: { revision: value.workspace.revision, documentId: 'int', objectId: 'finish-1', parameterPaths: ['materialCode'], patch: { materialCode: 'tile' } } })).toEqual({ ok: false, code: 'edit_failed' });

    const millworkCreate = executeArchitectureInteriorTool({ workspace: value, binding: { projectId: 'p', revision: value.workspace.revision, contentHash: value.contentHash, documentId: 'int', objectId: 'case-1' }, tool: 'create_millwork', approved: true, arguments: { revision: value.workspace.revision, documentId: 'int', objectId: 'case-1', parameterPaths: ['spaceId', 'positionMm', 'sizeMm', 'materialCode', 'clearanceMm'], patch: { spaceId: 'sp', positionMm: [50, 20, 0], sizeMm: [10, 10, 10], materialCode: 'oak', clearanceMm: 1 } } });
    expect(millworkCreate).toMatchObject({ ok: true, workspace: { workspace: { revision: value.workspace.revision + 1 } } });
    if (!millworkCreate.ok || !millworkCreate.workspace) throw new Error('expected millwork seed');
    expect(executeArchitectureInteriorTool({ workspace: millworkCreate.workspace, binding: { projectId: 'p', revision: millworkCreate.workspace.workspace.revision, contentHash: millworkCreate.workspace.contentHash, documentId: 'int', objectId: 'case-1' }, tool: 'edit_millwork', approved: true, arguments: { revision: millworkCreate.workspace.workspace.revision, documentId: 'int', objectId: 'case-1', parameterPaths: ['sizeMm'], patch: { sizeMm: [10, 10, 10] } } })).toEqual({ ok: false, code: 'edit_failed' });
  });
  it('executes create/edit stair through the committed transaction path with CAS and unrelated-object preservation', () => {
    const value = stairWorkspace();
    const create = executeArchitectureInteriorTool({ workspace: value, binding: { ...binding(value), objectId: 'stair-1' }, tool: 'create_stair', approved: true, arguments: { revision: 1, documentId: 'arch', objectId: 'stair-1', parameterPaths: ['fromStoreyId', 'toStoreyId', 'widthMm', 'riserCount', 'treadDepthMm', 'pathMm'], patch: { fromStoreyId: 'st', toStoreyId: 'st2', widthMm: 1200, riserCount: 18, treadDepthMm: 280, pathMm: [[0, 0, 0], [0, 100, 3000]] } } });
    expect(create).toMatchObject({ ok: true, workspace: { workspace: { revision: 2 }, artifactGraph: { revision: 2 } } });
    if (!create.ok || !create.workspace) return;
    expect(create.workspace.architecture.document.stairs).toHaveLength(1);
    expect(create.workspace.coordinates.some(item => item.objectId === 'stair-1')).toBe(true);
    expect(create.workspace.architecture.document.walls).toEqual(value.architecture.document.walls);
    expect(create.workspace.artifactGraph.artifacts.every(artifact => artifact.state === 'stale')).toBe(true);
    const edit = executeArchitectureInteriorTool({ workspace: create.workspace, binding: { projectId: 'p', revision: 2, contentHash: create.workspace.contentHash, objectId: 'stair-1' }, tool: 'edit_stair', approved: true, arguments: { revision: 2, documentId: 'arch', objectId: 'stair-1', parameterPaths: ['widthMm'], patch: { widthMm: 1400 } } });
    expect(edit).toMatchObject({ ok: true, workspace: { workspace: { revision: 3 } } });
    if (edit.ok && edit.workspace) expect(edit.workspace.architecture.document.stairs?.[0]).toMatchObject({ id: 'stair-1', widthMm: 1400 });
    const noop = executeArchitectureInteriorTool({ workspace: create.workspace, binding: { projectId: 'p', revision: 2, contentHash: create.workspace.contentHash, objectId: 'stair-1' }, tool: 'edit_stair', approved: true, arguments: { revision: 2, documentId: 'arch', objectId: 'stair-1', parameterPaths: ['widthMm'], patch: { widthMm: 1200 } } });
    expect(noop).toEqual({ ok: false, code: 'edit_failed' });
  });
  it('executes create/edit shaft with strict host-space binding and atomic no-op rollback', () => {
    const value = stairWorkspace();
    const create = executeArchitectureInteriorTool({ workspace: value, binding: { ...binding(value), objectId: 'shaft-1' }, tool: 'create_shaft', approved: true, arguments: { revision: 1, documentId: 'arch', objectId: 'shaft-1', parameterPaths: ['fromStoreyId', 'toStoreyId', 'boundaryMm', 'hostSpaceIds'], patch: { fromStoreyId: 'st', toStoreyId: 'st2', boundaryMm: [[10, 10], [40, 10], [40, 40], [10, 40]], hostSpaceIds: ['sp'] } } });
    expect(create).toMatchObject({ ok: true, workspace: { workspace: { revision: 2 } } });
    if (!create.ok || !create.workspace) return;
    expect(create.workspace.architecture.document.shafts).toEqual([{ id: 'shaft-1', fromStoreyId: 'st', toStoreyId: 'st2', boundaryMm: [[10, 10], [40, 10], [40, 40], [10, 40]], hostSpaceIds: ['sp'] }]);
    expect(create.workspace.coordinates.some(frame => frame.objectId === 'shaft-1' && frame.parentId === 'storey')).toBe(true);
    const edit = executeArchitectureInteriorTool({ workspace: create.workspace, binding: { projectId: 'p', revision: 2, contentHash: create.workspace.contentHash, objectId: 'shaft-1' }, tool: 'edit_shaft', approved: true, arguments: { revision: 2, documentId: 'arch', objectId: 'shaft-1', parameterPaths: ['boundaryMm'], patch: { boundaryMm: [[10, 10], [50, 10], [50, 40], [10, 40]] } } });
    expect(edit).toMatchObject({ ok: true, workspace: { workspace: { revision: 3 } } });
    expect(executeArchitectureInteriorTool({ workspace: create.workspace, binding: { projectId: 'p', revision: 2, contentHash: create.workspace.contentHash, objectId: 'shaft-1' }, tool: 'edit_shaft', approved: true, arguments: { revision: 2, documentId: 'arch', objectId: 'shaft-1', parameterPaths: ['hostSpaceIds'], patch: { hostSpaceIds: ['missing'] } } })).toEqual({ ok: false, code: 'edit_failed' });
  });
  it('executes concept elevator only through its approved shaft and ascending-storey binding', () => {
    const value = stairWorkspace();
    const shaft = executeArchitectureInteriorTool({ workspace: value, binding: { ...binding(value), objectId: 'shaft-e' }, tool: 'create_shaft', approved: true, arguments: { revision: 1, documentId: 'arch', objectId: 'shaft-e', parameterPaths: ['fromStoreyId', 'toStoreyId', 'boundaryMm', 'hostSpaceIds'], patch: { fromStoreyId: 'st', toStoreyId: 'st2', boundaryMm: [[10, 10], [40, 10], [40, 40], [10, 40]], hostSpaceIds: ['sp'] } } });
    if (!shaft.ok || !shaft.workspace) throw new Error('expected shaft seed');
    const elevator = executeArchitectureInteriorTool({ workspace: shaft.workspace, binding: { projectId: 'p', revision: 2, contentHash: shaft.workspace.contentHash, objectId: 'elevator-1' }, tool: 'create_elevator', approved: true, arguments: { revision: 2, documentId: 'arch', objectId: 'elevator-1', parameterPaths: ['shaftId', 'servedStoreyIds'], patch: { shaftId: 'shaft-e', servedStoreyIds: ['st', 'st2'] } } });
    expect(elevator).toMatchObject({ ok: true, workspace: { workspace: { revision: 3 } } });
    if (!elevator.ok || !elevator.workspace) return;
    const invalid = executeArchitectureInteriorTool({ workspace: elevator.workspace, binding: { projectId: 'p', revision: 3, contentHash: elevator.workspace.contentHash, objectId: 'elevator-1' }, tool: 'edit_elevator', approved: true, arguments: { revision: 3, documentId: 'arch', objectId: 'elevator-1', parameterPaths: ['servedStoreyIds'], patch: { servedStoreyIds: ['st2', 'st'] } } });
    expect(invalid).toEqual({ ok: false, code: 'edit_failed' });
  });
  it('executes service opening create/edit with semantic route references and strict host/axis validation', () => {
    const value = workspace();
    const create = executeArchitectureInteriorTool({ workspace: value, binding: { ...binding(value), objectId: 'svc-1' }, tool: 'create_service_opening', approved: true, arguments: { revision: 1, documentId: 'arch', objectId: 'svc-1', parameterPaths: ['hostId', 'sourceRouteId', 'sourceSleeveId', 'shape', 'centerMm', 'axis', 'cutDiameterMm', 'depthMm', 'firestopAnnulusMm', 'structuralApprovalId'], patch: { hostId: 'w1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', shape: 'round', centerMm: [20, 0, 1500], axis: [1, 0, 0], cutDiameterMm: 100, depthMm: 200, firestopAnnulusMm: 25, structuralApprovalId: 'approval-ref-1' } } });
    expect(create).toMatchObject({ ok: true, workspace: { workspace: { revision: 2 } } });
    if (!create.ok || !create.workspace) return;
    const edit = executeArchitectureInteriorTool({ workspace: create.workspace, binding: { projectId: 'p', revision: 2, contentHash: create.workspace.contentHash, objectId: 'svc-1' }, tool: 'edit_service_opening', approved: true, arguments: { revision: 2, documentId: 'arch', objectId: 'svc-1', parameterPaths: ['hostId', 'cutDiameterMm'], patch: { hostId: 'sl', cutDiameterMm: 120 } } });
    expect(edit).toMatchObject({ ok: true, workspace: { workspace: { revision: 3 } } });
    expect(executeArchitectureInteriorTool({ workspace: create.workspace, binding: { projectId: 'p', revision: 2, contentHash: create.workspace.contentHash, objectId: 'svc-1' }, tool: 'edit_service_opening', approved: true, arguments: { revision: 2, documentId: 'arch', objectId: 'svc-1', parameterPaths: ['axis'], patch: { axis: [2, 0, 0] } } })).toEqual({ ok: false, code: 'edit_failed' });
  });
  it('executes stable-ID grid edits with strict parameter binding and atomic rollback', () => {
    const value = workspace();
    const create = executeArchitectureInteriorTool({ workspace: value, binding: { ...binding(value), objectId: 'grid-a' }, tool: 'create_grid', approved: true, arguments: { revision: 1, documentId: 'arch', objectId: 'grid-a', parameterPaths: ['name', 'axis', 'startMm', 'endMm'], patch: { name: 'A', axis: 'x', startMm: [0, 0], endMm: [100, 0] } } });
    expect(create).toMatchObject({ ok: true, workspace: { workspace: { revision: 2 }, artifactGraph: { revision: 2 } } });
    if (!create.ok || !create.workspace) return;
    const edit = executeArchitectureInteriorTool({ workspace: create.workspace, binding: { projectId: 'p', revision: 2, contentHash: create.workspace.contentHash, objectId: 'grid-a' }, tool: 'edit_grid', approved: true, arguments: { revision: 2, documentId: 'arch', objectId: 'grid-a', parameterPaths: ['name', 'endMm'], patch: { name: 'A1', endMm: [120, 0] } } });
    expect(edit).toMatchObject({ ok: true, workspace: { workspace: { revision: 3 }, artifactGraph: { revision: 3 } } });
    if (edit.ok && edit.workspace) {
      expect(edit.workspace.architecture.document.grids).toEqual([{ id: 'grid-a', name: 'A1', axis: 'x', startMm: [0, 0], endMm: [120, 0] }]);
      expect(edit.workspace.architecture.document.storeys).toEqual(create.workspace.architecture.document.storeys);
      expect(edit.workspace.artifactGraph.artifacts.every(artifact => artifact.state === 'stale')).toBe(true);
    }
    const createBinding = { projectId: 'p', revision: 2, contentHash: create.workspace.contentHash, objectId: 'grid-a' };
    expect(executeArchitectureInteriorTool({ workspace: create.workspace, binding: createBinding, tool: 'edit_grid', approved: true, arguments: { revision: 2, documentId: 'arch', objectId: 'grid-a', parameterPaths: ['endMm'], patch: { endMm: [100, 0] } } })).toEqual({ ok: false, code: 'edit_failed' });
    expect(executeArchitectureInteriorTool({ workspace: create.workspace, binding: createBinding, tool: 'edit_grid', approved: true, arguments: { revision: 2, documentId: 'arch', objectId: 'grid-a', parameterPaths: ['name'], patch: { name: 'A1', endMm: [120, 0] } } })).toEqual({ ok: false, code: 'invalid_arguments' });
    expect(executeArchitectureInteriorTool({ workspace: create.workspace, binding: { ...createBinding, objectId: 'missing' }, tool: 'edit_grid', approved: true, arguments: { revision: 2, documentId: 'arch', objectId: 'missing', parameterPaths: ['name'], patch: { name: 'B' } } })).toEqual({ ok: false, code: 'object_binding_mismatch' });
  });
});
