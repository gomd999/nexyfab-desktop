import { describe, expect, it } from 'vitest';
import { executeArchitectureInteriorConceptTransaction } from './architectureInteriorConceptTransaction';
import { hashArchitectureInteriorEvidenceV2, hashArchitectureInteriorWorkspaceV2, type ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import { validateArchitectureDocument, type ArchitectureDocument, type InteriorDocument } from './architectureInteriorDocuments';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from './designArtifactGraph';

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
function fixture(): ArchitectureInteriorWorkspaceV2 {
  const evidence = { revision: 1 };
  const draft = { schema: 'nexyfab.architecture-interior-workspace.v2', projectId: 'p', workspace: { projectId: 'p', revision: 1, contentHash: '', track: 'ai_design' as const, maturity: 'concept' as const }, contentHash: '', units: { sourceUnit: 'mm' as const, geometryUnit: 'mm' as const, analysisUnit: 'SI' as const }, coordinates: [frame('project', 'project'), frame('site', 'site', 'project'), frame('building', 'building', 'site'), frame('storey', 'storey', 'building'), ...['st', 'w1', 'w2', 'w3', 'sl', 'ce', 'sp'].map(id => frame(`obj-${id}`, 'object', 'storey', id))], architecture: { documentId: 'arch', document: structuredClone(architecture), geometry: { representation: 'bim' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'seed', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'seed', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'seed-a', kind: 'user' as const, contentHash: 'a'.repeat(64) }] }, interior: { documentId: 'int', document: structuredClone(interior), geometry: { representation: 'procedural' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'seed', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'seed', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'seed-i', kind: 'user' as const, contentHash: 'b'.repeat(64) }] }, artifactGraph: { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'p', revision: 1, artifacts: [{ id: 'model', kind: 'model', revision: 1, contentHash: 'c'.repeat(64), state: 'current' as const, inputs: [], verification: { status: 'passed' as const, verifierId: 'seed', evidenceHash: 'd'.repeat(64), issues: [] }, staleBecause: [] }], dependencies: [] } } as ArchitectureInteriorWorkspaceV2;
  const contentHash = hashArchitectureInteriorWorkspaceV2(draft);
  return { ...draft, contentHash, workspace: { ...draft.workspace, contentHash } };
}
function stairFixture(withStair = false): ArchitectureInteriorWorkspaceV2 {
  const value = fixture();
  value.architecture.document.storeys.push({ id: 'st2', name: 'Upper', elevationMm: 3000, heightMm: 3000 });
  value.coordinates.push({ id: 'storey-st2', kind: 'storey', parentId: 'building', storeyId: 'st2', originMm: [0, 0, 3000], rotationDeg: [0, 0, 0] }, frame('obj-st2', 'object', 'storey-st2', 'st2'));
  if (withStair) {
    value.architecture.document.stairs = [{ id: 'stair-1', fromStoreyId: 'st', toStoreyId: 'st2', widthMm: 1200, riserCount: 18, treadDepthMm: 280, pathMm: [[0, 0, 0], [0, 100, 3000]] }];
    value.coordinates.push(frame('obj-stair-1', 'object', 'storey', 'stair-1'));
  }
  const contentHash = hashArchitectureInteriorWorkspaceV2(value);
  return { ...value, contentHash, workspace: { ...value.workspace, contentHash } };
}

