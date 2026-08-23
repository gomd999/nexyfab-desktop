import { createHash, randomUUID } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import type { StorageAdapter } from '@/lib/storage';
import {
  ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION,
  hashExactServiceOpeningBindingForBinding,
  type ArchitectureExactGeometryReceipt,
} from './architectureInteriorExactGeometry';
import {
  INTERIOR_EXACT_GEOMETRY_CONTRACT_VERSION,
  type InteriorExactGeometryReceipt,
} from './interiorExactGeometry';
import {
  hashArchitectureInteriorEvidenceV2,
  hashArchitectureInteriorWorkspaceV2,
  validateArchitectureInteriorWorkspaceV2,
  type ArchitectureInteriorWorkspaceV2,
} from './architectureInteriorWorkspace';
import type { ArchitectureServiceOpening } from './architectureInteriorDocuments';

export const ARCHITECTURE_INTERIOR_EXACT_ARTIFACT_STORE_SCHEMA = 'nexyfab.architecture-interior-exact-artifact-store.v1' as const;
export const ARCHITECTURE_INTERIOR_EXACT_ARTIFACT_BUNDLE_SCHEMA = 'nexyfab.architecture-interior-exact-artifact-bundle.v1' as const;
export const ARCHITECTURE_INTERIOR_EXACT_ARTIFACT_REFERENCE_SCHEMA = 'nexyfab.architecture-interior-exact-artifact-reference.v1' as const;
export const ARCHITECTURE_INTERIOR_EXACT_ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;
const MAX_STEP_BYTES_PER_SHAPE = 64 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type ArchitectureInteriorExactArtifactReference = {
  schema: typeof ARCHITECTURE_INTERIOR_EXACT_ARTIFACT_REFERENCE_SCHEMA;
  manifestId: string;
  projectId: string;
  revision: number;
  bundleHash: string;
  byteLength: number;
  architecture: { receiptContentHash: string; receiptEvidenceHash: string; shapeCount: number; stepBytes: number };
  interior: { receiptContentHash: string; receiptEvidenceHash: string; shapeCount: number; stepBytes: number };
};

export type ArchitectureInteriorExactArtifactBundle = {
  schema: typeof ARCHITECTURE_INTERIOR_EXACT_ARTIFACT_BUNDLE_SCHEMA;
  binding: { projectId: string; revision: number; architectureDocumentId: string; interiorDocumentId: string; architectureDocumentHash: string; interiorDocumentHash: string };
  architectureReceipt: ArchitectureExactGeometryReceipt;
  interiorReceipt: InteriorExactGeometryReceipt;
  receiptHashes: { architectureContentHash: string; architectureEvidenceHash: string; interiorContentHash: string; interiorEvidenceHash: string };
  bundleHash: string;
};

export type ExactArtifactOwner = { tenantId: string; userId: string };
export type PersistExactArtifactResult =
  | { ok: true; reference: ArchitectureInteriorExactArtifactReference }
  | { ok: false; code: 'INVALID_ARTIFACT' | 'STORAGE_UNAVAILABLE' | 'MANIFEST_PERSIST_FAILED'; issues: string[] };
export type ReadExactArtifactResult =
  | { ok: true; reference: ArchitectureInteriorExactArtifactReference }
  | { ok: false; code: 'NOT_FOUND' | 'CORRUPT_ARTIFACT' | 'TENANT_MISMATCH'; issues: string[] };

function sha256(value: Buffer | string): string { return createHash('sha256').update(value).digest('hex'); }
function stableJson(value: unknown): string { return JSON.stringify(value); }
function safeScope(value: string): boolean { return SAFE_ID.test(value) && !value.includes('..'); }
function stepBytes(value: { stepText: string; stepBytes: number; stepSha256: string; shapeHash: string }): number {
  const actual = Buffer.byteLength(value.stepText, 'utf8');
  if (!Number.isSafeInteger(value.stepBytes) || value.stepBytes !== actual || actual <= 0 || actual > MAX_STEP_BYTES_PER_SHAPE || sha256(value.stepText) !== value.stepSha256 || value.shapeHash !== value.stepSha256) throw new Error('step_hash_or_size_mismatch');
  return actual;
}

