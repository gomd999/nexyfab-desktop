import { describe, expect, it } from 'vitest';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from './designArtifactGraph';
import { hashArchitectureInteriorEvidenceV2, hashArchitectureInteriorWorkspaceV2, type ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import type { ArchitectureDocument, InteriorDocument } from './architectureInteriorDocuments';
import {
  buildArchitectureInteriorElevationArtifact,
  parseArchitectureInteriorElevationDrawing,
  verifyArchitectureInteriorElevationDrawingArtifact,
} from './architectureInteriorElevationArtifact';

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

describe('architecture/interior structured elevation artifact', () => {
  it('emits deterministic revision-bound source geometry and parses independently', () => {
    const value = fixture(), first = buildArchitectureInteriorElevationArtifact(value), second = buildArchitectureInteriorElevationArtifact(value);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.result.payload.view.storeys[0]).toMatchObject({ id: 'storey-1', baseElevationMm: 100, topElevationMm: 3100 });
    expect(first.result.payload.view.storeys[0]?.walls).toHaveLength(4);
    expect(first.result.payload.view.storeys[0]?.openings[0]).toMatchObject({ id: 'door-1', projectionMm: { uMm: 1000, minUMm: 500, maxUMm: 1500, bottomElevationMm: 100, topElevationMm: 2100 } });
    expect(parseArchitectureInteriorElevationDrawing(JSON.stringify(first.result.payload))).toMatchObject({ ok: true });
    expect(first.result.artifact).toMatchObject({ id: 'drawing:architecture-elevation:1', revision: 1, contentHash: first.result.contentHash });
  });

  it('rejects tamper, stale model bindings, duplicate IDs, unknown keys, and non-finite input', () => {
    const value = fixture(), built = buildArchitectureInteriorElevationArtifact(value);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const tampered = structuredClone(built.result.payload);
    tampered.view.storeys[0]!.walls[0]!.heightMm += 1;
    expect(verifyArchitectureInteriorElevationDrawingArtifact({ payload: tampered, contentHash: hashArchitectureInteriorEvidenceV2(tampered) }, value).status).toBe('failed');
    expect(buildArchitectureInteriorElevationArtifact(value, [{ artifactId: 'model-1', revision: 0, contentHash: 'c'.repeat(64) }])).toMatchObject({ ok: false, code: 'elevation_reconciliation_failed' });
    const duplicate = structuredClone(built.result.payload);
    duplicate.view.storeys[0]!.ceilings[0]!.id = duplicate.view.storeys[0]!.walls[0]!.id;
    expect(parseArchitectureInteriorElevationDrawing(JSON.stringify(duplicate))).toMatchObject({ ok: false });
    const extra = structuredClone(built.result.payload) as unknown as Record<string, unknown>;
    extra.extra = true;
    expect(parseArchitectureInteriorElevationDrawing(JSON.stringify(extra))).toMatchObject({ ok: false });
    const nonFinite = JSON.stringify(built.result.payload).replace('100', 'null');
    expect(parseArchitectureInteriorElevationDrawing(nonFinite)).toMatchObject({ ok: false });
  });

  it('keeps upper-storey absolute elevations while rejecting out-of-host and stale opening geometry', () => {
    const upper = fixture();
    upper.architecture.document.storeys[0]!.elevationMm = 4000;
    const upperHash = hashArchitectureInteriorWorkspaceV2(upper);
    upper.contentHash = upperHash;
    upper.workspace.contentHash = upperHash;
    const built = buildArchitectureInteriorElevationArtifact(upper);
    expect(built).toMatchObject({ ok: true });
    if (!built.ok) return;
    expect(built.result.payload.view.storeys[0]).toMatchObject({ baseElevationMm: 4000, topElevationMm: 7000 });
    expect(built.result.payload.view.storeys[0]?.openings[0]?.projectionMm).toMatchObject({ bottomElevationMm: 4000, topElevationMm: 6000 });
    expect(built.result.payload.view.storeys[0]?.ceilings[0]).toMatchObject({ elevationMm: 7000 });

    const outside = fixture();
    outside.architecture.document.openings[0]!.offsetMm = 3800;
    const outsideHash = hashArchitectureInteriorWorkspaceV2(outside);
    outside.contentHash = outsideHash;
    outside.workspace.contentHash = outsideHash;
    expect(buildArchitectureInteriorElevationArtifact(outside)).toMatchObject({ ok: false, code: 'elevation_reconciliation_failed' });

    const stale = fixture();
    stale.architecture.document.openings[0]!.positionMm = [1200, 0, 0];
    const staleHash = hashArchitectureInteriorWorkspaceV2(stale);
    stale.contentHash = staleHash;
    stale.workspace.contentHash = staleHash;
    expect(buildArchitectureInteriorElevationArtifact(stale)).toMatchObject({ ok: false, code: 'elevation_reconciliation_failed' });

    const vertical = fixture();
    vertical.architecture.document.openings[0]!.heightMm = 4000;
    const verticalHash = hashArchitectureInteriorWorkspaceV2(vertical);
    vertical.contentHash = verticalHash;
    vertical.workspace.contentHash = verticalHash;
    expect(buildArchitectureInteriorElevationArtifact(vertical)).toMatchObject({ ok: false, code: 'elevation_reconciliation_failed' });

    const localZ = fixture();
    localZ.architecture.document.openings[0]!.positionMm = [1000, 0, 1];
    const localZHash = hashArchitectureInteriorWorkspaceV2(localZ);
    localZ.contentHash = localZHash;
    localZ.workspace.contentHash = localZHash;
    expect(buildArchitectureInteriorElevationArtifact(localZ)).toMatchObject({ ok: false, code: 'elevation_reconciliation_failed' });
  });

  it('includes cardinal extrema in curved-wall opening projection bounds', () => {
    const curved = fixture();
    const radiusMm = 1000;
    const centerOffsetMm = Math.PI * radiusMm / 6;
    curved.architecture.document.walls[0] = { id: 'wall-1', kind: 'arc', storeyId: 'storey-1', centerMm: [0, 0], radiusMm, startAngleDeg: -30, endAngleDeg: 30, thicknessMm: 200, heightMm: 3000 };
    curved.architecture.document.openings[0] = { id: 'door-1', kind: 'door', hostWallId: 'wall-1', offsetMm: centerOffsetMm, widthMm: 400, heightMm: 2000, sillMm: 0, positionMm: [1000, 0, 0] };
    const curvedHash = hashArchitectureInteriorWorkspaceV2(curved);
    curved.contentHash = curvedHash;
    curved.workspace.contentHash = curvedHash;
    const built = buildArchitectureInteriorElevationArtifact(curved);
    expect(built).toMatchObject({ ok: true });
    if (!built.ok) return;
    expect(built.result.payload.view.storeys[0]?.openings[0]?.projectionMm.maxUMm).toBe(1000);
    expect(built.result.payload.view.storeys[0]?.openings[0]?.projectionMm.minUMm).toBeCloseTo(Math.cos(0.2) * radiusMm, 9);
  });
});
