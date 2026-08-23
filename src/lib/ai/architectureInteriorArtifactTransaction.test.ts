import { describe, expect, it } from 'vitest';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from './designArtifactGraph';
import { executeArchitectureInteriorArtifactTransaction, validateArchitectureInteriorArtifactBundle } from './architectureInteriorArtifactTransaction';
import { executeArchitectureInteriorConceptTransaction } from './architectureInteriorConceptTransaction';
import { hashArchitectureInteriorEvidenceV2, hashArchitectureInteriorWorkspaceV2, validateArchitectureInteriorWorkspaceV2, type ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import type { ArchitectureDocument, InteriorDocument } from './architectureInteriorDocuments';

const architecture: ArchitectureDocument = {
  schema: 'nexyfab.architecture.v1', revision: 1,
  storeys: [{ id: 'storey-1', name: 'Ground', elevationMm: 0, heightMm: 3000 }],
  spaces: [{ id: 'space-1', storeyId: 'storey-1', name: 'Room', usage: 'office', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], wallIds: ['wall-1', 'wall-2', 'wall-3', 'wall-4'], slabId: 'slab-1', ceilingId: 'ceiling-1' }],
  walls: [
    { id: 'wall-1', kind: 'line', storeyId: 'storey-1', startMm: [0, 0], endMm: [4000, 0], thicknessMm: 200, heightMm: 3000 },
    { id: 'wall-2', kind: 'line', storeyId: 'storey-1', startMm: [4000, 0], endMm: [4000, 3000], thicknessMm: 200, heightMm: 3000 },
    { id: 'wall-3', kind: 'line', storeyId: 'storey-1', startMm: [4000, 3000], endMm: [0, 3000], thicknessMm: 200, heightMm: 3000 },
    { id: 'wall-4', kind: 'line', storeyId: 'storey-1', startMm: [0, 3000], endMm: [0, 0], thicknessMm: 200, heightMm: 3000 },
  ],
  slabs: [{ id: 'slab-1', storeyId: 'storey-1', spaceId: 'space-1', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], thicknessMm: 200 }],
  ceilings: [{ id: 'ceiling-1', storeyId: 'storey-1', spaceId: 'space-1', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], elevationMm: 3000, thicknessMm: 100 }],
  openings: [{ id: 'door-1', kind: 'door', hostWallId: 'wall-1', offsetMm: 1000, widthMm: 1000, heightMm: 2000, sillMm: 0, positionMm: [1000, 0, 0] }],
};
const interior: InteriorDocument = { schema: 'nexyfab.interior.v1', revision: 1, architectureDocumentId: 'architecture-1', furniture: [{ id: 'desk-1', spaceId: 'space-1', positionMm: [2000, 1500, 0], sizeMm: [1600, 800, 750], clearanceMm: 100 }], lights: [{ id: 'light-1', spaceId: 'space-1', hostCeilingId: 'ceiling-1', positionMm: [2000, 1500, 2800], suspensionMm: 200, lumens: 3000, cctK: 4000 }], finishes: [{ id: 'paint-1', spaceId: 'space-1', hostId: 'wall-1', surface: 'wall', material: 'paint.white' }] };
const frame = (id: string, kind: 'project' | 'site' | 'building' | 'storey' | 'object', parentId?: string, objectId?: string, documentId?: string) => ({ id, kind, ...(parentId ? { parentId } : {}), ...(objectId ? { objectId, documentId } : {}), ...(kind === 'storey' ? { storeyId: 'storey-1' } : {}), originMm: [0, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] });