function validateArchitectureReceipt(receipt: ArchitectureExactGeometryReceipt, binding: ArchitectureInteriorExactArtifactBundle['binding'], expectedServiceOpenings?: readonly ArchitectureServiceOpening[]): { stepBytes: number; issues: string[] } {
  const issues: string[] = [];
  if (!receipt || !Array.isArray(receipt.shapes)) return { stepBytes: 0, issues: ['architecture_receipt_shape_list_invalid'] };
  if (receipt.contractVersion !== ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION || receipt.units !== 'mm' || receipt.exactGeometryProduced !== true || receipt.binding.projectId !== binding.projectId || receipt.binding.revision !== binding.revision || receipt.binding.documentId !== binding.architectureDocumentId || receipt.binding.documentHash !== binding.architectureDocumentHash || !SHA256.test(receipt.contentHash)) issues.push('architecture_receipt_binding_invalid');
  let bytes = 0;
  try { for (const shape of receipt.shapes) bytes += stepBytes(shape); } catch { issues.push('architecture_step_hash_or_size_invalid'); }
  if (!receipt.shapes.length || bytes > ARCHITECTURE_INTERIOR_EXACT_ARTIFACT_MAX_BYTES) issues.push('architecture_receipt_shape_limit_invalid');
  const serviceReceipts = receipt.serviceOpenings;
  if (serviceReceipts === undefined) {
    if ((expectedServiceOpenings?.length ?? 0) > 0) issues.push('architecture_service_opening_receipt_missing');
  } else if (!Array.isArray(serviceReceipts)) issues.push('architecture_service_opening_receipt_list_invalid');
  else {
    if (expectedServiceOpenings && serviceReceipts.length !== expectedServiceOpenings.length) issues.push('architecture_service_opening_receipt_count_mismatch');
    const expectedById = expectedServiceOpenings ? new Map(expectedServiceOpenings.map(opening => [opening.id, opening])) : undefined;
    const shapeById = new Map(receipt.shapes.map(shape => [shape.elementId, shape]));
    const seen = new Set<string>();
    for (const record of serviceReceipts) {
      const expected = expectedById?.get(record.openingId);
      const host = shapeById.get(record.hostId);
      if (seen.has(record.openingId)) issues.push(`architecture_service_opening_receipt_duplicate:${record.openingId}`);
      seen.add(record.openingId);
      const axisLength = Array.isArray(record.axis) ? Math.hypot(...record.axis) : Number.NaN;
      const semanticValid = Array.isArray(record.centerMm) && record.centerMm.length === 3 && record.centerMm.every((value: number) => Number.isFinite(value)) && Array.isArray(record.axis) && record.axis.length === 3 && record.axis.every((value: number) => Number.isFinite(value)) && Math.abs(axisLength - 1) <= 1e-6 && Number.isFinite(record.cutDiameterMm) && record.cutDiameterMm > 0 && Number.isFinite(record.depthMm) && record.depthMm > 0 && Number.isFinite(record.firestopAnnulusMm) && record.firestopAnnulusMm >= 0;
      if (!SAFE_ID.test(record.openingId) || !SAFE_ID.test(record.hostId) || !SAFE_ID.test(record.sourceRouteId) || !SAFE_ID.test(record.sourceSleeveId) || (record.structuralApprovalId !== undefined && !SAFE_ID.test(record.structuralApprovalId)) || !semanticValid || (expectedById && (!expected || record.hostId !== expected.hostId || record.sourceRouteId !== expected.sourceRouteId || record.sourceSleeveId !== expected.sourceSleeveId || JSON.stringify(record.centerMm) !== JSON.stringify(expected.centerMm) || JSON.stringify(record.axis) !== JSON.stringify(expected.axis) || record.cutDiameterMm !== expected.cutDiameterMm || record.depthMm !== expected.depthMm || record.firestopAnnulusMm !== expected.firestopAnnulusMm || (record.structuralApprovalId ?? undefined) !== (expected.structuralApprovalId ?? undefined)))) issues.push(`architecture_service_opening_receipt_binding_invalid:${record.openingId}`);
      const expectedBindingHash = expected && host ? hashExactServiceOpeningBindingForBinding(receipt.binding, { id: expected.id, hostId: expected.hostId, sourceRouteId: expected.sourceRouteId, sourceSleeveId: expected.sourceSleeveId, centerMm: expected.centerMm, axis: expected.axis, cutDiameterMm: expected.cutDiameterMm, depthMm: expected.depthMm, firestopAnnulusMm: expected.firestopAnnulusMm, ...(expected.structuralApprovalId !== undefined ? { structuralApprovalId: expected.structuralApprovalId } : {}) }, { shapeHash: host.shapeHash, stepSha256: host.stepSha256 }) : undefined;
      if (!host || record.hostShapeHash !== host.shapeHash || record.hostStepSha256 !== host.stepSha256 || !SHA256.test(record.bindingHash) || (expectedBindingHash !== undefined && record.bindingHash !== expectedBindingHash)) issues.push(`architecture_service_opening_receipt_host_invalid:${record.openingId}`);
    }
    for (const expected of expectedServiceOpenings ?? []) if (!seen.has(expected.id)) issues.push(`architecture_service_opening_receipt_missing:${expected.id}`);
  }
  const unsigned = { binding: receipt.binding, units: receipt.units, toleranceMm: receipt.toleranceMm, shapes: receipt.shapes.map(({ elementId, kind, shapeHash, stepSha256, stepBytes: size }) => ({ elementId, kind, shapeHash, stepSha256, stepBytes: size })), ...(Array.isArray(serviceReceipts) ? { serviceOpenings: serviceReceipts } : {}) };
  if (hashArchitectureInteriorEvidenceV2(unsigned) !== receipt.contentHash) issues.push('architecture_receipt_content_hash_invalid');
  return { stepBytes: bytes, issues };
}

