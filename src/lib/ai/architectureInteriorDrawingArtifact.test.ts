import { describe, expect, it } from 'vitest';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from './designArtifactGraph';
import { hashArchitectureInteriorEvidenceV2, hashArchitectureInteriorWorkspaceV2, type ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import type { ArchitectureDocument, InteriorDocument } from './architectureInteriorDocuments';
import { buildArchitectureInteriorDrawingArtifact } from './architectureInteriorDrawingArtifact';

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
const interior: InteriorDocument = {
  schema: 'nexyfab.interior.v1', revision: 1, architectureDocumentId: 'architecture-1',
  furniture: [{ id: 'desk-1', spaceId: 'space-1', positionMm: [2000, 1500, 0], sizeMm: [1600, 800, 750], clearanceMm: 100 }],
  lights: [{ id: 'light-1', spaceId: 'space-1', hostCeilingId: 'ceiling-1', positionMm: [2000, 1500, 2800], suspensionMm: 200, lumens: 3000, cctK: 4000 }],
  finishes: [{ id: 'paint-1', spaceId: 'space-1', hostId: 'wall-1', surface: 'wall', material: 'paint.white' }],
};

function fixture(): ArchitectureInteriorWorkspaceV2 {
  const evidence = { revision: 1 };
  const ids = ['storey-1', 'space-1', 'wall-1', 'wall-2', 'wall-3', 'wall-4', 'slab-1', 'ceiling-1', 'door-1'];
  const interiorIds = ['desk-1', 'light-1', 'paint-1'];
  const frame = (id: string, kind: 'project' | 'site' | 'building' | 'storey' | 'object', parentId?: string, objectId?: string, documentId?: string) => ({ id, kind, ...(parentId ? { parentId } : {}), ...(objectId ? { objectId, documentId } : {}), ...(kind === 'storey' ? { storeyId: 'storey-1' } : {}), originMm: [0, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] });
  const draft = {
    schema: 'nexyfab.architecture-interior-workspace.v2' as const, projectId: 'project-1', workspace: { projectId: 'project-1', revision: 1, contentHash: '', track: 'ai_design' as const, maturity: 'concept' as const }, contentHash: '', units: { sourceUnit: 'mm' as const, geometryUnit: 'mm' as const, analysisUnit: 'SI' as const },
    coordinates: [frame('project', 'project'), frame('site', 'site', 'project'), frame('building', 'building', 'site'), frame('storey-frame', 'storey', 'building'), ...ids.map(id => frame(`object-${id}`, 'object', 'storey-frame', id, 'architecture-1')), ...interiorIds.map(id => frame(`object-${id}`, 'object', 'storey-frame', id, 'interior-1'))],
    architecture: { documentId: 'architecture-1', document: structuredClone(architecture), geometry: { representation: 'bim' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'concept', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'architecture', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'source-a', kind: 'user' as const, contentHash: 'a'.repeat(64) }] },
    interior: { documentId: 'interior-1', document: structuredClone(interior), geometry: { representation: 'procedural' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'concept', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'interior', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'source-i', kind: 'user' as const, contentHash: 'b'.repeat(64) }] },
    artifactGraph: { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'project-1', revision: 1, artifacts: [{ id: 'model-1', kind: 'model' as const, revision: 1, contentHash: 'c'.repeat(64), state: 'current' as const, inputs: [], verification: { status: 'passed' as const, verifierId: 'model-check', evidenceHash: 'd'.repeat(64), issues: [] }, staleBecause: [] }], dependencies: [] },
  } as ArchitectureInteriorWorkspaceV2;
  const contentHash = hashArchitectureInteriorWorkspaceV2(draft);
  return { ...draft, contentHash, workspace: { ...draft.workspace, contentHash } };
}

describe('architecture/interior drawing artifact', () => {
  it('emits deterministic plan and section geometry with model bindings and edges', () => {
    const value = fixture();
    const first = buildArchitectureInteriorDrawingArtifact(value);
    const second = buildArchitectureInteriorDrawingArtifact(value);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.result.payload.views.plan.storeys[0]?.walls).toHaveLength(4);
    expect(first.result.payload.views.section.walls[0]).toMatchObject({ id: 'wall-1', baseElevationMm: 0, topElevationMm: 3000 });
    expect(first.result.artifact.inputs).toEqual([{ artifactId: 'model-1', revision: 1, contentHash: 'c'.repeat(64) }]);
    expect(first.result.dependencies[0]).toMatchObject({ sourceId: 'model-1', targetId: first.result.artifact.id, policy: 'invalidate' });
    expect(first.result.payload.rendering).toEqual({ labels: 'stable_codes_only', localizedTextEmbedded: false, source: 'workspace_documents' });
  });

  it('rejects tampered workspace hashes and invalid semantic hosts', () => {
    const tampered = fixture();
    const firstWall = tampered.architecture.document.walls[0]!;
    if (firstWall.kind === 'line') firstWall.endMm = [9999, 0];
    expect(buildArchitectureInteriorDrawingArtifact(tampered)).toMatchObject({ ok: false, code: 'invalid_workspace' });
    const badHost = fixture();
    badHost.interior.document.finishes[0]!.surface = 'ceiling';
    const contentHash = hashArchitectureInteriorWorkspaceV2(badHost);
    badHost.contentHash = contentHash;
    badHost.workspace.contentHash = contentHash;
    expect(buildArchitectureInteriorDrawingArtifact(badHost)).toMatchObject({ ok: false, code: 'drawing_reconciliation_failed' });
  });
});