describe('architecture/interior concept transaction', () => {
  it('commits a supported edit atomically and regenerates evidence/provenance while invalidating artifacts', () => {
    const before = fixture();
    const result = executeArchitectureInteriorConceptTransaction({ workspace: before, actorSource: 'ai', edit: { kind: 'move_line_wall', wallId: 'w1', startMm: [0, 0], endMm: [120, 0] } });
    expect(result).toMatchObject({ committed: true, workspace: { workspace: { revision: 2 }, artifactGraph: { revision: 2 } } });
    if (!result.committed) return;
    expect(result.workspace.architecture.geometry.verification.status).toBe('not_run');
    expect(result.workspace.architecture.semantic.payload).toMatchObject({ document: { revision: 2 } });
    expect(result.workspace.architecture.provenance.some(item => item.sourceId.startsWith('command:'))).toBe(true);
    expect(result.workspace.artifactGraph.artifacts[0]?.state).toBe('stale');
    expect(result.workspace.artifactGraph.artifacts[0]?.verification.evidenceHash).toBeUndefined();
    const wall = result.workspace.architecture.document.walls[0];
    expect(wall?.kind === 'line' ? wall.endMm : undefined).toEqual([120, 0]);
  });
  it('rejects precision/exact/release and preserves the original workspace', () => {
    for (const change of [{ track: 'precision_cad' as const }, { maturity: 'exact' as const }, { maturity: 'release' as const }]) {
      const before = fixture();
      before.workspace = { ...before.workspace, ...change };
      const result = executeArchitectureInteriorConceptTransaction({ workspace: before, edit: { kind: 'set_ceiling_elevation', ceilingId: 'ce', elevationMm: 2700 } });
      expect(result.committed).toBe(false);
      expect(result.workspace).toBe(before);
    }
  });
  it('fails closed for unsupported edits and invalid geometry without mutating input', () => {
    const before = fixture();
    const unsupported = executeArchitectureInteriorConceptTransaction({ workspace: before, edit: { kind: 'set_space_boundary', spaceId: 'missing', boundaryMm: [[0, 0], [1, 0], [1, 1]] } });
    expect(unsupported).toEqual({ committed: false, workspace: before, code: 'edit_failed' });
    expect(before.workspace.revision).toBe(1);
  });
  it('does not invalidate through a locked artifact dependency', () => {
    const before = fixture();
    before.artifactGraph.artifacts.push({ id: 'drawing', kind: 'drawing', revision: 1, contentHash: 'e'.repeat(64), state: 'current', inputs: [{ artifactId: 'model', revision: 1, contentHash: 'c'.repeat(64) }], verification: { status: 'passed', verifierId: 'seed', evidenceHash: 'f'.repeat(64), issues: [] }, staleBecause: [] });
    before.artifactGraph.dependencies.push({ id: 'model-drawing-lock', sourceId: 'model', targetId: 'drawing', policy: 'locked' });
    const contentHash = hashArchitectureInteriorWorkspaceV2(before);
    before.contentHash = contentHash;
    before.workspace.contentHash = contentHash;
    expect(executeArchitectureInteriorConceptTransaction({ workspace: before, edit: { kind: 'set_ceiling_elevation', ceilingId: 'ce', elevationMm: 2700 } })).toEqual({ committed: false, workspace: before, code: 'locked_artifact_requires_approval' });
  });

  it('applies slab, bound opening, and ceiling edits without changing object identity', () => {
    const slabBefore = fixture();
    const slabResult = executeArchitectureInteriorConceptTransaction({ workspace: slabBefore, edit: { kind: 'edit_slab', slabId: 'sl', thicknessMm: 20 } });
    expect(slabResult).toMatchObject({ committed: true, workspace: { architecture: { document: { slabs: [{ thicknessMm: 20 }] } } } });

    const openingBefore = fixture();
    openingBefore.architecture.document.openings = [{ id: 'door', kind: 'door', hostWallId: 'w1', offsetMm: 20, widthMm: 10, heightMm: 20, sillMm: 0, positionMm: [20, 0, 0] }];
    openingBefore.coordinates.push(frame('obj-door', 'object', 'storey', 'door'));
    const openingHash = hashArchitectureInteriorWorkspaceV2(openingBefore); openingBefore.contentHash = openingHash; openingBefore.workspace.contentHash = openingHash;
    const openingResult = executeArchitectureInteriorConceptTransaction({ workspace: openingBefore, edit: { kind: 'edit_opening', openingId: 'door', widthMm: 20 } });
    expect(openingResult).toMatchObject({ committed: true });
    if (openingResult.committed) expect(openingResult.workspace.architecture.document.openings[0]).toMatchObject({ widthMm: 20, positionMm: [20, 0, 0] });

    const ceilingBefore = fixture();
    const ceilingResult = executeArchitectureInteriorConceptTransaction({ workspace: ceilingBefore, edit: { kind: 'edit_ceiling', ceilingId: 'ce', elevationMm: 2750, thicknessMm: 15 } });
    expect(ceilingResult).toMatchObject({ committed: true, workspace: { architecture: { document: { ceilings: [{ elevationMm: 2750, thicknessMm: 15 }] } } } });
  });
  it('commits create/edit stair through the atomic path with stable coordinates and stale artifacts', () => {
    const before = stairFixture();
    const result = executeArchitectureInteriorConceptTransaction({ workspace: before, actorSource: 'ai', edit: { kind: 'create_stair', stair: { id: 'stair-1', fromStoreyId: 'st', toStoreyId: 'st2', widthMm: 1200, riserCount: 18, treadDepthMm: 280, pathMm: [[0, 0, 0], [0, 100, 3000]] } } });
    expect(result).toMatchObject({ committed: true, workspace: { workspace: { revision: 2 }, artifactGraph: { revision: 2 } } });
    if (!result.committed) return;
    expect(result.workspace.architecture.document.stairs).toEqual([{ id: 'stair-1', fromStoreyId: 'st', toStoreyId: 'st2', widthMm: 1200, riserCount: 18, treadDepthMm: 280, pathMm: [[0, 0, 0], [0, 100, 3000]] }]);
    expect(result.workspace.coordinates.some(item => item.objectId === 'stair-1' && item.documentId === 'arch')).toBe(true);
    expect(result.workspace.architecture.document.walls).toEqual(before.architecture.document.walls);
    expect(result.workspace.artifactGraph.artifacts[0]?.state).toBe('stale');

    const edited = executeArchitectureInteriorConceptTransaction({ workspace: result.workspace, edit: { kind: 'edit_stair', stairId: 'stair-1', widthMm: 1400 } });
    expect(edited).toMatchObject({ committed: true, workspace: { workspace: { revision: 3 } } });
    if (edited.committed) {
      expect(edited.workspace.architecture.document.stairs?.[0]).toMatchObject({ id: 'stair-1', widthMm: 1400 });
      expect(edited.workspace.coordinates.find(item => item.objectId === 'stair-1')?.parentId).toBe('storey');
    }
    const rebound = executeArchitectureInteriorConceptTransaction({ workspace: edited.committed ? edited.workspace : result.workspace, edit: { kind: 'edit_stair', stairId: 'stair-1', fromStoreyId: 'st2', toStoreyId: 'st', pathMm: [[0, 0, 3000], [0, 100, 0]] } });
    expect(rebound).toMatchObject({ committed: true });
    if (rebound.committed) expect(rebound.workspace.coordinates.find(item => item.objectId === 'stair-1')?.parentId).toBe('storey-st2');
  });
  it('commits a concept-only shaft with storey, host-space, and coordinate-frame bindings', () => {
    const before = stairFixture();
    const shaft = { id: 'shaft-1', fromStoreyId: 'st', toStoreyId: 'st2', boundaryMm: [[10, 10], [40, 10], [40, 40], [10, 40]] as [number, number][], hostSpaceIds: ['sp'] };
    const result = executeArchitectureInteriorConceptTransaction({ workspace: before, actorSource: 'ai', edit: { kind: 'create_shaft', shaft } });
    expect(result).toMatchObject({ committed: true, workspace: { workspace: { revision: 2 }, artifactGraph: { revision: 2 } } });
    if (!result.committed) return;
    expect(result.workspace.architecture.document.shafts).toEqual([shaft]);
    expect(result.workspace.coordinates.find(item => item.objectId === 'shaft-1')).toMatchObject({ kind: 'object', parentId: 'storey', documentId: 'arch' });
    expect(result.workspace.artifactGraph.artifacts[0]?.state).toBe('stale');
    const edited = executeArchitectureInteriorConceptTransaction({ workspace: result.workspace, edit: { kind: 'edit_shaft', shaftId: 'shaft-1', boundaryMm: [[10, 10], [50, 10], [50, 40], [10, 40]] } });
    expect(edited).toMatchObject({ committed: true, workspace: { workspace: { revision: 3 } } });
    if (!edited.committed) return;
    expect(edited.workspace.architecture.document.shafts?.[0]?.boundaryMm[1]).toEqual([50, 10]);
    expect(executeArchitectureInteriorConceptTransaction({ workspace: edited.workspace, edit: { kind: 'edit_shaft', shaftId: 'shaft-1', boundaryMm: [[10, 10], [50, 10], [50, 40], [10, 40]] } })).toEqual({ committed: false, workspace: edited.workspace, code: 'edit_failed' });
    expect(executeArchitectureInteriorConceptTransaction({ workspace: edited.workspace, edit: { kind: 'edit_shaft', shaftId: 'shaft-1', fromStoreyId: 'st2', toStoreyId: 'st' } })).toEqual({ committed: false, workspace: edited.workspace, code: 'edit_failed' });
    expect(executeArchitectureInteriorConceptTransaction({ workspace: edited.workspace, edit: { kind: 'edit_shaft', shaftId: 'shaft-1', boundaryMm: [[0, 0], [40, 40], [0, 40], [40, 0], [20, 50]] } })).toEqual({ committed: false, workspace: edited.workspace, code: 'edit_failed' });
  });
  it('commits a concept-only elevator with strict ascending served storeys and shaft host binding', () => {
    const before = stairFixture();
    const shaft = { id: 'shaft-e', fromStoreyId: 'st', toStoreyId: 'st2', boundaryMm: [[10, 10], [40, 10], [40, 40], [10, 40]] as [number, number][], hostSpaceIds: ['sp'] };
    const seeded = executeArchitectureInteriorConceptTransaction({ workspace: before, edit: { kind: 'create_shaft', shaft } });
    expect(seeded.committed).toBe(true);
    if (!seeded.committed) return;
    const result = executeArchitectureInteriorConceptTransaction({ workspace: seeded.workspace, actorSource: 'ai', edit: { kind: 'create_elevator', elevator: { id: 'elevator-1', shaftId: 'shaft-e', servedStoreyIds: ['st', 'st2'] } } });
    expect(result).toMatchObject({ committed: true, workspace: { workspace: { revision: 3 }, artifactGraph: { revision: 3 } } });
    if (!result.committed) return;
    expect(result.workspace.architecture.document.elevators).toEqual([{ id: 'elevator-1', shaftId: 'shaft-e', servedStoreyIds: ['st', 'st2'] }]);
    expect(result.workspace.coordinates.find(item => item.objectId === 'elevator-1')).toMatchObject({ kind: 'object', parentId: 'storey', documentId: 'arch' });
    const edited = executeArchitectureInteriorConceptTransaction({ workspace: result.workspace, edit: { kind: 'edit_elevator', elevatorId: 'elevator-1', servedStoreyIds: ['st2', 'st'] } });
    expect(edited).toEqual({ committed: false, workspace: result.workspace, code: 'edit_failed' });
    expect(executeArchitectureInteriorConceptTransaction({ workspace: result.workspace, edit: { kind: 'edit_elevator', elevatorId: 'elevator-1', servedStoreyIds: ['st', 'st2'] } })).toEqual({ committed: false, workspace: result.workspace, code: 'edit_failed' });
  });
  it('commits a service opening with wall/slab host bindings and rejects invalid round-axis edits atomically', () => {
    const before = fixture();
    const opening = { id: 'svc-1', hostId: 'w1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', shape: 'round' as const, centerMm: [20, 0, 1500] as [number, number, number], axis: [1, 0, 0] as [number, number, number], cutDiameterMm: 100, depthMm: 200, firestopAnnulusMm: 25, structuralApprovalId: 'approval-ref-1' };
    const result = executeArchitectureInteriorConceptTransaction({ workspace: before, actorSource: 'ai', edit: { kind: 'create_service_opening', serviceOpening: opening } });
    expect(result).toMatchObject({ committed: true, workspace: { workspace: { revision: 2 }, artifactGraph: { revision: 2 } } });
    if (!result.committed) return;
    expect(result.workspace.artifactGraph.artifacts[0]).toMatchObject({ state: 'stale', verification: { status: 'not_run' } });
    expect(result.workspace.architecture.document.serviceOpenings).toEqual([opening]);
    expect(result.workspace.coordinates.find(item => item.objectId === 'svc-1')).toMatchObject({ kind: 'object', parentId: 'storey', documentId: 'arch' });
    const edited = executeArchitectureInteriorConceptTransaction({ workspace: result.workspace, edit: { kind: 'edit_service_opening', serviceOpeningId: 'svc-1', hostId: 'sl', cutDiameterMm: 120 } });
    expect(edited).toMatchObject({ committed: true, workspace: { workspace: { revision: 3 } } });
    if (!edited.committed) return;
    expect(edited.workspace.architecture.document.serviceOpenings?.[0]).toMatchObject({ hostId: 'sl', cutDiameterMm: 120 });
    const malformed = structuredClone(edited.workspace.architecture.document);
    malformed.serviceOpenings![0]!.shape = 'square' as never;
    malformed.serviceOpenings![0]!.firestopAnnulusMm = Number.NaN;
    malformed.serviceOpenings![0]!.structuralApprovalId = '   ';
    expect(validateArchitectureDocument(malformed)).toContain('svc-1: invalid service opening.');
    expect(executeArchitectureInteriorConceptTransaction({ workspace: edited.workspace, edit: { kind: 'edit_service_opening', serviceOpeningId: 'svc-1', axis: [2, 0, 0] } })).toEqual({ committed: false, workspace: edited.workspace, code: 'edit_failed' });
    expect(executeArchitectureInteriorConceptTransaction({ workspace: edited.workspace, edit: { kind: 'edit_service_opening', serviceOpeningId: 'svc-1', cutDiameterMm: 120 } })).toEqual({ committed: false, workspace: edited.workspace, code: 'edit_failed' });
  });
  it('rejects stair no-op, missing storeys, and unbound endpoint elevations without mutating the CAS head', () => {
    const before = stairFixture(true);
    const originalHash = before.contentHash;
    expect(executeArchitectureInteriorConceptTransaction({ workspace: before, edit: { kind: 'edit_stair', stairId: 'stair-1', widthMm: 1200 } })).toEqual({ committed: false, workspace: before, code: 'edit_failed' });
    expect(executeArchitectureInteriorConceptTransaction({ workspace: before, edit: { kind: 'edit_stair', stairId: 'stair-1', toStoreyId: 'missing' } })).toEqual({ committed: false, workspace: before, code: 'edit_failed' });
    expect(executeArchitectureInteriorConceptTransaction({ workspace: before, edit: { kind: 'create_stair', stair: { id: 'bad-stair', fromStoreyId: 'st', toStoreyId: 'st2', widthMm: 1200, riserCount: 18, treadDepthMm: 280, pathMm: [[0, 0, 1], [0, 100, 3000]] } } })).toEqual({ committed: false, workspace: before, code: 'edit_failed' });
    expect(before.contentHash).toBe(originalHash);
    const missingFrame = stairFixture();
    missingFrame.coordinates = missingFrame.coordinates.filter(item => item.id !== 'storey-st2' && item.id !== 'obj-st2');
    const missingFrameHash = hashArchitectureInteriorWorkspaceV2(missingFrame);
    missingFrame.contentHash = missingFrameHash;
    missingFrame.workspace.contentHash = missingFrameHash;
    expect(executeArchitectureInteriorConceptTransaction({ workspace: missingFrame, edit: { kind: 'create_stair', stair: { id: 'stair-2', fromStoreyId: 'st', toStoreyId: 'st2', widthMm: 1200, riserCount: 18, treadDepthMm: 280, pathMm: [[0, 0, 0], [0, 100, 3000]] } } })).toEqual({ committed: false, workspace: missingFrame, code: 'invalid_workspace' });
  });
  it('edits one stable grid through the atomic concept transaction and rejects no-op or invalid geometry', () => {
    const before = fixture();
    before.architecture.document.grids = [{ id: 'grid-a', name: 'A', axis: 'x', startMm: [0, 0], endMm: [0, 100] }];
    before.coordinates.push(frame('obj-grid-a', 'object', 'building', 'grid-a'));
    const contentHash = hashArchitectureInteriorWorkspaceV2(before);
    before.contentHash = contentHash; before.workspace.contentHash = contentHash;
    const edited = executeArchitectureInteriorConceptTransaction({ workspace: before, actorSource: 'ai', edit: { kind: 'edit_grid', gridId: 'grid-a', name: 'A1', endMm: [0, 120] } });
    expect(edited).toMatchObject({ committed: true, workspace: { workspace: { revision: 2 }, artifactGraph: { revision: 2 } } });
    if (!edited.committed) return;
    expect(edited.workspace.architecture.document.grids).toEqual([{ id: 'grid-a', name: 'A1', axis: 'x', startMm: [0, 0], endMm: [0, 120] }]);
    expect(edited.workspace.coordinates.find(item => item.objectId === 'grid-a')?.parentId).toBe('building');
    expect(edited.workspace.artifactGraph.artifacts.every(artifact => artifact.state === 'stale')).toBe(true);
    expect(executeArchitectureInteriorConceptTransaction({ workspace: before, edit: { kind: 'edit_grid', gridId: 'grid-a', endMm: [0, 0] } })).toEqual({ committed: false, workspace: before, code: 'edit_failed' });
    expect(executeArchitectureInteriorConceptTransaction({ workspace: before, edit: { kind: 'edit_grid', gridId: 'grid-a', endMm: [0, 100] } })).toEqual({ committed: false, workspace: before, code: 'edit_failed' });
  });

  it('rebases a storey coordinate frame and keeps the edit atomic', () => {
    const before = fixture();
    const result = executeArchitectureInteriorConceptTransaction({ workspace: before, edit: { kind: 'edit_storey', storeyId: 'st', name: 'Ground 1', elevationMm: 500 } });
    expect(result).toMatchObject({ committed: true, workspace: { workspace: { revision: 2 } } });
    if (!result.committed) return;
    expect(result.workspace.architecture.document.storeys[0]).toMatchObject({ id: 'st', name: 'Ground 1', elevationMm: 500 });
    expect(result.workspace.coordinates.find(item => item.kind === 'storey' && item.storeyId === 'st')?.originMm).toEqual([0, 0, 500]);
    expect(result.workspace.coordinates.find(item => item.objectId === 'sp')?.parentId).toBe('storey');
    expect(executeArchitectureInteriorConceptTransaction({ workspace: result.workspace, edit: { kind: 'edit_storey', storeyId: 'st', name: 'Ground 1' } })).toEqual({ committed: false, workspace: result.workspace, code: 'edit_failed' });
  });

  it('reparents every space dependency frame on a checked storey reassignment', () => {
    const before = fixture();
    before.architecture.document.storeys.push({ id: 'st2', name: 'Upper', elevationMm: 4000, heightMm: 3000 });
    before.coordinates.push({ id: 'storey-st2', kind: 'storey', parentId: 'building', storeyId: 'st2', originMm: [0, 0, 4000], rotationDeg: [0, 0, 0] }, { id: 'obj-st2', kind: 'object', parentId: 'storey-st2', objectId: 'st2', documentId: 'arch', originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
    const hash = hashArchitectureInteriorWorkspaceV2(before); before.contentHash = hash; before.workspace.contentHash = hash;
    const result = executeArchitectureInteriorConceptTransaction({ workspace: before, edit: { kind: 'edit_space', spaceId: 'sp', storeyId: 'st2' } });
    expect(result).toMatchObject({ committed: true, workspace: { workspace: { revision: 2 } } });
    if (!result.committed) return;
    expect(result.workspace.architecture.document.spaces[0]?.storeyId).toBe('st2');
    for (const id of ['sp', 'w1', 'w2', 'w3', 'sl', 'ce']) expect(result.workspace.coordinates.find(item => item.objectId === id)?.parentId).toBe('storey-st2');
    expect(result.workspace.coordinates.find(item => item.objectId === 'st')?.parentId).toBe('storey');
  });
});