function validateInteriorReceipt(receipt: InteriorExactGeometryReceipt, binding: ArchitectureInteriorExactArtifactBundle['binding']): { stepBytes: number; issues: string[] } {
  const issues: string[] = [];
  if (!receipt || !Array.isArray(receipt.shapes)) return { stepBytes: 0, issues: ['interior_receipt_shape_list_invalid'] };
  if (receipt.contractVersion !== INTERIOR_EXACT_GEOMETRY_CONTRACT_VERSION || receipt.units !== 'mm' || receipt.exactGeometryProduced !== true || receipt.binding.projectId !== binding.projectId || receipt.binding.revision !== binding.revision || receipt.binding.interiorDocumentId !== binding.interiorDocumentId || receipt.binding.interiorDocumentHash !== binding.interiorDocumentHash || receipt.binding.architectureDocumentId !== binding.architectureDocumentId || receipt.binding.architectureRevision !== binding.revision || receipt.binding.architectureDocumentHash !== binding.architectureDocumentHash || !SHA256.test(receipt.contentHash) || !SHA256.test(receipt.evidenceHash)) issues.push('interior_receipt_binding_invalid');
  let bytes = 0;
  try { for (const shape of receipt.shapes) bytes += stepBytes(shape); } catch { issues.push('interior_step_hash_or_size_invalid'); }
  if (bytes > ARCHITECTURE_INTERIOR_EXACT_ARTIFACT_MAX_BYTES) issues.push('interior_receipt_shape_limit_invalid');
  const unsigned = { contractVersion: receipt.contractVersion, units: receipt.units, binding: receipt.binding, kernel: receipt.kernel, toleranceMm: receipt.toleranceMm, abstraction: receipt.abstraction, vendorShapeFidelity: receipt.vendorShapeFidelity, classifications: receipt.classifications, shapes: receipt.shapes, sourceObjectIds: receipt.sourceObjectIds, ...(receipt.emptySolidSetEvidence ? { emptySolidSetEvidence: receipt.emptySolidSetEvidence } : {}), exactGeometryProduced: true as const };
  if (hashArchitectureInteriorEvidenceV2(unsigned) !== receipt.contentHash) issues.push('interior_receipt_content_hash_invalid');
  const evidence = { schema: 'nexyfab.interior-exact-brep-evidence.v1', contentHash: receipt.contentHash, binding: receipt.binding, abstraction: receipt.abstraction, classifications: receipt.classifications, shapes: receipt.shapes.map(({ stepText: _stepText, ...shape }) => shape) };
  if (hashArchitectureInteriorEvidenceV2(evidence) !== receipt.evidenceHash) issues.push('interior_receipt_evidence_hash_invalid');
  return { stepBytes: bytes, issues };
}

