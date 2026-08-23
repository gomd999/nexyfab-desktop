import {
  validateArchitectureDocument,
  validateInteriorDocument,
  type ArchitectureCeiling,
  type ArchitectureDocument,
  type InteriorDocument,
} from './architectureInteriorDocuments';
import {
  ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION,
  generateArchitectureExactGeometry,
  hashExactServiceOpeningBinding,
  type ArchitectureExactGeometryRequest,
  type ArchitectureExactGeometryReceipt,
  type ArchitectureExactKernelAdapter,
  type ExactServiceOpening,
  type ExactHostedOpening,
} from './architectureInteriorExactGeometry';
import {
  INTERIOR_EXACT_GEOMETRY_CONTRACT_VERSION,
  buildInteriorExactGeometryRequest,
  generateInteriorExactGeometry,
  type InteriorExactGeometryReceipt,
} from './interiorExactGeometry';
import {
  hashArchitectureInteriorEvidenceV2,
  hashArchitectureInteriorWorkspaceV2,
  validateArchitectureInteriorWorkspaceV2,
  type ArchitectureInteriorWorkspaceV2,
  type WorkspaceDomainEnvelopeV2,
  type WorkspaceProvenanceV2,
} from './architectureInteriorWorkspace';
import type { DesignArtifactNode } from './designArtifactGraph';

const SHA256 = /^[a-f0-9]{64}$/;

export type ExactRequestBuildCode =
  | 'invalid_workspace'
  | 'document_validation_failed'
  | 'stale_document_revision'
  | 'architecture_document_binding_mismatch'
  | 'ceiling_thickness_missing'
  | 'interior_exact_geometry_unsupported';

export type ArchitectureInteriorExactRequestBundle = {
  request: ArchitectureExactGeometryRequest;
  targetDocuments: { architecture: ArchitectureDocument; interior: InteriorDocument };
  documentHashes: { architecture: string; interior: string };
  sourceBindings: {
    projectId: string;
    baseRevision: number;
    targetRevision: number;
    architectureDocumentId: string;
    interiorDocumentId: string;
  };
};

export type ExactRequestBuildResult =
  | { ok: true; bundle: ArchitectureInteriorExactRequestBundle }
  | { ok: false; code: ExactRequestBuildCode; details: string[] };

export type ExactTransactionCode =
  | ExactRequestBuildCode
  | 'exact_track_required'
  | 'concept_maturity_required'
  | 'approval_required'
  | 'locked_artifact_requires_approval'
  | 'field_measurement_rebind_required'
  | 'stale_workspace_revision'
  | 'kernel_blocked'
  | 'receipt_binding_failed'
  | 'artifact_transaction_failed'
  | 'validation_failed';

export type ExactTransactionApproval = {
  approved: true;
  approvalId: string;
  actorId: string;
  baseRevision: number;
  scope: 'architecture-interior-exact';
};

export type ArchitectureInteriorExactTransactionInput = {
  workspace: ArchitectureInteriorWorkspaceV2;
  adapter: ArchitectureExactKernelAdapter;
  /** Optional separate server-side adapter; defaults to the injected exact adapter. */
  interiorAdapter?: ArchitectureExactKernelAdapter;
  approval?: ExactTransactionApproval;
  expectedWorkspaceRevision?: number;
  actorSource?: 'user' | 'ai' | 'import' | 'catalog' | 'expert';
};

export type ExactTransactionResult =
  | { committed: true; workspace: ArchitectureInteriorWorkspaceV2; receipt: ArchitectureExactGeometryReceipt; commandHash: string; artifactId: string }
  | { committed: false; workspace: ArchitectureInteriorWorkspaceV2; code: ExactTransactionCode; details?: string[] };

function noPathOrUrl(value: unknown, seen = new Set<object>(), key?: string): boolean {
  if (key && /^(?:path|url|secret|credential|password|token|provider)$/i.test(key)) return false;
  if (typeof value === 'string') return !(/(?:^|[\\/])(?:[A-Za-z]:)?[\\/]/.test(value) || /^(?:https?|file|data):/i.test(value) || /(?:bearer|password|secret|token|api[_-]?key)\s*[:=]/i.test(value));
  if (!value || typeof value !== 'object') return true;
  // Shared immutable references are allowed; only an active recursion cycle is
  // unsafe. Remove the node after traversing it so repeated references do not
  // look like a path/secret violation.
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every(item => noPathOrUrl(item, seen))
    : Object.entries(value).every(([entryKey, item]) => noPathOrUrl(item, seen, entryKey));
  seen.delete(value);
  return valid;
}

