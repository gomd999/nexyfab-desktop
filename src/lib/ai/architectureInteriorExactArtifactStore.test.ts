import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./architectureInteriorWorkspace', async () => {
  const actual = await vi.importActual<typeof import('./architectureInteriorWorkspace')>('./architectureInteriorWorkspace');
  return { ...actual, validateArchitectureInteriorWorkspaceV2: vi.fn(() => []), hashArchitectureInteriorWorkspaceV2: vi.fn(() => 'b'.repeat(64)) };
});

import { hashArchitectureInteriorEvidenceV2, type ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import { buildArchitectureInteriorExactArtifactBundle, compactArchitectureInteriorExactWorkspace, persistArchitectureInteriorExactArtifact } from './architectureInteriorExactArtifactStore';

const text = 'ISO-10303-21;\nMANIFOLD_SOLID_BREP;\nEND-ISO-10303-21;';
const stepHash = createHash('sha256').update(text).digest('hex');
const shape = (elementId: string, kind: 'wall' | 'slab' | 'ceiling' = 'wall') => ({ elementId, kind, shapeHash: stepHash, stepSha256: stepHash, stepBytes: Buffer.byteLength(text), stepText: text, closedSolid: true as const, verification: { valid: true as const, solidCount: 1, faceCount: 6, edgeCount: 12, toleranceMm: 0.1, toleranceVerified: true } });
const binding = { projectId: 'project-1', revision: 2, architectureDocumentId: 'architecture-1', interiorDocumentId: 'interior-1', architectureDocumentHash: 'a'.repeat(64), interiorDocumentHash: 'b'.repeat(64) };
const architectureReceipt = { contractVersion: 'nexyfab.architecture-exact-geometry.v1' as const, units: 'mm' as const, binding: { projectId: 'project-1', revision: 2, documentId: 'architecture-1', documentHash: binding.architectureDocumentHash }, kernel: { backend: 'occt-node' as const, kernel: 'opencascade.js' as const, realKernel: true as const, version: '1', buildSha256: 'c'.repeat(64), wasmSha256: 'd'.repeat(64) }, toleranceMm: 0.1, shapes: [shape('wall-1'), shape('slab-1', 'slab'), shape('ceiling-1', 'ceiling')], serviceOpenings: [] as Array<{ openingId: string; hostId: string; sourceRouteId: string; sourceSleeveId: string; centerMm: [number, number, number]; axis: [number, number, number]; cutDiameterMm: number; depthMm: number; firestopAnnulusMm: number; structuralApprovalId?: string; hostShapeHash: string; hostStepSha256: string; bindingHash: string }>, contentHash: '', exactGeometryProduced: true as const };
architectureReceipt.contentHash = hashArchitectureInteriorEvidenceV2({ binding: architectureReceipt.binding, units: architectureReceipt.units, toleranceMm: architectureReceipt.toleranceMm, shapes: architectureReceipt.shapes.map(({ elementId, kind, shapeHash, stepSha256, stepBytes }) => ({ elementId, kind, shapeHash, stepSha256, stepBytes })), serviceOpenings: architectureReceipt.serviceOpenings });
const interiorBase = { contractVersion: 'nexyfab.interior-exact-geometry.v1' as const, units: 'mm' as const, binding: { projectId: 'project-1', revision: 2, interiorDocumentId: 'interior-1', interiorDocumentHash: binding.interiorDocumentHash, architectureDocumentId: 'architecture-1', architectureRevision: 2, architectureDocumentHash: binding.architectureDocumentHash }, kernel: architectureReceipt.kernel, toleranceMm: 0.1, abstraction: 'clearance_envelope_box_brep' as const, vendorShapeFidelity: 'not_claimed' as const, classifications: [{ id: 'light-1', kind: 'light' as const, representation: 'semantic_host_bound' as const, hostId: 'ceiling-1', abstraction: 'semantic_non_solid' as const }], shapes: [], sourceObjectIds: ['light-1'], exactGeometryProduced: true as const };
const interiorReceipt = { ...interiorBase, contentHash: '', evidenceHash: '' };
interiorReceipt.contentHash = hashArchitectureInteriorEvidenceV2(interiorBase);
interiorReceipt.evidenceHash = hashArchitectureInteriorEvidenceV2({ schema: 'nexyfab.interior-exact-brep-evidence.v1', contentHash: interiorReceipt.contentHash, binding: interiorReceipt.binding, abstraction: interiorReceipt.abstraction, classifications: interiorReceipt.classifications, shapes: [] });
const workspace = { projectId: 'project-1', workspace: { revision: 2 }, architecture: { documentId: 'architecture-1', document: { schema: 'nexyfab.architecture.v1', revision: 2 }, geometry: { payload: {} } }, interior: { documentId: 'interior-1', document: { schema: 'nexyfab.interior.v1', revision: 2 }, geometry: { payload: { receipt: interiorReceipt } } }, artifactGraph: { artifacts: [{ id: 'model:architecture-brep:2', contentHash: 'x'.repeat(64) }, { id: 'model:interior-brep:2', contentHash: 'y'.repeat(64) }] } } as unknown as ArchitectureInteriorWorkspaceV2;
const architectureDocumentHash = hashArchitectureInteriorEvidenceV2(workspace.architecture.document);
const interiorDocumentHash = hashArchitectureInteriorEvidenceV2(workspace.interior.document);
architectureReceipt.binding.documentHash = architectureDocumentHash;
architectureReceipt.contentHash = hashArchitectureInteriorEvidenceV2({ binding: architectureReceipt.binding, units: architectureReceipt.units, toleranceMm: architectureReceipt.toleranceMm, shapes: architectureReceipt.shapes.map(({ elementId, kind, shapeHash, stepSha256, stepBytes }) => ({ elementId, kind, shapeHash, stepSha256, stepBytes })), serviceOpenings: architectureReceipt.serviceOpenings });
interiorReceipt.binding.architectureDocumentHash = architectureDocumentHash;
interiorReceipt.binding.interiorDocumentHash = interiorDocumentHash;
interiorReceipt.contentHash = hashArchitectureInteriorEvidenceV2({ ...interiorBase, binding: interiorReceipt.binding });
interiorReceipt.evidenceHash = hashArchitectureInteriorEvidenceV2({ schema: 'nexyfab.interior-exact-brep-evidence.v1', contentHash: interiorReceipt.contentHash, binding: interiorReceipt.binding, abstraction: interiorReceipt.abstraction, classifications: interiorReceipt.classifications, shapes: [] });

describe('exact artifact externalization', () => {
  it('builds a full immutable bundle and rejects tampered STEP bytes', () => {
    const built = buildArchitectureInteriorExactArtifactBundle(workspace, architectureReceipt);
    expect(built.ok).toBe(true);
    const tampered = structuredClone(architectureReceipt); tampered.shapes[0]!.stepText += 'tampered';
    expect(buildArchitectureInteriorExactArtifactBundle(workspace, tampered).ok).toBe(false);
  });

  it('binds service-opening receipts to semantic openings and final host STEP hashes', () => {
    const unexpected = structuredClone(architectureReceipt);
    unexpected.serviceOpenings = [{ openingId: 'service-opening-1', hostId: 'slab-1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', centerMm: [500, 500, 0], axis: [0, 0, 1], cutDiameterMm: 100, depthMm: 250, firestopAnnulusMm: 20, hostShapeHash: stepHash, hostStepSha256: stepHash, bindingHash: 'e'.repeat(64) }];
    unexpected.contentHash = hashArchitectureInteriorEvidenceV2({ binding: unexpected.binding, units: unexpected.units, toleranceMm: unexpected.toleranceMm, shapes: unexpected.shapes.map(({ elementId, kind, shapeHash, stepSha256, stepBytes }) => ({ elementId, kind, shapeHash, stepSha256, stepBytes })), serviceOpenings: unexpected.serviceOpenings });
    expect(buildArchitectureInteriorExactArtifactBundle(workspace, unexpected)).toMatchObject({ ok: false, issues: expect.arrayContaining(['architecture_service_opening_receipt_count_mismatch']) });

    const semanticWorkspace = structuredClone(workspace);
    semanticWorkspace.architecture.document.serviceOpenings = [{ id: 'service-opening-1', hostId: 'slab-1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', shape: 'round', centerMm: [500, 500, 0], axis: [0, 0, 1], cutDiameterMm: 100, depthMm: 250, firestopAnnulusMm: 20 }];
    expect(buildArchitectureInteriorExactArtifactBundle(semanticWorkspace, architectureReceipt)).toMatchObject({ ok: false, issues: expect.arrayContaining(['architecture_service_opening_receipt_count_mismatch']) });
  });

  it('compacts the workspace to hash-bound references without STEP text', () => {
    const built = buildArchitectureInteriorExactArtifactBundle(workspace, architectureReceipt);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const compacted = compactArchitectureInteriorExactWorkspace(workspace, { schema: 'nexyfab.architecture-interior-exact-artifact-reference.v1', manifestId: 'manifest-1', projectId: 'project-1', revision: 2, bundleHash: built.bundle.bundleHash, byteLength: built.bytes.length, architecture: { receiptContentHash: architectureReceipt.contentHash, receiptEvidenceHash: hashArchitectureInteriorEvidenceV2(architectureReceipt), shapeCount: 3, stepBytes: text.length * 3 }, interior: { receiptContentHash: interiorReceipt.contentHash, receiptEvidenceHash: interiorReceipt.evidenceHash, shapeCount: 0, stepBytes: 0 } });
    expect(JSON.stringify(compacted)).not.toContain('ISO-10303-21');
    expect(compacted.interior.geometry.payload).toMatchObject({ reference: { manifestId: 'manifest-1' } });
  });

  it('rejects unsafe tenant scope before uploading', async () => {
    const upload = vi.fn();
    const result = await persistArchitectureInteriorExactArtifact({ db: {} as never, storage: { uploadPrivate: upload } as never, owner: { tenantId: 'org/unsafe', userId: 'user-1' }, workspace, architectureReceipt });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ARTIFACT' });
    expect(upload).not.toHaveBeenCalled();
  });
});
