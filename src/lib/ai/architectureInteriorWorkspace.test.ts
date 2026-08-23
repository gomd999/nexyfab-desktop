import { describe, expect, it } from 'vitest';
import { hashArchitectureInteriorEvidenceV2, hashArchitectureInteriorWorkspaceV2, validateArchitectureInteriorWorkspaceV2, type ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import type { ArchitectureDocument, InteriorDocument } from './architectureInteriorDocuments';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from './designArtifactGraph';

const architecture: ArchitectureDocument = {
  schema: 'nexyfab.architecture.v1', revision: 3,
  storeys: [{ id: 'storey-1', name: 'Ground', elevationMm: 0, heightMm: 3000 }],
  walls: [
    { id: 'wall-1', kind: 'line', storeyId: 'storey-1', startMm: [0, 0], endMm: [1000, 0], thicknessMm: 100, heightMm: 3000 },
    { id: 'wall-2', kind: 'line', storeyId: 'storey-1', startMm: [1000, 0], endMm: [1000, 1000], thicknessMm: 100, heightMm: 3000 },
    { id: 'wall-3', kind: 'line', storeyId: 'storey-1', startMm: [1000, 1000], endMm: [0, 0], thicknessMm: 100, heightMm: 3000 },
  ],
  slabs: [{ id: 'slab-1', storeyId: 'storey-1', spaceId: 'space-1', boundaryMm: [[0, 0], [1000, 0], [1000, 1000]], thicknessMm: 200 }],
  ceilings: [{ id: 'ceiling-1', storeyId: 'storey-1', spaceId: 'space-1', boundaryMm: [[0, 0], [1000, 0], [1000, 1000]], elevationMm: 2800 }],
  spaces: [{ id: 'space-1', storeyId: 'storey-1', name: 'Room', usage: 'office', boundaryMm: [[0, 0], [1000, 0], [1000, 1000]], wallIds: ['wall-1', 'wall-2', 'wall-3'], slabId: 'slab-1', ceilingId: 'ceiling-1' }],
  openings: [],
};
const interior: InteriorDocument = { schema: 'nexyfab.interior.v1', revision: 3, architectureDocumentId: 'architecture-1', lights: [], furniture: [], finishes: [] };
function fixture(): ArchitectureInteriorWorkspaceV2 {
  const geometryPayload = { kind: 'canonical', revision: 3 };
  const semanticPayload = { schema: 'semantic.v2', projectId: 'project-1' };
  const graph = { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'project-1', revision: 3, artifacts: [], dependencies: [] } as ArchitectureInteriorWorkspaceV2['artifactGraph'];
  const draft = {
    schema: 'nexyfab.architecture-interior-workspace.v2', projectId: 'project-1', workspace: { projectId: 'project-1', revision: 3, contentHash: '', track: 'ai_design' as const, maturity: 'concept' as const }, contentHash: '', units: { sourceUnit: 'mm', geometryUnit: 'mm', analysisUnit: 'SI' },
    coordinates: [
      { id: 'project', kind: 'project', originMm: [0, 0, 0], rotationDeg: [0, 0, 0] }, { id: 'site', kind: 'site', parentId: 'project', originMm: [0, 0, 0], rotationDeg: [0, 0, 0] }, { id: 'building', kind: 'building', parentId: 'site', originMm: [0, 0, 0], rotationDeg: [0, 0, 0] }, { id: 'frame-storey-1', kind: 'storey', parentId: 'building', storeyId: 'storey-1', originMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
      ...['wall-1', 'wall-2', 'wall-3', 'slab-1', 'ceiling-1', 'space-1', 'storey-1'].map(objectId => ({ id: `object-${objectId}`, kind: 'object' as const, parentId: 'frame-storey-1', objectId, documentId: 'architecture-1', originMm: [0, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] })),
    ],
    architecture: { documentId: 'architecture-1', document: structuredClone(architecture), geometry: { representation: 'bim', units: 'mm', fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'concept-gate', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(geometryPayload), payload: geometryPayload }, semantic: { schema: 'semantic.v2', contentHash: hashArchitectureInteriorEvidenceV2(semanticPayload), payload: semanticPayload }, provenance: [{ sourceId: 'source-a', kind: 'user' as const, contentHash: 'a'.repeat(64) }] },
    interior: { documentId: 'interior-1', document: structuredClone(interior), geometry: { representation: 'procedural', units: 'mm', fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'concept-gate', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(geometryPayload), payload: geometryPayload }, semantic: { schema: 'semantic.v2', contentHash: hashArchitectureInteriorEvidenceV2(semanticPayload), payload: semanticPayload }, provenance: [{ sourceId: 'source-i', kind: 'user' as const, contentHash: 'b'.repeat(64) }] }, artifactGraph: graph,
  } as ArchitectureInteriorWorkspaceV2;
  const contentHash = hashArchitectureInteriorWorkspaceV2(draft);
  return { ...draft, contentHash, workspace: { ...draft.workspace, contentHash } };
}

describe('architecture/interior workspace v2', () => {
  it('binds both documents, evidence layers, units, artifact graph, and coordinate chain', () => expect(validateArchitectureInteriorWorkspaceV2(fixture())).toEqual([]));
  it('rejects stale revisions, duplicate IDs, and tampered common hashes', () => {
    const stale = fixture(); stale.interior.document.revision = 2; expect(validateArchitectureInteriorWorkspaceV2(stale)).toContain('stale_domain_revision');
    const duplicate = fixture(); duplicate.interior.document.finishes = [{ id: 'wall-1', spaceId: 'space-1', hostId: 'wall-1', surface: 'wall', material: 'paint' }]; expect(validateArchitectureInteriorWorkspaceV2(duplicate)).toContain('duplicate_object_id');
    const tampered = fixture(); tampered.contentHash = 'f'.repeat(64); expect(validateArchitectureInteriorWorkspaceV2(tampered)).toContain('workspace_content_hash_mismatch');
  });
  it('requires geometry mm and analysis SI, and rejects broken frame parents', () => {
    const invalid = fixture(); invalid.units.analysisUnit = 'mm' as 'SI'; invalid.coordinates[2]!.parentId = 'missing'; const issues = validateArchitectureInteriorWorkspaceV2(invalid); expect(issues).toContain('workspace_units_invalid'); expect(issues).toContain('coordinate_parent_missing');
  });
  it('uses frame relationships instead of reserved coordinate ids', () => {
    const renamed = fixture();
    const replacements = new Map([['project', 'project-frame'], ['site', 'site-frame'], ['building', 'building-frame']]);
    renamed.coordinates = renamed.coordinates.map(frame => ({
      ...frame,
      id: replacements.get(frame.id) ?? frame.id,
      parentId: frame.parentId ? replacements.get(frame.parentId) ?? frame.parentId : undefined,
    }));
    const contentHash = hashArchitectureInteriorWorkspaceV2(renamed);
    renamed.contentHash = contentHash;
    renamed.workspace.contentHash = contentHash;
    expect(validateArchitectureInteriorWorkspaceV2(renamed)).toEqual([]);
  });
  it('separates concept from exact and release verification gates', () => {
    const precision = fixture();
    precision.workspace.track = 'precision_cad';
    expect(validateArchitectureInteriorWorkspaceV2(precision)).toEqual(expect.arrayContaining(['architecture_exact_geometry_verification_required', 'interior_exact_geometry_verification_required']));

    const exact = fixture();
    exact.workspace.maturity = 'exact';
    expect(validateArchitectureInteriorWorkspaceV2(exact)).toEqual(expect.arrayContaining(['architecture_exact_geometry_verification_required', 'interior_exact_geometry_verification_required']));

    const release = fixture();
    release.workspace.maturity = 'release';
    expect(validateArchitectureInteriorWorkspaceV2(release)).toEqual(expect.arrayContaining(['architecture_release_verification_required', 'interior_release_verification_required']));

    const verified = fixture();
    verified.workspace.track = 'precision_cad';
    verified.workspace.maturity = 'exact';
    for (const domain of [verified.architecture, verified.interior]) {
      domain.geometry.representation = 'brep';
      domain.geometry.fidelity = 'exact_brep';
      domain.geometry.verification = { status: 'passed', verifierId: 'occt-v2', evidenceHash: 'c'.repeat(64), issues: [] };
    }
    verified.artifactGraph.artifacts = [{ id: 'exact-model', kind: 'model', revision: 3, contentHash: verified.architecture.geometry.contentHash, state: 'current', inputs: [], verification: { status: 'passed', verifierId: 'occt-v2', evidenceHash: 'e'.repeat(64), issues: [] }, staleBecause: [] }];
    const contentHash = hashArchitectureInteriorWorkspaceV2(verified);
    verified.contentHash = contentHash;
    verified.workspace.contentHash = contentHash;
    expect(validateArchitectureInteriorWorkspaceV2(verified)).toEqual([]);
  });

  it('does not accept an exact label on a mesh or an unbound model artifact', () => {
    const mislabeled = fixture();
    mislabeled.workspace.track = 'precision_cad';
    for (const domain of [mislabeled.architecture, mislabeled.interior]) domain.geometry.verification = { status: 'passed', verifierId: 'mesh-check', evidenceHash: 'c'.repeat(64), issues: [] };
    mislabeled.architecture.geometry.fidelity = 'exact_brep';
    mislabeled.interior.geometry.fidelity = 'exact_brep';
    expect(validateArchitectureInteriorWorkspaceV2(mislabeled)).toEqual(expect.arrayContaining(['architecture_exact_geometry_verification_required', 'architecture_geometry_artifact_binding_required']));
  });

  it('preserves artifact graph current-artifact validation', () => {
    const invalid = fixture();
    invalid.artifactGraph.artifacts = [{ id: 'model', kind: 'model', revision: 3, contentHash: 'd'.repeat(64), state: 'current', inputs: [], verification: { status: 'not_run', verifierId: 'none', issues: [] }, staleBecause: [] }];
    const contentHash = hashArchitectureInteriorWorkspaceV2(invalid);
    invalid.contentHash = contentHash;
    invalid.workspace.contentHash = contentHash;
    expect(validateArchitectureInteriorWorkspaceV2(invalid)).toContain('current_artifact_not_verified:model');
  });
});