function fail(code: ExactRequestBuildCode, ...details: string[]): ExactRequestBuildResult { return { ok: false, code, details }; }

function ceilingThickness(ceiling: ArchitectureCeiling): number | undefined {
  const candidate = ceiling.thicknessMm;
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0 ? candidate : undefined;
}

function hostedOpening(opening: ArchitectureDocument['openings'][number]): ExactHostedOpening {
  return { id: opening.id, kind: opening.kind, hostWallId: opening.hostWallId, offsetMm: opening.offsetMm, widthMm: opening.widthMm, heightMm: opening.heightMm, sillMm: opening.sillMm };
}

function serviceOpening(opening: NonNullable<ArchitectureDocument['serviceOpenings']>[number]): ExactServiceOpening {
  return { id: opening.id, hostId: opening.hostId, sourceRouteId: opening.sourceRouteId, sourceSleeveId: opening.sourceSleeveId, centerMm: opening.centerMm, axis: opening.axis, cutDiameterMm: opening.cutDiameterMm, depthMm: opening.depthMm, firestopAnnulusMm: opening.firestopAnnulusMm, ...(opening.structuralApprovalId !== undefined ? { structuralApprovalId: opening.structuralApprovalId } : {}) };
}

/** Build exact input from the current bound documents only. No caller geometry is accepted. */
export function buildArchitectureInteriorExactGeometryRequest(workspace: ArchitectureInteriorWorkspaceV2, options: { targetRevision?: number } = {}): ExactRequestBuildResult {
  if (!noPathOrUrl(workspace)) return fail('invalid_workspace', 'path_url_or_secret_input_forbidden');
  const workspaceIssues = validateArchitectureInteriorWorkspaceV2(workspace);
  if (workspaceIssues.length) return fail('invalid_workspace', ...workspaceIssues);
  const architecture = workspace.architecture.document;
  const interior = workspace.interior.document;
  const architectureIssues = validateArchitectureDocument(architecture);
  const interiorIssues = validateInteriorDocument(interior, architecture);
  if (architectureIssues.length || interiorIssues.length) return fail('document_validation_failed', ...architectureIssues, ...interiorIssues);
  if (architecture.revision !== workspace.workspace.revision || interior.revision !== workspace.workspace.revision) return fail('stale_document_revision');
  if (interior.architectureDocumentId !== workspace.architecture.documentId) return fail('architecture_document_binding_mismatch');
  const baseRevision = workspace.workspace.revision;
  const targetRevision = options.targetRevision ?? baseRevision;
  if (!Number.isSafeInteger(targetRevision) || targetRevision < baseRevision) return fail('stale_document_revision');
  const targetArchitecture = { ...structuredClone(architecture), revision: targetRevision };
  const targetInterior = { ...structuredClone(interior), revision: targetRevision };
  const targetArchitectureIssues = validateArchitectureDocument(targetArchitecture);
  const targetInteriorIssues = validateInteriorDocument(targetInterior, targetArchitecture);
  if (targetArchitectureIssues.length || targetInteriorIssues.length) return fail('document_validation_failed', ...targetArchitectureIssues, ...targetInteriorIssues);
  const architectureHash = hashArchitectureInteriorEvidenceV2(targetArchitecture);
  const interiorHash = hashArchitectureInteriorEvidenceV2(targetInterior);
  const storeys = new Map(targetArchitecture.storeys.map(storey => [storey.id, storey]));
  try {
    const ceilings = targetArchitecture.ceilings.map(ceiling => {
      const thicknessMm = ceilingThickness(ceiling);
      if (thicknessMm === undefined) throw new Error(`ceiling_thickness_missing:${ceiling.id}`);
      return { id: ceiling.id, boundaryMm: ceiling.boundaryMm, elevationMm: ceiling.elevationMm, thicknessMm };
    });
    const request: ArchitectureExactGeometryRequest = {
      contractVersion: ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION,
      units: 'mm',
      binding: { projectId: workspace.projectId, revision: targetRevision, documentId: workspace.architecture.documentId, documentHash: architectureHash },
      toleranceMm: 0.1,
      walls: targetArchitecture.walls.map(wall => {
        const storey = storeys.get(wall.storeyId);
        if (!storey) throw new Error(`stale_storey:${wall.id}`);
        return wall.kind === 'line'
          ? { id: wall.id, kind: 'line' as const, startMm: wall.startMm, endMm: wall.endMm, thicknessMm: wall.thicknessMm, heightMm: wall.heightMm, z0Mm: storey.elevationMm }
          : { id: wall.id, kind: 'arc' as const, centerMm: wall.centerMm, radiusMm: wall.radiusMm, startAngleDeg: wall.startAngleDeg, endAngleDeg: wall.endAngleDeg, thicknessMm: wall.thicknessMm, heightMm: wall.heightMm, z0Mm: storey.elevationMm };
      }),
      slabs: targetArchitecture.slabs.map(slab => {
        const storey = storeys.get(slab.storeyId);
        if (!storey) throw new Error(`stale_storey:${slab.id}`);
        return { id: slab.id, boundaryMm: slab.boundaryMm, z0Mm: storey.elevationMm - slab.thicknessMm, thicknessMm: slab.thicknessMm };
      }),
      ceilings,
      openings: targetArchitecture.openings.map(hostedOpening),
      serviceOpenings: (targetArchitecture.serviceOpenings ?? []).map(serviceOpening),
    };
    return { ok: true, bundle: { request, targetDocuments: { architecture: targetArchitecture, interior: targetInterior }, documentHashes: { architecture: architectureHash, interior: interiorHash }, sourceBindings: { projectId: workspace.projectId, baseRevision, targetRevision, architectureDocumentId: workspace.architecture.documentId, interiorDocumentId: workspace.interior.documentId } } };
  } catch (error) {
    const detail = error instanceof Error ? error.message : '';
    return detail.startsWith('ceiling_thickness_missing:') ? fail('ceiling_thickness_missing') : fail('stale_document_revision');
  }
}

