import { describe, expect, it } from 'vitest';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from './designArtifactGraph';
import { hashArchitectureInteriorEvidenceV2, hashArchitectureInteriorWorkspaceV2, type ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import type { ArchitectureDocument, InteriorDocument } from './architectureInteriorDocuments';
import { buildArchitectureInteriorSectionArtifact, parseArchitectureInteriorSectionDrawing, verifyArchitectureInteriorSectionDrawingArtifact } from './architectureInteriorSectionArtifact';

const architecture: ArchitectureDocument = {
  schema: 'nexyfab.architecture.v1', revision: 1,
  storeys: [{ id: 'storey-1', name: 'Ground', elevationMm: 100, heightMm: 3000 }],
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
const interior: InteriorDocument = { schema: 'nexyfab.interior.v1', revision: 1, architectureDocumentId: 'architecture-1', lights: [], furniture: [], finishes: [] };

function fixture(): ArchitectureInteriorWorkspaceV2 {
  const ids = ['storey-1', 'space-1', 'wall-1', 'wall-2', 'wall-3', 'wall-4', 'slab-1', 'ceiling-1', 'door-1'];
  const frame = (id: string, kind: 'project' | 'site' | 'building' | 'storey' | 'object', parentId?: string, objectId?: string, documentId?: string) => ({ id, kind, ...(parentId ? { parentId } : {}), ...(objectId ? { objectId, documentId } : {}), ...(kind === 'storey' ? { storeyId: 'storey-1' } : {}), originMm: [0, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] });
  const evidence = { revision: 1 };
  const draft = {
    schema: 'nexyfab.architecture-interior-workspace.v2' as const, projectId: 'project-1', workspace: { projectId: 'project-1', revision: 1, contentHash: '', track: 'ai_design' as const, maturity: 'concept' as const }, contentHash: '', units: { sourceUnit: 'mm' as const, geometryUnit: 'mm' as const, analysisUnit: 'SI' as const },
    coordinates: [frame('project', 'project'), frame('site', 'site', 'project'), frame('building', 'building', 'site'), frame('storey-frame', 'storey', 'building'), ...ids.map(id => frame(`object-${id}`, 'object', 'storey-frame', id, 'architecture-1'))],
    architecture: { documentId: 'architecture-1', document: structuredClone(architecture), geometry: { representation: 'bim' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'concept', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'architecture', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'source-a', kind: 'user' as const, contentHash: 'a'.repeat(64) }] },
    interior: { documentId: 'interior-1', document: structuredClone(interior), geometry: { representation: 'procedural' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'concept', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'interior', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'source-i', kind: 'user' as const, contentHash: 'b'.repeat(64) }] },
    artifactGraph: { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'project-1', revision: 1, artifacts: [{ id: 'model-1', kind: 'model' as const, revision: 1, contentHash: 'c'.repeat(64), state: 'current' as const, inputs: [], verification: { status: 'passed' as const, verifierId: 'model-check', evidenceHash: 'd'.repeat(64), issues: [] }, staleBecause: [] }], dependencies: [] },
  } as ArchitectureInteriorWorkspaceV2;
  const contentHash = hashArchitectureInteriorWorkspaceV2(draft);
  return { ...draft, contentHash, workspace: { ...draft.workspace, contentHash } };
}

