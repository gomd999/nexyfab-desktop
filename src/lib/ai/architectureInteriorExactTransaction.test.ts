import { describe, expect, it } from 'vitest';
import { ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION, type ArchitectureExactKernelAdapter } from './architectureInteriorExactGeometry';
import { buildArchitectureInteriorExactGeometryRequest, executeArchitectureInteriorExactTransaction, validateServiceOpeningReceipts, type ArchitectureInteriorExactTransactionInput } from './architectureInteriorExactTransaction';
import { hashArchitectureInteriorEvidenceV2, hashArchitectureInteriorWorkspaceV2, validateArchitectureInteriorWorkspaceV2, type ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import type { ArchitectureDocument, InteriorDocument } from './architectureInteriorDocuments';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from './designArtifactGraph';
import type { OcctShape } from '@/lib/occt/types';

const shape = (id: string): OcctShape => ({ id, kind: 'solid' });
function adapter(overrides: Partial<ArchitectureExactKernelAdapter> = {}): ArchitectureExactKernelAdapter {
  let sequence = 0;
  return {
    identity: { backend: 'occt-node', kernel: 'opencascade.js', realKernel: true, version: '1.1.1', buildSha256: 'b'.repeat(64), wasmSha256: 'c'.repeat(64) },
    buildPrismAt: async () => ({ ok: true, shape: shape(`s${++sequence}`), warnings: [] }),
    subtract: async () => ({ ok: true, shape: shape(`s${++sequence}`), warnings: [] }),
    inspectShape: async () => ({ valid: true, solidCount: 1, faceCount: 6, edgeCount: 12 }),
    inspectShapeDetailed: async () => ({ valid: true, solidCount: 1, faceCount: 6, edgeCount: 12, bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } }, absoluteVolume: 1000, surfaceArea: 600, centroid: { x: 5, y: 5, z: 5 }, inertia: { status: 'not_run', reason: 'test' }, surfaceTypes: { status: 'not_run', reason: 'test' }, curveTypes: { status: 'not_run', reason: 'test' }, faceAdjacency: { status: 'not_run', reason: 'test' }, maxTolerance: 0.01 }),
    exportSTEP: async () => 'ISO-10303-21;\nMANIFOLD_SOLID_BREP;\nEND-ISO-10303-21;',
    release: () => undefined,
    ...overrides,
  };
}

const architecture: ArchitectureDocument = {
  schema: 'nexyfab.architecture.v1', revision: 1,
  storeys: [{ id: 'st', name: 'Ground', elevationMm: 0, heightMm: 3000 }],
  walls: [
    { id: 'w1', kind: 'line', storeyId: 'st', startMm: [0, 0], endMm: [100, 0], thicknessMm: 10, heightMm: 3000 },
    { id: 'w2', kind: 'line', storeyId: 'st', startMm: [100, 0], endMm: [100, 100], thicknessMm: 10, heightMm: 3000 },
    { id: 'w3', kind: 'line', storeyId: 'st', startMm: [100, 100], endMm: [0, 0], thicknessMm: 10, heightMm: 3000 },
  ],
  slabs: [{ id: 'sl', storeyId: 'st', spaceId: 'sp', boundaryMm: [[0, 0], [100, 0], [100, 100]], thicknessMm: 100 }],
  // thicknessMm is an explicit exact-only extension; the legacy document schema
  // currently omits it, so the builder must reject a document without it.
  ceilings: [{ id: 'ce', storeyId: 'st', spaceId: 'sp', boundaryMm: [[0, 0], [100, 0], [100, 100]], elevationMm: 2800, thicknessMm: 100 } as ArchitectureDocument['ceilings'][number] & { thicknessMm: number }],
  spaces: [{ id: 'sp', storeyId: 'st', name: 'Room', usage: 'office', boundaryMm: [[0, 0], [100, 0], [100, 100]], wallIds: ['w1', 'w2', 'w3'], slabId: 'sl', ceilingId: 'ce' }], openings: [],
};
const interior: InteriorDocument = { schema: 'nexyfab.interior.v1', revision: 1, architectureDocumentId: 'arch', lights: [], furniture: [], finishes: [] };
const frame = (id: string, kind: 'project' | 'site' | 'building' | 'storey' | 'object', parentId?: string, objectId?: string) => ({ id, kind, ...(parentId ? { parentId } : {}), ...(objectId ? { objectId, documentId: 'arch' } : {}), ...(kind === 'storey' ? { storeyId: 'st' } : {}), originMm: [0, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] });

