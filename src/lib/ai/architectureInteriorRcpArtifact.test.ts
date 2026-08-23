import { describe, expect, it } from 'vitest';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from './designArtifactGraph';
import { hashArchitectureInteriorEvidenceV2, hashArchitectureInteriorWorkspaceV2, type ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import type { ArchitectureDocument, InteriorDocument } from './architectureInteriorDocuments';
import { buildArchitectureInteriorRcpArtifact, parseArchitectureInteriorRcpDrawing, verifyArchitectureInteriorRcpDrawingArtifact } from './architectureInteriorRcpArtifact';

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
  openings: [{ id: 'door-1', kind: 'door', hostWallId: 'wall-1', offsetMm: 1000, widthMm: 1000, heightMm: 2000, sillMm: 0, positionMm: [1000, 0, 0], connectsSpaceIds: ['space-1'] }],
};
const interior: InteriorDocument = {
  schema: 'nexyfab.interior.v1', revision: 1, architectureDocumentId: 'architecture-1',
  furniture: [{ id: 'desk-1', spaceId: 'space-1', positionMm: [2000, 1500, 0], sizeMm: [1600, 800, 750], clearanceMm: 100 }],
  lights: [{ id: 'light-1', spaceId: 'space-1', hostCeilingId: 'ceiling-1', positionMm: [2000, 1500, 2800], suspensionMm: 200, lumens: 3000, cctK: 4000 }],
  finishes: [{ id: 'paint-1', spaceId: 'space-1', hostId: 'wall-1', surface: 'wall', material: 'paint.white' }],
  ceilingSystems: [{ id: 'ceiling-system-1', spaceId: 'space-1', hostCeilingId: 'ceiling-1', kind: 'grid', elevationMm: 2800, moduleMm: [600, 600] }],
};

function fixture(): ArchitectureInteriorWorkspaceV2 {
  const architectureIds = ['storey-1', 'space-1', 'wall-1', 'wall-2', 'wall-3', 'wall-4', 'slab-1', 'ceiling-1', 'door-1'];
  const interiorIds = ['desk-1', 'light-1', 'paint-1', 'ceiling-system-1'];
  const frame = (id: string, kind: 'project' | 'site' | 'building' | 'storey' | 'object', parentId?: string, objectId?: string, documentId?: string) => ({ id, kind, ...(parentId ? { parentId } : {}), ...(objectId ? { objectId, documentId } : {}), ...(kind === 'storey' ? { storeyId: 'storey-1' } : {}), originMm: [0, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] });
  const evidence = { revision: 1 };
  const draft = {
    schema: 'nexyfab.architecture-interior-workspace.v2' as const, projectId: 'project-1', workspace: { projectId: 'project-1', revision: 1, contentHash: '', track: 'ai_design' as const, maturity: 'concept' as const }, contentHash: '', units: { sourceUnit: 'mm' as const, geometryUnit: 'mm' as const, analysisUnit: 'SI' as const },
    coordinates: [frame('project', 'project'), frame('site', 'site', 'project'), frame('building', 'building', 'site'), frame('storey-frame', 'storey', 'building'), ...architectureIds.map(id => frame(`object-${id}`, 'object', 'storey-frame', id, 'architecture-1')), ...interiorIds.map(id => frame(`object-${id}`, 'object', 'storey-frame', id, 'interior-1'))],
    architecture: { documentId: 'architecture-1', document: structuredClone(architecture), geometry: { representation: 'bim' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'concept', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'architecture', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'source-a', kind: 'user' as const, contentHash: 'a'.repeat(64) }] },
    interior: { documentId: 'interior-1', document: structuredClone(interior), geometry: { representation: 'procedural' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'concept', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'interior', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'source-i', kind: 'user' as const, contentHash: 'b'.repeat(64) }] },
    artifactGraph: { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'project-1', revision: 1, artifacts: [{ id: 'model-1', kind: 'model' as const, revision: 1, contentHash: 'c'.repeat(64), state: 'current' as const, inputs: [], verification: { status: 'passed' as const, verifierId: 'model-check', evidenceHash: 'd'.repeat(64), issues: [] }, staleBecause: [] }], dependencies: [] },
  } as ArchitectureInteriorWorkspaceV2;
  const contentHash = hashArchitectureInteriorWorkspaceV2(draft);
  return { ...draft, contentHash, workspace: { ...draft.workspace, contentHash } };
}