function exactGeometryPayload(receipt: ArchitectureExactGeometryReceipt, documentHash: string): unknown {
  return { schema: 'nexyfab.architecture-exact-brep-evidence.v1', contractVersion: receipt.contractVersion, units: receipt.units, documentHash, receipt };
}

function verification(evidenceHash: string) {
  return { status: 'passed' as const, verifierId: 'architecture-interior-exact-transaction.v1', evidenceHash, issues: [] as string[] };
}

function appendProvenance(existing: readonly WorkspaceProvenanceV2[], commandHash: string, actorSource: NonNullable<ArchitectureInteriorExactTransactionInput['actorSource']>, approval: ExactTransactionApproval): WorkspaceProvenanceV2[] {
  return [...structuredClone(existing), { sourceId: `command:${commandHash}`, kind: actorSource, contentHash: commandHash }, { sourceId: `approval:${approval.approvalId}`, kind: actorSource, contentHash: hashArchitectureInteriorEvidenceV2({ approvalId: approval.approvalId, actorId: approval.actorId, baseRevision: approval.baseRevision, scope: approval.scope }) }];
}

function regenerateDomain<T>(domain: WorkspaceDomainEnvelopeV2<T>, geometryPayload: unknown, geometryContentHash: string, geometryEvidenceHash: string, commandHash: string, actorSource: NonNullable<ArchitectureInteriorExactTransactionInput['actorSource']>, approval: ExactTransactionApproval): WorkspaceDomainEnvelopeV2<T> {
  return { ...structuredClone(domain), geometry: { representation: 'brep', units: 'mm', fidelity: 'exact_brep', verification: verification(geometryEvidenceHash), contentHash: geometryContentHash, payload: geometryPayload }, provenance: appendProvenance(domain.provenance, commandHash, actorSource, approval) };
}