function workspace(): ArchitectureInteriorWorkspaceV2 {
  const evidence = { revision: 1 };
  const modelVerification = { status: 'passed' as const, verifierId: 'model-test', evidenceHash: 'e'.repeat(64), issues: [] as string[] };
  const draft = { schema: 'nexyfab.architecture-interior-workspace.v2', projectId: 'project-1', workspace: { projectId: 'project-1', revision: 1, contentHash: '', track: 'ai_design' as const, maturity: 'concept' as const }, contentHash: '', units: { sourceUnit: 'mm' as const, geometryUnit: 'mm' as const, analysisUnit: 'SI' as const }, coordinates: [frame('project', 'project'), frame('site', 'site', 'project'), frame('building', 'building', 'site'), frame('storey', 'storey', 'building'), ...['storey-1', 'space-1', 'wall-1', 'wall-2', 'wall-3', 'wall-4', 'slab-1', 'ceiling-1', 'door-1'].map(id => frame(`object-${id}`, 'object', 'storey', id, 'architecture-1')), ...['desk-1', 'light-1', 'paint-1'].map(id => frame(`object-${id}`, 'object', 'storey', id, 'interior-1'))], architecture: { documentId: 'architecture-1', document: structuredClone(architecture), geometry: { representation: 'bim' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'concept', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'architecture', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'source-a', kind: 'user' as const, contentHash: 'a'.repeat(64) }] }, interior: { documentId: 'interior-1', document: structuredClone(interior), geometry: { representation: 'procedural' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'concept', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'interior', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'source-i', kind: 'user' as const, contentHash: 'b'.repeat(64) }] }, artifactGraph: { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'project-1', revision: 1, artifacts: [{ id: 'model:architecture:1', kind: 'model' as const, revision: 1, contentHash: 'c'.repeat(64), state: 'current' as const, inputs: [], verification: modelVerification, staleBecause: [] }, { id: 'model:interior:1', kind: 'model' as const, revision: 1, contentHash: 'd'.repeat(64), state: 'current' as const, inputs: [], verification: modelVerification, staleBecause: [] }], dependencies: [] } } as ArchitectureInteriorWorkspaceV2;
  const contentHash = hashArchitectureInteriorWorkspaceV2(draft); draft.contentHash = contentHash; draft.workspace.contentHash = contentHash; return draft;
}

const all = ['quantity', 'drawing', 'ifc'] as const;
const execute = (value: ArchitectureInteriorWorkspaceV2, requestedKinds: readonly ('quantity' | 'drawing' | 'ifc')[] = all) => executeArchitectureInteriorArtifactTransaction({ workspace: value, expectedWorkspaceRevision: value.workspace.revision, requestedKinds });