function bundleWithoutHash(workspace: ArchitectureInteriorWorkspaceV2, architectureReceipt: ArchitectureExactGeometryReceipt, interiorReceipt: InteriorExactGeometryReceipt): Omit<ArchitectureInteriorExactArtifactBundle, 'bundleHash'> {
  return { schema: ARCHITECTURE_INTERIOR_EXACT_ARTIFACT_BUNDLE_SCHEMA, binding: { projectId: workspace.projectId, revision: workspace.workspace.revision, architectureDocumentId: workspace.architecture.documentId, interiorDocumentId: workspace.interior.documentId, architectureDocumentHash: hashArchitectureInteriorEvidenceV2(workspace.architecture.document), interiorDocumentHash: hashArchitectureInteriorEvidenceV2(workspace.interior.document) }, architectureReceipt, interiorReceipt, receiptHashes: { architectureContentHash: architectureReceipt.contentHash, architectureEvidenceHash: hashArchitectureInteriorEvidenceV2(architectureReceipt), interiorContentHash: interiorReceipt.contentHash, interiorEvidenceHash: interiorReceipt.evidenceHash } };
}

export function buildArchitectureInteriorExactArtifactBundle(workspace: ArchitectureInteriorWorkspaceV2, architectureReceipt: ArchitectureExactGeometryReceipt): { ok: true; bundle: ArchitectureInteriorExactArtifactBundle; bytes: Buffer } | { ok: false; issues: string[] } {
  const issues = validateArchitectureInteriorWorkspaceV2(workspace);
  if (issues.length) return { ok: false, issues: ['workspace_invalid', ...issues] };
  const payload = workspace.interior.geometry.payload;
  const interiorReceipt = payload && typeof payload === 'object' && !Array.isArray(payload) && 'receipt' in payload ? (payload as { receipt?: unknown }).receipt : undefined;
  if (!interiorReceipt || typeof interiorReceipt !== 'object') return { ok: false, issues: ['interior_receipt_missing'] };
  const binding = bundleWithoutHash(workspace, architectureReceipt, interiorReceipt as InteriorExactGeometryReceipt).binding;
  const architectureCheck = validateArchitectureReceipt(architectureReceipt, binding, workspace.architecture.document.serviceOpenings ?? []);
  const interiorCheck = validateInteriorReceipt(interiorReceipt as InteriorExactGeometryReceipt, binding);
  const bundleBase = bundleWithoutHash(workspace, architectureReceipt, interiorReceipt as InteriorExactGeometryReceipt);
  const bundleHash = hashArchitectureInteriorEvidenceV2(bundleBase);
  const bundle: ArchitectureInteriorExactArtifactBundle = { ...bundleBase, bundleHash };
  const bytes = Buffer.from(stableJson(bundle), 'utf8');
  if (bytes.length > ARCHITECTURE_INTERIOR_EXACT_ARTIFACT_MAX_BYTES) return { ok: false, issues: ['exact_artifact_bundle_too_large'] };
  if (architectureCheck.stepBytes + interiorCheck.stepBytes > ARCHITECTURE_INTERIOR_EXACT_ARTIFACT_MAX_BYTES) return { ok: false, issues: ['exact_artifact_step_bytes_exceeded'] };
  return architectureCheck.issues.length || interiorCheck.issues.length ? { ok: false, issues: [...architectureCheck.issues, ...interiorCheck.issues] } : { ok: true, bundle, bytes };
}