describe('architecture/interior structured section artifact', () => {
  it('emits only cut-intersected geometry with exact absolute levels', () => {
    const value = fixture(), built = buildArchitectureInteriorSectionArtifact(value, { axis: 'x', coordinateMm: 0, thicknessMm: 0 });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const storey = built.result.payload.view.storeys[0]!;
    expect(storey.walls.map(item => item.id)).toEqual(['wall-1', 'wall-3', 'wall-4']);
    expect(storey.openings).toEqual([]);
    expect(storey.walls.find(item => item.id === 'wall-4')?.cutGeometry).toMatchObject({ kind: 'interval' });
    expect(storey.slabs[0]).toMatchObject({ elevationMm: 100, cutIntervalsMm: [[0, 3000]] });
    expect(parseArchitectureInteriorSectionDrawing(JSON.stringify(built.result.payload))).toMatchObject({ ok: true });
  });

  it('includes an opening only when the cut reaches its host point and binds upper-storey levels', () => {
    const value = fixture(), built = buildArchitectureInteriorSectionArtifact(value, { axis: 'x', coordinateMm: 1000, thicknessMm: 0 });
    expect(built).toMatchObject({ ok: true });
    if (!built.ok) return;
    expect(built.result.payload.view.storeys[0]?.walls.map(item => item.id)).toEqual(['wall-1', 'wall-3']);
    expect(built.result.payload.view.storeys[0]?.openings[0]).toMatchObject({ id: 'door-1', cutPointsMm: [[1000, 0]], bottomElevationMm: 100, topElevationMm: 2100 });
    const interiorCut = buildArchitectureInteriorSectionArtifact(fixture(), { axis: 'x', coordinateMm: 600, thicknessMm: 0 });
    expect(interiorCut).toMatchObject({ ok: true });
    if (interiorCut.ok) expect(interiorCut.result.payload.view.storeys[0]?.openings[0]?.cutPointsMm).toHaveLength(1);
    const outsideCut = buildArchitectureInteriorSectionArtifact(fixture(), { axis: 'x', coordinateMm: 1600, thicknessMm: 0 });
    expect(outsideCut).toMatchObject({ ok: true });
    if (outsideCut.ok) expect(outsideCut.result.payload.view.storeys[0]?.openings).toEqual([]);
    value.architecture.document.storeys[0]!.elevationMm = 4000;
    const hash = hashArchitectureInteriorWorkspaceV2(value); value.contentHash = hash; value.workspace.contentHash = hash;
    const upper = buildArchitectureInteriorSectionArtifact(value, { axis: 'x', coordinateMm: 1000, thicknessMm: 0 });
    expect(upper).toMatchObject({ ok: true });
    if (upper.ok) {
      expect(upper.result.payload.view.storeys[0]?.openings[0]).toMatchObject({ bottomElevationMm: 4000, topElevationMm: 6000 });
      expect(upper.result.payload.view.storeys[0]?.ceilings[0]).toMatchObject({ elevationMm: 7000 });
    }
  });

  it('filters a curved-wall opening by directed arc offset', () => {
    const value = fixture();
    value.architecture.document.walls[0] = { id: 'wall-1', kind: 'arc', storeyId: 'storey-1', centerMm: [0, 0], radiusMm: 1000, startAngleDeg: 0, endAngleDeg: 180, thicknessMm: 200, heightMm: 3000 };
    value.architecture.document.openings[0]!.positionMm = [Math.cos(1) * 1000, Math.sin(1) * 1000, 0];
    const hash = hashArchitectureInteriorWorkspaceV2(value); value.contentHash = hash; value.workspace.contentHash = hash;
    const built = buildArchitectureInteriorSectionArtifact(value, { axis: 'x', coordinateMm: 500, thicknessMm: 0 });
    expect(built).toMatchObject({ ok: true });
    if (built.ok) expect(built.result.payload.view.storeys[0]?.openings[0]?.cutPointsMm).toHaveLength(1);
  });

  it('rejects stale/tampered content, duplicate IDs, non-finite cuts, and stale model inputs', () => {
    const value = fixture(), built = buildArchitectureInteriorSectionArtifact(value, { axis: 'x', coordinateMm: 1000, thicknessMm: 0 });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const tampered = structuredClone(built.result.payload); tampered.view.storeys[0]!.walls[0]!.topElevationMm += 1;
    expect(verifyArchitectureInteriorSectionDrawingArtifact({ payload: tampered, contentHash: hashArchitectureInteriorEvidenceV2(tampered) }, value).status).toBe('failed');
    const duplicate = structuredClone(built.result.payload); duplicate.view.storeys[0]!.ceilings[0]!.id = duplicate.view.storeys[0]!.walls[0]!.id;
    expect(parseArchitectureInteriorSectionDrawing(JSON.stringify(duplicate))).toMatchObject({ ok: false });
    expect(parseArchitectureInteriorSectionDrawing(JSON.stringify({ ...built.result.payload, cut: { axis: 'x', coordinateMm: null, thicknessMm: 0 } }))).toMatchObject({ ok: false });
    expect(buildArchitectureInteriorSectionArtifact(value, { axis: 'x', coordinateMm: 1000, thicknessMm: 0 }, [{ artifactId: 'model-1', revision: 0, contentHash: 'c'.repeat(64) }])).toMatchObject({ ok: false, code: 'section_reconciliation_failed' });

    const outside = fixture();
    outside.architecture.document.openings[0]!.offsetMm = 3800;
    let hash = hashArchitectureInteriorWorkspaceV2(outside); outside.contentHash = hash; outside.workspace.contentHash = hash;
    expect(buildArchitectureInteriorSectionArtifact(outside, { axis: 'x', coordinateMm: 1000, thicknessMm: 0 })).toMatchObject({ ok: false, code: 'section_reconciliation_failed' });
    const stale = fixture();
    stale.architecture.document.openings[0]!.positionMm = [1200, 0, 0];
    hash = hashArchitectureInteriorWorkspaceV2(stale); stale.contentHash = hash; stale.workspace.contentHash = hash;
    expect(buildArchitectureInteriorSectionArtifact(stale, { axis: 'x', coordinateMm: 1000, thicknessMm: 0 })).toMatchObject({ ok: false, code: 'section_reconciliation_failed' });
    const vertical = fixture();
    vertical.architecture.document.openings[0]!.heightMm = 4000;
    hash = hashArchitectureInteriorWorkspaceV2(vertical); vertical.contentHash = hash; vertical.workspace.contentHash = hash;
    expect(buildArchitectureInteriorSectionArtifact(vertical, { axis: 'x', coordinateMm: 1000, thicknessMm: 0 })).toMatchObject({ ok: false, code: 'section_reconciliation_failed' });
  });
});