describe('architecture/interior derived-artifact transaction', () => {
  it('generates the requested artifacts atomically without changing the design revision', () => {
    const before = workspace();
    const result = execute(before);
    expect(result.committed).toBe(true);
    if (!result.committed) return;
    expect(result.bundle.source).toMatchObject({ projectId: before.projectId, revision: before.workspace.revision, contentHash: before.contentHash });
    expect(result.bundle.artifacts.map(item => item.kind)).toEqual(all);
    expect(result.bundle.artifactGraph.artifacts.filter(item => item.kind !== 'model').map(item => item.kind)).toEqual(all);
    expect(validateArchitectureInteriorWorkspaceV2(before)).toEqual([]);
    expect(before).toEqual(workspace());
  });

  it('is deterministic and rejects a stale expected revision', () => {
    const first = execute(workspace());
    const second = execute(workspace());
    expect(first).toEqual(second);
    const value = workspace();
    const stale = executeArchitectureInteriorArtifactTransaction({ workspace: value, expectedWorkspaceRevision: 0, requestedKinds: ['quantity'] });
    expect(stale).toMatchObject({ committed: false, code: 'stale_workspace_revision', workspace: value });
  });

  it('rolls back the original workspace when IFC cannot be reconciled', () => {
    const before = workspace();
    before.architecture.document.serviceOpenings = [{ id: 'service-1', hostId: 'wall-1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', shape: 'round', centerMm: [100, 0, 0], axis: [0, 0, 1], cutDiameterMm: 100, depthMm: 100, firestopAnnulusMm: 10 }];
    before.coordinates.push(frame('object-service-1', 'object', 'storey', 'service-1', 'architecture-1'));
    const hash = hashArchitectureInteriorWorkspaceV2(before); before.contentHash = hash; before.workspace.contentHash = hash;
    const result = execute(before);
    expect(result).toMatchObject({ committed: false, code: 'artifact_build_failed', workspace: before });
    expect(before.artifactGraph.artifacts).toHaveLength(2);
  });

  it('rejects locked replacement and preserves the existing graph', () => {
    const before = workspace();
    const quantityId = 'quantity:architecture-interior:1';
    before.artifactGraph.artifacts.push({ id: quantityId, kind: 'quantity', revision: 0, contentHash: 'f'.repeat(64), state: 'stale', inputs: [], verification: { status: 'not_run', verifierId: 'seed', issues: ['upstream_changed'] }, staleBecause: ['model:architecture:1'] });
    before.artifactGraph.artifacts.push({ id: 'locked-downstream', kind: 'drawing', revision: 0, contentHash: 'a'.repeat(64), state: 'stale', inputs: [], verification: { status: 'not_run', verifierId: 'seed', issues: ['upstream_changed'] }, staleBecause: [quantityId] });
    before.artifactGraph.dependencies.push({ id: 'locked-derived', sourceId: quantityId, targetId: 'locked-downstream', policy: 'locked' });
    const hash = hashArchitectureInteriorWorkspaceV2(before); before.contentHash = hash; before.workspace.contentHash = hash;
    const result = execute(before, ['quantity']);
    expect(result).toMatchObject({ committed: false, code: 'locked_dependency', workspace: before });
  });

  it('refreshes stale model sources before rebuilding derived artifacts after an edit', () => {
    const before = workspace();
    const edited = executeArchitectureInteriorConceptTransaction({
      workspace: before,
      actorSource: 'user',
      edit: { kind: 'move_line_wall', wallId: 'wall-1', startMm: [0, 0], endMm: [4100, 0] },
    });
    expect(edited.committed).toBe(true);
    if (!edited.committed) return;
    expect(edited.workspace.artifactGraph.artifacts.filter(item => item.kind === 'model').every(item => item.state === 'stale')).toBe(true);

    const rebuilt = execute(edited.workspace);
    expect(rebuilt.committed).toBe(true);
    if (!rebuilt.committed) return;
    const models = rebuilt.bundle.artifactGraph.artifacts.filter(item => item.kind === 'model');
    expect(models).toHaveLength(2);
    expect(models.every(item => item.state === 'current' && item.revision === edited.workspace.workspace.revision)).toBe(true);
    expect(models.find(item => item.id.includes('architecture'))?.contentHash).toBe(edited.workspace.architecture.geometry.contentHash);
    expect(models.find(item => item.id.includes('interior'))?.contentHash).toBe(edited.workspace.interior.geometry.contentHash);
    expect(rebuilt.bundle.artifacts.every(item => item.artifact.inputs.every(input => models.some(model => model.id === input.artifactId && model.contentHash === input.contentHash)))).toBe(true);
    expect(validateArchitectureInteriorArtifactBundle(rebuilt.bundle)).toEqual([]);
    expect(before.artifactGraph.artifacts.every(item => item.state === 'current')).toBe(true);
  });

  it('does not revive a stale historical model when current model sources already exist', () => {
    const before = workspace();
    before.artifactGraph.artifacts.push({
      id: 'model:architecture:historical', kind: 'model', revision: 0, contentHash: 'e'.repeat(64), state: 'stale', inputs: [],
      verification: { status: 'not_run', verifierId: 'historical', issues: ['superseded'] }, staleBecause: ['model:architecture:1'],
    });
    const hash = hashArchitectureInteriorWorkspaceV2(before); before.contentHash = hash; before.workspace.contentHash = hash;
    const rebuilt = execute(before, ['quantity']);
    expect(rebuilt.committed).toBe(true);
    if (!rebuilt.committed) return;
    expect(rebuilt.bundle.artifactGraph.artifacts.find(item => item.id === 'model:architecture:historical')?.state).toBe('stale');
    expect(rebuilt.bundle.artifacts[0]!.artifact.inputs.map(input => input.artifactId)).not.toContain('model:architecture:historical');
    expect(validateArchitectureInteriorArtifactBundle(rebuilt.bundle)).toEqual([]);
  });
});