export function exactArtifactReferenceFromBundle(manifestId: string, bundle: ArchitectureInteriorExactArtifactBundle, byteLength: number): ArchitectureInteriorExactArtifactReference {
  return { schema: ARCHITECTURE_INTERIOR_EXACT_ARTIFACT_REFERENCE_SCHEMA, manifestId, projectId: bundle.binding.projectId, revision: bundle.binding.revision, bundleHash: bundle.bundleHash, byteLength, architecture: { receiptContentHash: bundle.architectureReceipt.contentHash, receiptEvidenceHash: hashArchitectureInteriorEvidenceV2(bundle.architectureReceipt), shapeCount: bundle.architectureReceipt.shapes.length, stepBytes: bundle.architectureReceipt.shapes.reduce((sum, shape) => sum + shape.stepBytes, 0) }, interior: { receiptContentHash: bundle.interiorReceipt.contentHash, receiptEvidenceHash: bundle.interiorReceipt.evidenceHash, shapeCount: bundle.interiorReceipt.shapes.length, stepBytes: bundle.interiorReceipt.shapes.reduce((sum, shape) => sum + shape.stepBytes, 0) } };
}

export function compactArchitectureInteriorExactWorkspace(workspace: ArchitectureInteriorWorkspaceV2, reference: ArchitectureInteriorExactArtifactReference): ArchitectureInteriorWorkspaceV2 {
  const candidate = structuredClone(workspace);
  const compact = (domain: 'architecture' | 'interior', receiptContentHash: string, receiptEvidenceHash: string) => ({ schema: 'nexyfab.architecture-interior-exact-compact-reference.v1', domain, reference, receiptContentHash, receiptEvidenceHash });
  candidate.architecture.geometry.payload = compact('architecture', reference.architecture.receiptContentHash, reference.architecture.receiptEvidenceHash);
  candidate.interior.geometry.payload = compact('interior', reference.interior.receiptContentHash, reference.interior.receiptEvidenceHash);
  candidate.architecture.geometry.contentHash = hashArchitectureInteriorEvidenceV2(candidate.architecture.geometry.payload);
  candidate.interior.geometry.contentHash = hashArchitectureInteriorEvidenceV2(candidate.interior.geometry.payload);
  for (const artifact of candidate.artifactGraph.artifacts) {
    if (artifact.id === `model:architecture-brep:${candidate.workspace.revision}`) artifact.contentHash = candidate.architecture.geometry.contentHash;
    if (artifact.id === `model:interior-brep:${candidate.workspace.revision}`) artifact.contentHash = candidate.interior.geometry.contentHash;
  }
  candidate.contentHash = '';
  candidate.workspace.contentHash = '';
  const contentHash = hashArchitectureInteriorWorkspaceV2(candidate);
  candidate.contentHash = contentHash;
  candidate.workspace.contentHash = contentHash;
  return candidate;
}

export async function ensureArchitectureInteriorExactArtifactTables(db: DbAdapter): Promise<void> {
  await db.executeRaw(`CREATE TABLE IF NOT EXISTS nf_architecture_interior_exact_artifact_manifests (manifest_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL, bundle_hash TEXT NOT NULL, byte_length BIGINT NOT NULL, object_key TEXT NOT NULL, architecture_receipt_hash TEXT NOT NULL, architecture_evidence_hash TEXT NOT NULL, interior_receipt_hash TEXT NOT NULL, interior_evidence_hash TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL, immutability_state TEXT NOT NULL, UNIQUE(tenant_id, project_id, revision, bundle_hash)); CREATE INDEX IF NOT EXISTS idx_nf_architecture_interior_exact_artifact_manifest_scope ON nf_architecture_interior_exact_artifact_manifests(tenant_id, project_id, revision DESC);`);
}