function fixture(): ArchitectureInteriorWorkspaceV2 {
  const evidence = { revision: 1 };
  const draft = { schema: 'nexyfab.architecture-interior-workspace.v2', projectId: 'p', workspace: { projectId: 'p', revision: 1, contentHash: '', track: 'ai_design' as const, maturity: 'concept' as const }, contentHash: '', units: { sourceUnit: 'mm' as const, geometryUnit: 'mm' as const, analysisUnit: 'SI' as const }, coordinates: [frame('project', 'project'), frame('site', 'site', 'project'), frame('building', 'building', 'site'), frame('storey', 'storey', 'building'), ...['st', 'w1', 'w2', 'w3', 'sl', 'ce', 'sp'].map(id => frame(`obj-${id}`, 'object', 'storey', id))], architecture: { documentId: 'arch', document: structuredClone(architecture), geometry: { representation: 'bim' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'seed', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'seed', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'seed-a', kind: 'user' as const, contentHash: 'a'.repeat(64) }] }, interior: { documentId: 'int', document: structuredClone(interior), geometry: { representation: 'procedural' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'seed', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'seed', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'seed-i', kind: 'user' as const, contentHash: 'b'.repeat(64) }] }, artifactGraph: { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'p', revision: 1, artifacts: [{ id: 'model-old', kind: 'model' as const, revision: 1, contentHash: 'c'.repeat(64), state: 'current' as const, inputs: [], verification: { status: 'passed' as const, verifierId: 'seed', evidenceHash: 'd'.repeat(64), issues: [] }, staleBecause: [] }], dependencies: [] } } as ArchitectureInteriorWorkspaceV2;
  const contentHash = hashArchitectureInteriorWorkspaceV2(draft);
  return { ...draft, contentHash, workspace: { ...draft.workspace, contentHash } };
}