describe('architecture/interior reflected ceiling plan artifact', () => {
  it('emits deterministic, revision-bound structured RCP and parses it independently', () => {
    const value = fixture();
    const first = buildArchitectureInteriorRcpArtifact(value), second = buildArchitectureInteriorRcpArtifact(value);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const storey = first.result.payload.view.storeys[0]!;
    expect(storey.ceilings).toHaveLength(1);
    expect(storey.openings[0]).toMatchObject({ id: 'door-1', hostWallId: 'wall-1', hostSpaceIds: ['space-1'] });
    expect(storey.ceilingSystems[0]).toMatchObject({ id: 'ceiling-system-1', hostCeilingId: 'ceiling-1' });
    expect(storey.lights[0]).toMatchObject({ id: 'light-1', hostCeilingId: 'ceiling-1' });
    const parsed = parseArchitectureInteriorRcpDrawing(JSON.stringify(first.result.payload));
    expect(parsed.ok).toBe(true);
    const malformed = structuredClone(first.result.payload) as Record<string, unknown>;
    malformed.view = { ...first.result.payload.view, storeys: [null] };
    expect(parseArchitectureInteriorRcpDrawing(JSON.stringify(malformed)).ok).toBe(false);
    const duplicate = structuredClone(first.result.payload);
    duplicate.view.storeys[0]!.lights[0]!.id = 'ceiling-system-1';
    expect(parseArchitectureInteriorRcpDrawing(JSON.stringify(duplicate)).ok).toBe(false);
    expect(verifyArchitectureInteriorRcpDrawingArtifact(first.result, value)).toMatchObject({ status: 'passed' });
  });

  it('rejects tampered payloads and stale workspace revisions', () => {
    const value = fixture(), built = buildArchitectureInteriorRcpArtifact(value);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const tampered = structuredClone(built.result.payload);
    tampered.view.storeys[0]!.lights[0]!.positionMm[0] += 1;
    expect(verifyArchitectureInteriorRcpDrawingArtifact({ payload: tampered, contentHash: built.result.contentHash }, value).status).toBe('failed');
    const recomputed = structuredClone(built.result.payload);
    recomputed.view.storeys[0]!.spaces[0]!.boundaryMm[0]![0] += 1;
    recomputed.view.storeys[0]!.topElevationMm += 1;
    expect(verifyArchitectureInteriorRcpDrawingArtifact({ payload: recomputed, contentHash: hashArchitectureInteriorEvidenceV2(recomputed) }, value).status).toBe('failed');
    const stale = fixture(); stale.workspace.revision = 2;
    expect(buildArchitectureInteriorRcpArtifact(stale)).toMatchObject({ ok: false, code: 'invalid_workspace' });
    expect(buildArchitectureInteriorRcpArtifact(value, [{ artifactId: 'model-1', revision: 0, contentHash: 'c'.repeat(64) }])).toMatchObject({ ok: false, code: 'rcp_reconciliation_failed' });
    expect(buildArchitectureInteriorRcpArtifact(value, null as unknown as never)).toMatchObject({ ok: true });
    expect(buildArchitectureInteriorRcpArtifact(value, [{ artifactId: null } as never])).toMatchObject({ ok: false, code: 'rcp_reconciliation_failed' });
  });

  it('rejects a ceiling-system host mismatch in the independent verifier', () => {
    const value = fixture(), built = buildArchitectureInteriorRcpArtifact(value);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const tampered = structuredClone(built.result.payload);
    tampered.view.storeys[0]!.ceilingSystems[0]!.hostCeilingId = 'missing-ceiling';
    const contentHash = hashArchitectureInteriorEvidenceV2(tampered);
    expect(verifyArchitectureInteriorRcpDrawingArtifact({ payload: tampered, contentHash }, value)).toMatchObject({ status: 'failed' });
  });

  it('uses absolute elevations for a nonzero upper storey', () => {
    const value = fixture();
    value.architecture.document.storeys[0]!.elevationMm = 4000;
    value.architecture.document.ceilings[0]!.elevationMm = 7000;
    value.interior.document.ceilingSystems![0]!.elevationMm = 6800;
    value.interior.document.lights[0]!.positionMm[2] = 6800;
    const contentHash = hashArchitectureInteriorWorkspaceV2(value);
    value.contentHash = contentHash; value.workspace.contentHash = contentHash;
    const built = buildArchitectureInteriorRcpArtifact(value);
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.result.payload.view.storeys[0]).toMatchObject({ elevationMm: 4000, topElevationMm: 7000 });
  });
});