export async function persistArchitectureInteriorExactArtifact(input: { db: DbAdapter; storage: StorageAdapter; owner: ExactArtifactOwner; workspace: ArchitectureInteriorWorkspaceV2; architectureReceipt: ArchitectureExactGeometryReceipt; now?: number }): Promise<PersistExactArtifactResult> {
  if (!safeScope(input.owner.tenantId) || !safeScope(input.owner.userId) || !safeScope(input.workspace.projectId)) return { ok: false, code: 'INVALID_ARTIFACT', issues: ['artifact_scope_invalid'] };
  const built = buildArchitectureInteriorExactArtifactBundle(input.workspace, input.architectureReceipt);
  if (!built.ok) return { ok: false, code: 'INVALID_ARTIFACT', issues: built.issues.slice(0, 64) };
  const manifestId = randomUUID();
  const filename = `${manifestId}.json`;
  let uploaded: { key: string };
  try { uploaded = await input.storage.uploadPrivate(built.bytes, filename, `architecture-interior-exact/projects/${input.workspace.projectId}/revisions/${input.workspace.workspace.revision}`); } catch { return { ok: false, code: 'STORAGE_UNAVAILABLE', issues: ['private_artifact_upload_failed'] }; }
  if (typeof uploaded.key !== 'string' || !uploaded.key.startsWith('private/architecture-interior-exact/projects/') || uploaded.key.includes('..') || uploaded.key.includes('\\') || uploaded.key.endsWith('/')) { await input.storage.delete(uploaded.key).catch(() => {}); return { ok: false, code: 'STORAGE_UNAVAILABLE', issues: ['private_artifact_key_invalid'] }; }
  const reference = exactArtifactReferenceFromBundle(manifestId, built.bundle, built.bytes.byteLength);
  try {
    await input.db.transaction(async tx => {
      await tx.execute('INSERT INTO nf_architecture_interior_exact_artifact_manifests (manifest_id, tenant_id, project_id, revision, bundle_hash, byte_length, object_key, architecture_receipt_hash, architecture_evidence_hash, interior_receipt_hash, interior_evidence_hash, created_by, created_at, immutability_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', manifestId, input.owner.tenantId, input.workspace.projectId, input.workspace.workspace.revision, built.bundle.bundleHash, built.bytes.byteLength, uploaded.key, reference.architecture.receiptContentHash, reference.architecture.receiptEvidenceHash, reference.interior.receiptContentHash, reference.interior.receiptEvidenceHash, input.owner.userId, input.now ?? Date.now(), 'IMMUTABLE');
    });
  } catch { await input.storage.delete(uploaded.key).catch(() => {}); return { ok: false, code: 'MANIFEST_PERSIST_FAILED', issues: ['exact_artifact_manifest_insert_failed'] }; }
  return { ok: true, reference };
}

export async function deleteArchitectureInteriorExactArtifact(input: { db: DbAdapter; storage: StorageAdapter; owner: ExactArtifactOwner; projectId: string; manifestId: string }): Promise<void> {
  const row = await input.db.queryOne<{ object_key: string }>('SELECT object_key FROM nf_architecture_interior_exact_artifact_manifests WHERE manifest_id = ? AND tenant_id = ? AND project_id = ?', input.manifestId, input.owner.tenantId, input.projectId).catch(() => undefined);
  if (!row) return;
  await input.storage.delete(row.object_key).catch(() => {});
  await input.db.execute('DELETE FROM nf_architecture_interior_exact_artifact_manifests WHERE manifest_id = ? AND tenant_id = ? AND project_id = ?', input.manifestId, input.owner.tenantId, input.projectId).catch(() => {});
}