function validateInteriorReceipt(receipt: InteriorExactGeometryReceipt | undefined, bundle: ArchitectureInteriorExactRequestBundle): boolean {
  if (!receipt || receipt.contractVersion !== INTERIOR_EXACT_GEOMETRY_CONTRACT_VERSION || receipt.units !== 'mm' || receipt.exactGeometryProduced !== true || receipt.binding.projectId !== bundle.sourceBindings.projectId || receipt.binding.revision !== bundle.sourceBindings.targetRevision || receipt.binding.interiorDocumentId !== bundle.sourceBindings.interiorDocumentId || receipt.binding.interiorDocumentHash !== bundle.documentHashes.interior || receipt.binding.architectureDocumentId !== bundle.sourceBindings.architectureDocumentId || receipt.binding.architectureRevision !== bundle.sourceBindings.targetRevision || receipt.binding.architectureDocumentHash !== bundle.documentHashes.architecture || !SHA256.test(receipt.contentHash) || !SHA256.test(receipt.evidenceHash)) return false;
  const expectedRequest = buildInteriorExactGeometryRequest({ projectId: bundle.sourceBindings.projectId, revision: bundle.sourceBindings.targetRevision, interiorDocumentId: bundle.sourceBindings.interiorDocumentId, interiorDocument: bundle.targetDocuments.interior, architectureDocumentId: bundle.sourceBindings.architectureDocumentId, architectureRevision: bundle.sourceBindings.targetRevision, architectureDocumentHash: bundle.documentHashes.architecture });
  if (!expectedRequest.ok || expectedRequest.documentHash !== bundle.documentHashes.interior) return false;
  if ([...receipt.sourceObjectIds].sort().join('|') !== [...expectedRequest.request.sourceObjectIds].sort().join('|')) return false;
  if (receipt.classifications.length !== expectedRequest.request.classifications.length || receipt.classifications.some(item => !expectedRequest.request.classifications.some(expected => JSON.stringify(item) === JSON.stringify(expected)))) return false;
  const unsigned = { contractVersion: receipt.contractVersion, units: receipt.units, binding: receipt.binding, kernel: receipt.kernel, toleranceMm: receipt.toleranceMm, abstraction: receipt.abstraction, vendorShapeFidelity: receipt.vendorShapeFidelity, shapes: receipt.shapes, classifications: receipt.classifications, sourceObjectIds: receipt.sourceObjectIds, ...(receipt.emptySolidSetEvidence ? { emptySolidSetEvidence: receipt.emptySolidSetEvidence } : {}), exactGeometryProduced: true as const };
  if (hashArchitectureInteriorEvidenceV2(unsigned) !== receipt.contentHash) return false;
  const evidencePayload = { schema: 'nexyfab.interior-exact-brep-evidence.v1', contentHash: receipt.contentHash, binding: receipt.binding, abstraction: receipt.abstraction, classifications: receipt.classifications, shapes: receipt.shapes.map(({ stepText: _stepText, ...shape }) => shape) };
  return hashArchitectureInteriorEvidenceV2(evidencePayload) === receipt.evidenceHash;
}

export function validateServiceOpeningReceipts(receipt: ArchitectureExactGeometryReceipt, bundle: ArchitectureInteriorExactRequestBundle): boolean {
  const expected = bundle.request.serviceOpenings;
  const serviceReceipts = receipt.serviceOpenings ?? [];
  if (serviceReceipts.length !== expected.length) return false;
  const shapes = new Map(receipt.shapes.map(shape => [shape.elementId, shape]));
  return expected.every(opening => {
    const record = serviceReceipts.find(item => item.openingId === opening.id);
    const hostShape = shapes.get(opening.hostId);
    if (!record || !hostShape || record.hostId !== opening.hostId || record.sourceRouteId !== opening.sourceRouteId || record.sourceSleeveId !== opening.sourceSleeveId || JSON.stringify(record.centerMm) !== JSON.stringify(opening.centerMm) || JSON.stringify(record.axis) !== JSON.stringify(opening.axis) || record.cutDiameterMm !== opening.cutDiameterMm || record.depthMm !== opening.depthMm || record.firestopAnnulusMm !== opening.firestopAnnulusMm || (record.structuralApprovalId ?? undefined) !== (opening.structuralApprovalId ?? undefined) || record.hostShapeHash !== hostShape.shapeHash || record.hostStepSha256 !== hostShape.stepSha256 || !SHA256.test(record.bindingHash)) return false;
    return record.bindingHash === hashExactServiceOpeningBinding(bundle.request, opening, hostShape);
  });
}

function invalidateArtifacts(workspace: ArchitectureInteriorWorkspaceV2, commandHash: string): ArchitectureInteriorWorkspaceV2['artifactGraph'] {
  return { ...structuredClone(workspace.artifactGraph), revision: workspace.workspace.revision + 1, artifacts: workspace.artifactGraph.artifacts.map(artifact => ({ ...structuredClone(artifact), state: 'stale' as const, verification: { ...structuredClone(artifact.verification), status: 'not_run' as const, evidenceHash: undefined, issues: ['exact_geometry_changed'] }, staleBecause: [...new Set([...artifact.staleBecause, commandHash])] })) };
}

