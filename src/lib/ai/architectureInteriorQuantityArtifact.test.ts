import { describe, expect, it } from 'vitest';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from './designArtifactGraph';
import { buildArchitectureInteriorQuantityArtifact } from './architectureInteriorQuantityArtifact';
import { hashArchitectureInteriorEvidenceV2, hashArchitectureInteriorWorkspaceV2, type ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
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
  const draft = { schema: 'nexyfab.architecture-interior-workspace.v2', projectId: 'project-1', workspace: { projectId: 'project-1', revision: 1, contentHash: '', track: 'ai_design' as const, maturity: 'concept' as const }, contentHash: '', units: { sourceUnit: 'mm' as const, geometryUnit: 'mm' as const, analysisUnit: 'SI' as const }, coordinates: [frame('project', 'project'), frame('site', 'site', 'project'), frame('building', 'building', 'site'), frame('storey', 'storey', 'building'), ...['storey-1', 'space-1', 'wall-1', 'wall-2', 'wall-3', 'wall-4', 'slab-1', 'ceiling-1', 'door-1'].map(id => frame(`object-${id}`, 'object', 'storey', id, 'architecture-1')), ...['desk-1', 'light-1', 'paint-1'].map(id => frame(`object-${id}`, 'object', 'storey', id, 'interior-1'))], architecture: { documentId: 'architecture-1', document: architecture, geometry: { representation: 'bim' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'concept', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'architecture', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'source-a', kind: 'user' as const, contentHash: 'a'.repeat(64) }] }, interior: { documentId: 'interior-1', document: interior, geometry: { representation: 'procedural' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'concept', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'interior', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'source-i', kind: 'user' as const, contentHash: 'b'.repeat(64) }] }, artifactGraph: { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'project-1', revision: 1, artifacts: [{ id: 'model:architecture:1', kind: 'model', revision: 1, contentHash: 'c'.repeat(64), state: 'current', inputs: [], verification: modelVerification, staleBecause: [] }, { id: 'model:interior:1', kind: 'model', revision: 1, contentHash: 'd'.repeat(64), state: 'current', inputs: [], verification: modelVerification, staleBecause: [] }], dependencies: [] } } as ArchitectureInteriorWorkspaceV2;
  const contentHash = hashArchitectureInteriorWorkspaceV2(draft); draft.contentHash = contentHash; draft.workspace.contentHash = contentHash; return draft;
}

describe('architecture/interior quantity artifact', () => {
  it('reconciles schedules and quantities to the bound documents without inventing prices', () => {
    const result = buildArchitectureInteriorQuantityArtifact(workspace());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.payload.binding.workspaceContentHash).toBe(workspace().contentHash);
    expect(result.result.payload.schedules.spaces[0]?.areaM2).toBe(12);
    expect(result.result.payload.schedules.walls.find(item => item.id === 'wall-1')).toMatchObject({ grossAreaM2: 12, openingAreaM2: 2, netAreaM2: 10, volumeM3: 2 });
    expect(result.result.payload.schedules.finishes[0]).toMatchObject({ materialCode: 'paint.white', areaM2: 10 });
    expect(result.result.payload.totals).toMatchObject({ spaceAreaM2: 12, slabVolumeM3: 2.4, openingCountEa: 1, furnitureCountEa: 1, lightCountEa: 1 });
    expect(result.result.payload.pricing).toEqual({ status: 'not_run', reasonCode: 'authoritative_unit_rates_required' });
    expect(result.result.artifact).toMatchObject({ kind: 'quantity', state: 'current', verification: { status: 'passed' } });
    expect(result.result.dependencies).toHaveLength(2);
    expect(result.result.dependencies.every(edge => edge.targetId === result.result.artifact.id && edge.policy === 'invalidate')).toBe(true);
  });

  it('is deterministic and fails closed for a tampered workspace', () => {
    const value = workspace();
    expect(buildArchitectureInteriorQuantityArtifact(value)).toEqual(buildArchitectureInteriorQuantityArtifact(value));
    value.architecture.document.walls[0]!.heightMm = 9999;
    expect(buildArchitectureInteriorQuantityArtifact(value)).toMatchObject({ ok: false, code: 'invalid_workspace' });
  });

  it('fails closed when a finish surface points to the wrong host kind', () => {
    const value = workspace();
    value.interior.document.finishes[0]!.hostId = 'slab-1';
    value.contentHash = '';
    value.workspace.contentHash = '';
    const contentHash = hashArchitectureInteriorWorkspaceV2(value);
    value.contentHash = contentHash;
    value.workspace.contentHash = contentHash;
    expect(buildArchitectureInteriorQuantityArtifact(value)).toMatchObject({ ok: false, code: 'quantity_reconciliation_failed', issues: ['finish_surface_host_mismatch'] });
  });
});