/** Reads and revalidates the private object and its scoped metadata without exposing its key. */
export async function readValidateArchitectureInteriorExactArtifact(input: { db: DbAdapter; storage: StorageAdapter; owner: ExactArtifactOwner; projectId: string; manifestId: string }): Promise<ReadExactArtifactResult> {
  if (!safeScope(input.owner.tenantId) || !safeScope(input.owner.userId) || !safeScope(input.projectId) || !SAFE_ID.test(input.manifestId)) return { ok: false, code: 'TENANT_MISMATCH', issues: ['artifact_scope_invalid'] };
  const row = await input.db.queryOne<{ manifest_id: string; tenant_id: string; project_id: string; revision: number; bundle_hash: string; byte_length: number; object_key: string; architecture_receipt_hash: string; architecture_evidence_hash: string; interior_receipt_hash: string; interior_evidence_hash: string }>('SELECT manifest_id, tenant_id, project_id, revision, bundle_hash, byte_length, object_key, architecture_receipt_hash, architecture_evidence_hash, interior_receipt_hash, interior_evidence_hash FROM nf_architecture_interior_exact_artifact_manifests WHERE manifest_id = ?', input.manifestId).catch(() => undefined);
  if (!row) return { ok: false, code: 'NOT_FOUND', issues: ['manifest_not_found'] };
  if (row.tenant_id !== input.owner.tenantId || row.project_id !== input.projectId || row.manifest_id !== input.manifestId) return { ok: false, code: 'TENANT_MISMATCH', issues: ['manifest_scope_mismatch'] };
  if (typeof row.object_key !== 'string' || !row.object_key.startsWith('private/architecture-interior-exact/projects/') || row.object_key.includes('..') || row.object_key.includes('\\') || row.object_key.includes('://')) return { ok: false, code: 'CORRUPT_ARTIFACT', issues: ['private_artifact_key_invalid'] };
  if (!SHA256.test(row.bundle_hash) || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 0 || !Number.isSafeInteger(Number(row.byte_length)) || Number(row.byte_length) <= 0 || Number(row.byte_length) > ARCHITECTURE_INTERIOR_EXACT_ARTIFACT_MAX_BYTES) return { ok: false, code: 'CORRUPT_ARTIFACT', issues: ['manifest_metadata_invalid'] };
  if (!input.storage.download) return { ok: false, code: 'CORRUPT_ARTIFACT', issues: ['private_artifact_download_unavailable'] };
  let bytes: Buffer;
  try { bytes = await input.storage.download(row.object_key); } catch { return { ok: false, code: 'CORRUPT_ARTIFACT', issues: ['private_artifact_missing'] }; }
  if (bytes.byteLength !== Number(row.byte_length) || bytes.byteLength > ARCHITECTURE_INTERIOR_EXACT_ARTIFACT_MAX_BYTES) return { ok: false, code: 'CORRUPT_ARTIFACT', issues: ['private_artifact_size_mismatch'] };
  let bundle: ArchitectureInteriorExactArtifactBundle;
  try { bundle = JSON.parse(bytes.toString('utf8')) as ArchitectureInteriorExactArtifactBundle; } catch { return { ok: false, code: 'CORRUPT_ARTIFACT', issues: ['private_artifact_json_invalid'] }; }
  if (!bundle || bundle.schema !== ARCHITECTURE_INTERIOR_EXACT_ARTIFACT_BUNDLE_SCHEMA || bundle.binding.projectId !== input.projectId || bundle.binding.revision !== Number(row.revision) || !SHA256.test(bundle.bundleHash)) return { ok: false, code: 'CORRUPT_ARTIFACT', issues: ['bundle_binding_invalid'] };
  const { bundleHash, ...base } = bundle;
  if (hashArchitectureInteriorEvidenceV2(base) !== bundleHash || bundleHash !== row.bundle_hash) return { ok: false, code: 'CORRUPT_ARTIFACT', issues: ['bundle_hash_mismatch'] };
  const architectureCheck = validateArchitectureReceipt(bundle.architectureReceipt, bundle.binding);
  const interiorCheck = validateInteriorReceipt(bundle.interiorReceipt, bundle.binding);
  if (architectureCheck.issues.length || interiorCheck.issues.length) return { ok: false, code: 'CORRUPT_ARTIFACT', issues: [...architectureCheck.issues, ...interiorCheck.issues] };
  const reference = exactArtifactReferenceFromBundle(input.manifestId, bundle, bytes.byteLength);
  if (reference.architecture.receiptContentHash !== row.architecture_receipt_hash || reference.architecture.receiptEvidenceHash !== row.architecture_evidence_hash || reference.interior.receiptContentHash !== row.interior_receipt_hash || reference.interior.receiptEvidenceHash !== row.interior_evidence_hash) return { ok: false, code: 'CORRUPT_ARTIFACT', issues: ['manifest_receipt_hash_mismatch'] };
  return { ok: true, reference };
}