function modelArtifact(id: string, revision: number, contentHash: string, evidenceHash: string): DesignArtifactNode {
  return { id, kind: 'model', revision, contentHash, state: 'current', inputs: [], verification: verification(evidenceHash), staleBecause: [] };
}

/** Atomically promote a validated concept workspace to precision exact geometry. */
export async function executeArchitectureInteriorExactTransaction(input: ArchitectureInteriorExactTransactionInput): Promise<ExactTransactionResult> {
  const original = input.workspace;
  if (validateArchitectureInteriorWorkspaceV2(original).length) return { committed: false, workspace: original, code: 'invalid_workspace' };
  if (original.workspace.track !== 'ai_design') return { committed: false, workspace: original, code: 'exact_track_required' };
  if (original.workspace.maturity !== 'concept') return { committed: false, workspace: original, code: 'concept_maturity_required' };
  if (!input.approval || input.approval.approved !== true || !input.approval.approvalId.trim() || !input.approval.actorId.trim() || input.approval.scope !== 'architecture-interior-exact' || input.approval.baseRevision !== original.workspace.revision) return { committed: false, workspace: original, code: 'approval_required' };
  if (input.expectedWorkspaceRevision !== undefined && input.expectedWorkspaceRevision !== original.workspace.revision) return { committed: false, workspace: original, code: 'stale_workspace_revision' };
  if (original.artifactGraph.dependencies.some(dependency => dependency.policy === 'locked')) return { committed: false, workspace: original, code: 'locked_artifact_requires_approval' };
  const built = buildArchitectureInteriorExactGeometryRequest(original, { targetRevision: original.workspace.revision + 1 });
  if (!built.ok) return { committed: false, workspace: original, code: built.code, details: built.details };
  if (built.bundle.targetDocuments.interior.fieldMeasurement && built.bundle.targetDocuments.interior.fieldMeasurement.architectureRevision !== built.bundle.sourceBindings.targetRevision) return { committed: false, workspace: original, code: 'field_measurement_rebind_required', details: ['field_measurement_revision_mismatch'] };
  const interiorBuilt = buildInteriorExactGeometryRequest({ projectId: built.bundle.sourceBindings.projectId, revision: built.bundle.sourceBindings.targetRevision, interiorDocumentId: built.bundle.sourceBindings.interiorDocumentId, interiorDocument: built.bundle.targetDocuments.interior, architectureDocumentId: built.bundle.sourceBindings.architectureDocumentId, architectureRevision: built.bundle.sourceBindings.targetRevision, architectureDocumentHash: built.bundle.documentHashes.architecture });
  if (!interiorBuilt.ok) return { committed: false, workspace: original, code: 'interior_exact_geometry_unsupported', details: ['interior_request_unavailable'] };
  let interiorGenerated: Awaited<ReturnType<typeof generateInteriorExactGeometry>>;
  try { interiorGenerated = await generateInteriorExactGeometry(interiorBuilt.request, input.interiorAdapter ?? input.adapter); } catch { return { committed: false, workspace: original, code: 'interior_exact_geometry_unsupported', details: ['interior_kernel_operation_failed'] }; }
  if (!interiorGenerated.ok) return { committed: false, workspace: original, code: 'interior_exact_geometry_unsupported', details: ['interior_exact_verification_failed'] };
  const interiorReceipt = interiorGenerated.receipt;
  if (!validateInteriorReceipt(interiorReceipt, built.bundle) || !noPathOrUrl(interiorReceipt)) return { committed: false, workspace: original, code: 'interior_exact_geometry_unsupported', details: ['interior_receipt_binding_failed'] };
  const actorSource = input.actorSource ?? 'expert';
  const commandHash = hashArchitectureInteriorEvidenceV2({ schema: 'nexyfab.architecture-interior-exact-command.v1', baseContentHash: original.contentHash, baseRevision: original.workspace.revision, architectureRequest: built.bundle.request, interiorRequest: interiorBuilt.request, documentHashes: built.bundle.documentHashes, approval: input.approval, actorSource });
  let generated: Awaited<ReturnType<typeof generateArchitectureExactGeometry>>;
  try { generated = await generateArchitectureExactGeometry(built.bundle.request, input.adapter); } catch { return { committed: false, workspace: original, code: 'kernel_blocked', details: ['kernel_operation_failed'] }; }
  if (!generated.ok) return { committed: false, workspace: original, code: 'kernel_blocked', details: [generated.code] };
  const receipt = generated.receipt;
  const expectedElementIds = [...built.bundle.request.walls, ...built.bundle.request.slabs, ...built.bundle.request.ceilings].map(item => item.id).sort();
  const actualElementIds = receipt.shapes.map(item => item.elementId).sort();
  if (receipt.binding.projectId !== built.bundle.sourceBindings.projectId || receipt.binding.revision !== built.bundle.sourceBindings.targetRevision || receipt.binding.documentId !== built.bundle.sourceBindings.architectureDocumentId || receipt.binding.documentHash !== built.bundle.documentHashes.architecture || !SHA256.test(receipt.contentHash) || !receipt.exactGeometryProduced || receipt.shapes.length === 0 || expectedElementIds.join('|') !== actualElementIds.join('|') || !validateServiceOpeningReceipts(receipt, built.bundle)) return { committed: false, workspace: original, code: 'receipt_binding_failed' };
  try {
    const architecturePayload = exactGeometryPayload(receipt, built.bundle.documentHashes.architecture);
    const interiorPayload = { schema: 'nexyfab.interior-exact-brep-evidence.v1', sourceDocumentHash: built.bundle.documentHashes.interior, architectureReceiptHash: receipt.contentHash, receipt: interiorReceipt };
    const architectureGeometryHash = hashArchitectureInteriorEvidenceV2(architecturePayload);
    const interiorGeometryHash = hashArchitectureInteriorEvidenceV2(interiorPayload);
    const candidate = structuredClone(original);
    const nextRevision = built.bundle.sourceBindings.targetRevision;
    candidate.workspace = { ...candidate.workspace, revision: nextRevision, track: 'precision_cad', maturity: 'exact' };
    const nextArchitectureDocument = built.bundle.targetDocuments.architecture;
    const nextInteriorDocument = built.bundle.targetDocuments.interior;
    candidate.architecture = regenerateDomain({ ...original.architecture, document: nextArchitectureDocument }, architecturePayload, architectureGeometryHash, receipt.contentHash, commandHash, actorSource, input.approval);
    candidate.interior = regenerateDomain({ ...original.interior, document: nextInteriorDocument }, interiorPayload, interiorGeometryHash, interiorReceipt.evidenceHash, commandHash, actorSource, input.approval);
    const architectureSemantic = { schema: `${nextArchitectureDocument.schema}.semantic.v2`, document: structuredClone(nextArchitectureDocument) };
    const interiorSemantic = { schema: `${nextInteriorDocument.schema}.semantic.v2`, document: structuredClone(nextInteriorDocument) };
    candidate.architecture.semantic = { schema: architectureSemantic.schema, contentHash: hashArchitectureInteriorEvidenceV2(architectureSemantic), payload: architectureSemantic };
    candidate.interior.semantic = { schema: interiorSemantic.schema, contentHash: hashArchitectureInteriorEvidenceV2(interiorSemantic), payload: interiorSemantic };
    candidate.artifactGraph = invalidateArtifacts(original, commandHash);
    const architectureArtifact = modelArtifact(`model:architecture-brep:${nextRevision}`, nextRevision, architectureGeometryHash, hashArchitectureInteriorEvidenceV2(receipt));
    const interiorArtifact = modelArtifact(`model:interior-brep:${nextRevision}`, nextRevision, interiorGeometryHash, interiorReceipt.evidenceHash);
    candidate.artifactGraph.artifacts.push(architectureArtifact, interiorArtifact);
    candidate.contentHash = '';
    candidate.workspace.contentHash = '';
    const contentHash = hashArchitectureInteriorWorkspaceV2(candidate);
    candidate.contentHash = contentHash;
    candidate.workspace.contentHash = contentHash;
    const issues = validateArchitectureInteriorWorkspaceV2(candidate);
    if (issues.length) return { committed: false, workspace: original, code: 'validation_failed', details: issues };
    return { committed: true, workspace: candidate, receipt, commandHash, artifactId: architectureArtifact.id };
  } catch {
    return { committed: false, workspace: original, code: 'artifact_transaction_failed', details: ['transaction_failed'] };
  }
}