const approval = { approved: true as const, approvalId: 'approval-1', actorId: 'architect-1', baseRevision: 1, scope: 'architecture-interior-exact' as const };
function input(workspace: ArchitectureInteriorWorkspaceV2, overrides: Partial<ArchitectureInteriorExactTransactionInput> = {}): ArchitectureInteriorExactTransactionInput { return { workspace, adapter: adapter(), interiorAdapter: adapter(), approval, ...overrides }; }
function serviceFixture(): ArchitectureInteriorWorkspaceV2 {
  const value = fixture();
  value.architecture.document.serviceOpenings = [{ id: 'svc-1', hostId: 'sl', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', shape: 'round', centerMm: [50, 50, -50], axis: [0, 0, 1], cutDiameterMm: 20, depthMm: 150, firestopAnnulusMm: 5, structuralApprovalId: 'approval-ref-1' }];
  value.coordinates.push(frame('obj-svc-1', 'object', 'storey', 'svc-1'));
  const hash = hashArchitectureInteriorWorkspaceV2(value); value.contentHash = hash; value.workspace.contentHash = hash;
  return value;
}

describe('architecture/interior exact request and atomic transaction', () => {
  it('builds only from bound documents and binds both document hashes', () => {
    const result = buildArchitectureInteriorExactGeometryRequest(fixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.request.contractVersion).toBe(ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION);
    expect(result.bundle.request.binding.documentHash).toBe(result.bundle.documentHashes.architecture);
    expect(result.bundle.documentHashes.interior).toHaveLength(64);
    expect(result.bundle.request.walls[0]).toMatchObject({ id: 'w1', z0Mm: 0 });
    expect(result.bundle.request.ceilings[0]).toMatchObject({ id: 'ce', thicknessMm: 100 });
  });

  it('fails closed rather than guessing missing ceiling thickness or interior solids', async () => {
    const missingThickness = fixture();
    delete (missingThickness.architecture.document.ceilings[0] as ArchitectureDocument['ceilings'][number] & { thicknessMm?: number }).thicknessMm;
    const missingThicknessHash = hashArchitectureInteriorWorkspaceV2(missingThickness); missingThickness.contentHash = missingThicknessHash; missingThickness.workspace.contentHash = missingThicknessHash;
    expect(buildArchitectureInteriorExactGeometryRequest(missingThickness)).toMatchObject({ ok: false, code: 'ceiling_thickness_missing' });
    const unsupportedInterior = fixture();
    expect(buildArchitectureInteriorExactGeometryRequest(unsupportedInterior).ok).toBe(true);
    await expect(executeArchitectureInteriorExactTransaction(input(unsupportedInterior, { interiorAdapter: adapter({ identity: { backend: 'occt-node', kernel: 'opencascade.js', realKernel: true, version: '', buildSha256: '1'.repeat(64), wasmSha256: '2'.repeat(64) } }) }))).resolves.toMatchObject({ committed: false, code: 'interior_exact_geometry_unsupported' });
  });

  it('requires explicit approval and rejects stale caller revisions without mutation', async () => {
    const before = fixture();
    const noApproval = await executeArchitectureInteriorExactTransaction(input(before, { approval: undefined }));
    expect(noApproval).toMatchObject({ committed: false, code: 'approval_required' });
    const stale = await executeArchitectureInteriorExactTransaction(input(before, { expectedWorkspaceRevision: 99 }));
    expect(stale).toMatchObject({ committed: false, code: 'stale_workspace_revision' });
    expect(before.workspace.track).toBe('ai_design');
  });

  it('fails closed on kernel failure and preserves the original workspace', async () => {
    const before = fixture();
    const result = await executeArchitectureInteriorExactTransaction(input(before, { adapter: adapter({ identity: { backend: 'occt-node', kernel: 'opencascade.js', realKernel: true, version: '', buildSha256: 'b'.repeat(64), wasmSha256: 'c'.repeat(64) } }) }));
    expect(result).toMatchObject({ committed: false, code: 'kernel_blocked' });
    expect(result.workspace).toBe(before);
  });

  it('atomically promotes exact evidence, preserves identity/frames, and binds current model artifacts', async () => {
    const before = fixture();
    const identity = before.coordinates.map(frame => `${frame.id}:${frame.objectId ?? ''}`).sort();
    const result = await executeArchitectureInteriorExactTransaction(input(before));
    expect(result.committed).toBe(true);
    if (!result.committed) return;
    expect(result.workspace.workspace).toMatchObject({ revision: 2, track: 'precision_cad', maturity: 'exact' });
    expect(result.workspace.coordinates.map(frame => `${frame.id}:${frame.objectId ?? ''}`).sort()).toEqual(identity);
    expect(result.workspace.architecture.geometry.fidelity).toBe('exact_brep');
    expect(result.workspace.interior.geometry.fidelity).toBe('exact_brep');
    expect(result.workspace.artifactGraph.artifacts.find(artifact => artifact.contentHash === result.workspace.architecture.geometry.contentHash && artifact.state === 'current')).toBeTruthy();
    expect(result.workspace.artifactGraph.artifacts.find(artifact => artifact.contentHash === result.workspace.interior.geometry.contentHash && artifact.state === 'current')).toBeTruthy();
    expect(result.workspace.artifactGraph.artifacts.find(artifact => artifact.id === 'model-old')?.state).toBe('stale');
    expect(validateArchitectureInteriorWorkspaceV2(result.workspace)).toEqual([]);
    expect(result.receipt.binding.documentHash).toBe(hashArchitectureInteriorEvidenceV2({ ...before.architecture.document, revision: 2 }));
  });

  it('promotes a vertical slab service opening through the analytic cylinder path and binds its host provenance', async () => {
    const before = serviceFixture();
    const result = await executeArchitectureInteriorExactTransaction(input(before, { adapter: adapter({ buildRoundCylinderAt: async () => ({ ok: true, shape: shape('service-cutter'), warnings: ['analytic-cylinder'] }) }) }));
    expect(result.committed).toBe(true);
    if (!result.committed) return;
    expect(result.receipt.serviceOpenings).toMatchObject([{ openingId: 'svc-1', hostId: 'sl', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', structuralApprovalId: 'approval-ref-1', hostShapeHash: expect.any(String), hostStepSha256: expect.any(String), bindingHash: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    const bundle = buildArchitectureInteriorExactGeometryRequest(before, { targetRevision: 2 });
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;
    const missing = structuredClone(result.receipt); missing.serviceOpenings = [];
    expect(validateServiceOpeningReceipts(missing, bundle.bundle)).toBe(false);
    const tamperedId = structuredClone(result.receipt); tamperedId.serviceOpenings![0]!.openingId = 'other-opening';
    expect(validateServiceOpeningReceipts(tamperedId, bundle.bundle)).toBe(false);
    const tamperedBinding = structuredClone(result.receipt); tamperedBinding.serviceOpenings![0]!.bindingHash = 'f'.repeat(64);
    expect(validateServiceOpeningReceipts(tamperedBinding, bundle.bundle)).toBe(false);
  });

  it('rejects tampered current evidence before invoking the kernel', async () => {
    const tampered = fixture();
    const tamperedWall = tampered.architecture.document.walls[0];
    if (tamperedWall?.kind === 'line') tamperedWall.startMm = [99, 99];
    const calls = { count: 0 };
    const result = await executeArchitectureInteriorExactTransaction(input(tampered, { adapter: adapter({ buildPrismAt: async () => { calls.count++; return { ok: true, shape: shape('never'), warnings: [] }; } }) }));
    expect(result.committed).toBe(false);
    if (result.committed) throw new Error('tampered workspace unexpectedly committed');
    expect(result.code).toBe('invalid_workspace');
    expect(calls.count).toBe(0);
  });

  it('does not silently stale a locked dependency even when a generic approval is present', async () => {
    const before = fixture();
    before.artifactGraph.artifacts.push({ id: 'drawing-lock', kind: 'drawing', revision: 1, contentHash: 'a'.repeat(64), state: 'current', inputs: [{ artifactId: 'model-old', revision: 1, contentHash: 'c'.repeat(64) }], verification: { status: 'passed', verifierId: 'seed', evidenceHash: 'b'.repeat(64), issues: [] }, staleBecause: [] });
    before.artifactGraph.dependencies.push({ id: 'lock-model-drawing', sourceId: 'model-old', targetId: 'drawing-lock', policy: 'locked' });
    const hash = hashArchitectureInteriorWorkspaceV2(before); before.contentHash = hash; before.workspace.contentHash = hash;
    const result = await executeArchitectureInteriorExactTransaction(input(before));
    expect(result).toMatchObject({ committed: false, code: 'locked_artifact_requires_approval' });
  });

  it('requires field measurements to be explicitly rebound to the target revision', async () => {
    const before = fixture();
    before.interior.document.fieldMeasurement = { sourceRef: 'survey-1', measuredAt: '2026-08-21T00:00:00Z', architectureRevision: 1, toleranceMm: 1 };
    const hash = hashArchitectureInteriorWorkspaceV2(before); before.contentHash = hash; before.workspace.contentHash = hash;
    const result = await executeArchitectureInteriorExactTransaction(input(before));
    expect(result).toMatchObject({ committed: false, code: 'field_measurement_rebind_required' });
  });
});
