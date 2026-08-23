import { createHash } from 'node:crypto';
import type { OcctOperationResult } from '@/lib/occt/types';
import type {
  ArchitectureExactKernelAdapter,
  ArchitectureExactKernelIdentity,
} from './architectureInteriorExactGeometry';
import type {
  InteriorAcousticZone,
  InteriorCeilingSystem,
  InteriorDocument,
  InteriorFinish,
  InteriorFurniture,
  InteriorLight,
  InteriorMillwork,
} from './architectureInteriorDocuments';
import { hashArchitectureInteriorEvidenceV2 } from './architectureInteriorWorkspace';

/** The interior exact path deliberately has its own binding and receipt. */
export const INTERIOR_EXACT_GEOMETRY_CONTRACT_VERSION = 'nexyfab.interior-exact-geometry.v1' as const;

export type InteriorExactBlockerCode =
  | 'INTERIOR_EXACT_INVALID_REQUEST'
  | 'INTERIOR_EXACT_UNTRUSTED_INPUT'
  | 'INTERIOR_EXACT_BINDING_FAILED'
  | 'INTERIOR_EXACT_KERNEL_UNAVAILABLE'
  | 'INTERIOR_EXACT_KERNEL_OPERATION_FAILED'
  | 'INTERIOR_EXACT_VERIFICATION_FAILED'
  | 'INTERIOR_EXACT_UNSUPPORTED_OBJECT';

type V3 = readonly [number, number, number];

export type InteriorExactBinding = {
  projectId: string;
  revision: number;
  interiorDocumentId: string;
  interiorDocumentHash: string;
  architectureDocumentId: string;
  architectureRevision: number;
  architectureDocumentHash: string;
};

export type InteriorExactBox = {
  id: string;
  kind: 'furniture' | 'millwork';
  /** Document position is the centre of the XY envelope and the bottom Z. */
  positionMm: V3;
  sizeMm: V3;
  clearanceMm: number;
  rotationDeg: number;
};

export type InteriorExactClassification = {
  id: string;
  kind: 'light' | 'furniture' | 'finish' | 'millwork' | 'ceiling_system' | 'acoustic_zone';
  representation: 'brep_clearance_envelope' | 'semantic_host_bound';
  hostId: string;
  abstraction: 'clearance_envelope_box' | 'semantic_non_solid';
};

export type InteriorExactGeometryRequest = {
  contractVersion: typeof INTERIOR_EXACT_GEOMETRY_CONTRACT_VERSION;
  units: 'mm';
  binding: InteriorExactBinding;
  toleranceMm: number;
  boxes: readonly InteriorExactBox[];
  /** Complete coverage of every object in the bound interior document. */
  classifications: readonly InteriorExactClassification[];
  /** Immutable object-id set copied from the bound document by the builder. */
  sourceObjectIds: readonly string[];
};

export type InteriorExactShapeReceipt = {
  elementId: string;
  kind: 'furniture' | 'millwork';
  abstraction: 'clearance_envelope_box';
  vendorShapeFidelity: 'not_claimed';
  shapeHash: string;
  stepSha256: string;
  stepBytes: number;
  stepText: string;
  closedSolid: true;
  verification: {
    valid: true;
    solidCount: number;
    faceCount: number;
    edgeCount: number;
    toleranceMm: number;
    maxToleranceMm: number;
    toleranceVerified: true;
  };
};

export type InteriorExactGeometryReceipt = {
  contractVersion: typeof INTERIOR_EXACT_GEOMETRY_CONTRACT_VERSION;
  units: 'mm';
  binding: InteriorExactBinding;
  kernel: ArchitectureExactKernelIdentity;
  toleranceMm: number;
  abstraction: 'clearance_envelope_box_brep';
  vendorShapeFidelity: 'not_claimed';
  shapes: readonly InteriorExactShapeReceipt[];
  classifications: readonly InteriorExactClassification[];
  sourceObjectIds: readonly string[];
  emptySolidSetEvidence?: {
    status: 'verified';
    reason: 'no_furniture_or_millwork';
    classificationHash: string;
  };
  contentHash: string;
  /** Hash of this receipt's independently verifiable evidence payload. */
  evidenceHash: string;
  exactGeometryProduced: true;
};

export type InteriorExactGeometryResult =
  | { ok: true; receipt: InteriorExactGeometryReceipt }
  | { ok: false; code: InteriorExactBlockerCode; details: readonly string[] };

export type InteriorExactSource = {
  projectId: string;
  revision: number;
  interiorDocumentId: string;
  interiorDocument: InteriorDocument;
  architectureDocumentId: string;
  architectureRevision: number;
  architectureDocumentHash: string;
};

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DENY_KEY = /(?:path|url|secret|token|password|credential|filename|filepath)/i;
const MAX_OBJECTS = 2_000;
const MAX_COORDINATE_MM = 1_000_000_000;
const MAX_STEP_BYTES_PER_SHAPE = 64 * 1024 * 1024;
const MAX_TOTAL_STEP_BYTES = 256 * 1024 * 1024;

function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function untrusted(value: unknown, key = '', seen = new Set<object>()): boolean {
  if (DENY_KEY.test(key)) return true;
  if (typeof value === 'string') return value.includes('://') || value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value);
  if (value && typeof value === 'object') {
    if (seen.has(value)) return true;
    seen.add(value);
    const rejected = Array.isArray(value)
      ? value.some(item => untrusted(item, key, seen))
      : Object.entries(value).some(([name, item]) => untrusted(item, name, seen));
    seen.delete(value);
    return rejected;
  }
  return false;
}
function finite(value: number): boolean { return Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE_MM; }
function finite3(point: V3): boolean { return Array.isArray(point) && point.length === 3 && point.every(finite); }
function fail(code: InteriorExactBlockerCode, ...details: string[]): InteriorExactGeometryResult { return { ok: false, code, details }; }

function expectedClassifications(document: InteriorDocument): InteriorExactClassification[] {
  const classes: InteriorExactClassification[] = [];
  const add = (id: string, kind: InteriorExactClassification['kind'], hostId: string, solid: boolean) => classes.push({ id, kind, hostId, representation: solid ? 'brep_clearance_envelope' : 'semantic_host_bound', abstraction: solid ? 'clearance_envelope_box' : 'semantic_non_solid' });
  document.lights.forEach((item: InteriorLight) => add(item.id, 'light', item.hostCeilingId, false));
  document.furniture.forEach((item: InteriorFurniture) => add(item.id, 'furniture', item.spaceId, true));
  document.finishes.forEach((item: InteriorFinish) => add(item.id, 'finish', item.hostId, false));
  document.millwork?.forEach((item: InteriorMillwork) => add(item.id, 'millwork', item.hostWallId ?? item.spaceId, true));
  document.ceilingSystems?.forEach((item: InteriorCeilingSystem) => add(item.id, 'ceiling_system', item.hostCeilingId, false));
  document.acousticZones?.forEach((item: InteriorAcousticZone) => add(item.id, 'acoustic_zone', item.spaceId, false));
  return classes;
}

function boxFromFurniture(item: InteriorFurniture): InteriorExactBox {
  return { id: item.id, kind: 'furniture', positionMm: item.positionMm, sizeMm: item.sizeMm, clearanceMm: item.clearanceMm, rotationDeg: item.rotationDeg ?? 0 };
}
function boxFromMillwork(item: InteriorMillwork): InteriorExactBox {
  return { id: item.id, kind: 'millwork', positionMm: item.positionMm, sizeMm: item.sizeMm, clearanceMm: item.clearanceMm, rotationDeg: 0 };
}

/** Build only from the bound document; callers cannot provide substitute geometry. */
export function buildInteriorExactGeometryRequest(source: InteriorExactSource):
  | { ok: true; request: InteriorExactGeometryRequest; documentHash: string }
  | { ok: false; code: InteriorExactBlockerCode; details: readonly string[] } {
  if (untrusted(source)) return fail('INTERIOR_EXACT_UNTRUSTED_INPUT', 'path_url_or_secret_input_forbidden') as never;
  if (!ID.test(source.projectId) || !ID.test(source.interiorDocumentId) || !ID.test(source.architectureDocumentId) || !HASH.test(source.architectureDocumentHash) || !Number.isSafeInteger(source.revision) || source.revision < 0 || !Number.isSafeInteger(source.architectureRevision) || source.architectureRevision < 0) return fail('INTERIOR_EXACT_BINDING_FAILED', 'source_binding_invalid') as never;
  if (source.interiorDocument.schema !== 'nexyfab.interior.v1' || source.interiorDocument.architectureDocumentId !== source.architectureDocumentId || source.interiorDocument.revision !== source.revision) return fail('INTERIOR_EXACT_BINDING_FAILED', 'interior_document_revision_or_host_mismatch') as never;
  const documentHash = hashArchitectureInteriorEvidenceV2(source.interiorDocument);
  const classifications = expectedClassifications(source.interiorDocument);
  const boxes = [...source.interiorDocument.furniture.map(boxFromFurniture), ...(source.interiorDocument.millwork ?? []).map(boxFromMillwork)];
  const request: InteriorExactGeometryRequest = { contractVersion: INTERIOR_EXACT_GEOMETRY_CONTRACT_VERSION, units: 'mm', binding: { projectId: source.projectId, revision: source.revision, interiorDocumentId: source.interiorDocumentId, interiorDocumentHash: documentHash, architectureDocumentId: source.architectureDocumentId, architectureRevision: source.architectureRevision, architectureDocumentHash: source.architectureDocumentHash }, toleranceMm: 0.1, boxes, classifications, sourceObjectIds: classifications.map(item => item.id) };
  return { ok: true, request, documentHash };
}

function validateRequest(request: InteriorExactGeometryRequest): string[] {
  const issues: string[] = [];
  if (!request || request.contractVersion !== INTERIOR_EXACT_GEOMETRY_CONTRACT_VERSION || request.units !== 'mm') issues.push('contract_or_units_invalid');
  const b = request?.binding;
  if (!b || !ID.test(b.projectId) || !ID.test(b.interiorDocumentId) || !ID.test(b.architectureDocumentId) || !HASH.test(b.interiorDocumentHash) || !HASH.test(b.architectureDocumentHash) || !Number.isSafeInteger(b.revision) || !Number.isSafeInteger(b.architectureRevision) || b.revision < 0 || b.architectureRevision < 0) issues.push('binding_invalid');
  if (!Number.isFinite(request?.toleranceMm) || request.toleranceMm <= 0 || request.toleranceMm > 10) issues.push('tolerance_invalid');
  if (!Array.isArray(request?.boxes) || !Array.isArray(request?.classifications) || !Array.isArray(request?.sourceObjectIds)) issues.push('arrays_invalid');
  if ((request?.boxes?.length ?? 0) > MAX_OBJECTS || (request?.classifications?.length ?? 0) > MAX_OBJECTS * 3) issues.push('object_count_exceeded');
  const ids = new Set<string>();
  for (const box of request?.boxes ?? []) {
    if (!ID.test(box.id) || ids.has(box.id)) issues.push(`${box.id}:duplicate_or_invalid_id`); ids.add(box.id);
    if (!['furniture', 'millwork'].includes(box.kind) || !finite3(box.positionMm) || !finite3(box.sizeMm) || box.sizeMm.some(item => item <= 0) || !finite(box.clearanceMm) || box.clearanceMm < 0 || !finite(box.rotationDeg)) issues.push(`${box.id}:box_invalid`);
  }
  for (const item of request?.classifications ?? []) {
    if (!ID.test(item.id) || ids.has(item.id)) { if (ids.has(item.id) && !request.boxes.some(box => box.id === item.id)) issues.push(`${item.id}:duplicate_or_invalid_id`); } else ids.add(item.id);
    if (!ID.test(item.hostId) || !['light', 'furniture', 'finish', 'millwork', 'ceiling_system', 'acoustic_zone'].includes(item.kind) || !['brep_clearance_envelope', 'semantic_host_bound'].includes(item.representation) || !['clearance_envelope_box', 'semantic_non_solid'].includes(item.abstraction)) issues.push(`${item.id}:classification_invalid`);
    if ((item.kind === 'furniture' || item.kind === 'millwork') && item.representation !== 'brep_clearance_envelope') issues.push(`${item.id}:solid_classification_required`);
    if (!['furniture', 'millwork'].includes(item.kind) && item.representation !== 'semantic_host_bound') issues.push(`${item.id}:non_solid_classification_required`);
  }
  if (new Set((request?.classifications ?? []).map(item => item.id)).size !== (request?.classifications ?? []).length) issues.push('classification_ids_not_unique');
  const sourceIds = request?.sourceObjectIds ?? [];
  if (sourceIds.length !== (request?.classifications ?? []).length || new Set(sourceIds).size !== sourceIds.length || sourceIds.some(id => !ID.test(id)) || [...sourceIds].sort().join('\n') !== [...(request?.classifications ?? []).map(item => item.id)].sort().join('\n')) issues.push('classification_coverage_incomplete');
  if ((request?.boxes ?? []).some(box => !(request.classifications ?? []).some(item => item.id === box.id && item.kind === box.kind && item.representation === 'brep_clearance_envelope'))) issues.push('solid_classification_incomplete');
  if ((request?.classifications ?? []).some(item => (item.kind === 'furniture' || item.kind === 'millwork') && !(request.boxes ?? []).some(box => box.id === item.id && box.kind === item.kind))) issues.push('solid_geometry_incomplete');
  return issues;
}

function rotatedBoxLoop(box: InteriorExactBox): readonly { x: number; y: number }[] {
  const hx = (box.sizeMm[0] + 2 * box.clearanceMm) / 2, hy = (box.sizeMm[1] + 2 * box.clearanceMm) / 2, angle = box.rotationDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => ({ x: box.positionMm[0] + x * c - y * s, y: box.positionMm[1] + x * s + y * c }));
}

async function receiptForShape(adapter: ArchitectureExactKernelAdapter, box: InteriorExactBox, built: OcctOperationResult, toleranceMm: number): Promise<InteriorExactShapeReceipt | InteriorExactGeometryResult> {
  if (!built.ok || !built.shape) return fail('INTERIOR_EXACT_KERNEL_OPERATION_FAILED', `${box.id}:build_failed`);
  let cleanupFailed = false;
  let result: InteriorExactShapeReceipt | InteriorExactGeometryResult;
  try {
    const inspection = await adapter.inspectShape(built.shape);
    const detailed = adapter.inspectShapeDetailed ? await adapter.inspectShapeDetailed(built.shape) : undefined;
    if (!inspection.valid || inspection.solidCount !== 1 || !detailed?.valid || detailed.solidCount !== 1 || detailed.maxTolerance === undefined || detailed.maxTolerance > toleranceMm) result = fail('INTERIOR_EXACT_VERIFICATION_FAILED', `${box.id}:closed_solid_or_tolerance_failed`);
    else {
    const step = await adapter.exportSTEP(built.shape);
    const stepBytes = Buffer.byteLength(step, 'utf8');
    if (stepBytes > MAX_STEP_BYTES_PER_SHAPE || !step.includes('ISO-10303-21;') || !step.includes('MANIFOLD_SOLID_BREP') || !step.includes('END-ISO-10303-21;')) result = fail('INTERIOR_EXACT_VERIFICATION_FAILED', `${box.id}:step_not_manifold_or_too_large`);
    else {
      const stepSha256 = sha256(step);
      result = { elementId: box.id, kind: box.kind, abstraction: 'clearance_envelope_box', vendorShapeFidelity: 'not_claimed', shapeHash: stepSha256, stepSha256, stepBytes, stepText: step, closedSolid: true, verification: { valid: true, solidCount: inspection.solidCount, faceCount: inspection.faceCount, edgeCount: inspection.edgeCount, toleranceMm, maxToleranceMm: detailed.maxTolerance, toleranceVerified: true } };
    }
    }
  } catch (error) {
    result = fail('INTERIOR_EXACT_KERNEL_OPERATION_FAILED', `${box.id}:${error instanceof Error ? 'inspection_or_export_failed' : 'kernel_failed'}`);
  } finally {
    try { adapter.release(built.shape); } catch { cleanupFailed = true; }
  }
  return cleanupFailed ? fail('INTERIOR_EXACT_KERNEL_OPERATION_FAILED', `${box.id}:cleanup_failed`) : result!;
}

/** Generate independently bindable interior clearance-envelope evidence. */
export async function generateInteriorExactGeometry(request: InteriorExactGeometryRequest, adapter: ArchitectureExactKernelAdapter): Promise<InteriorExactGeometryResult> {
  if (untrusted(request)) return fail('INTERIOR_EXACT_UNTRUSTED_INPUT', 'path_url_or_secret_input_forbidden');
  const issues = validateRequest(request);
  if (issues.length) return fail('INTERIOR_EXACT_INVALID_REQUEST', ...issues);
  if (!adapter.identity.realKernel || !adapter.identity.version?.trim() || !HASH.test(adapter.identity.buildSha256 ?? '') || !HASH.test(adapter.identity.wasmSha256 ?? '')) return fail('INTERIOR_EXACT_KERNEL_UNAVAILABLE', 'trusted_real_kernel_identity_required');
  const shapes: InteriorExactShapeReceipt[] = [];
  let totalStepBytes = 0;
  for (const box of request.boxes) {
    let built: OcctOperationResult;
    try { built = await adapter.buildPrismAt(rotatedBoxLoop(box), box.positionMm[2] - box.clearanceMm, box.sizeMm[2] + 2 * box.clearanceMm); }
    catch { return fail('INTERIOR_EXACT_KERNEL_OPERATION_FAILED', `${box.id}:build_threw`); }
    const receipt = await receiptForShape(adapter, box, built, request.toleranceMm);
    if (!('elementId' in receipt)) return receipt;
    totalStepBytes += receipt.stepBytes;
    if (totalStepBytes > MAX_TOTAL_STEP_BYTES) return fail('INTERIOR_EXACT_VERIFICATION_FAILED', 'total_step_artifact_too_large');
    shapes.push(receipt);
  }
  const classificationHash = hashArchitectureInteriorEvidenceV2(request.classifications);
  const unsigned = { contractVersion: request.contractVersion, units: request.units, binding: request.binding, kernel: adapter.identity, toleranceMm: request.toleranceMm, abstraction: 'clearance_envelope_box_brep' as const, vendorShapeFidelity: 'not_claimed' as const, shapes, classifications: request.classifications, sourceObjectIds: request.sourceObjectIds, ...(shapes.length === 0 ? { emptySolidSetEvidence: { status: 'verified' as const, reason: 'no_furniture_or_millwork' as const, classificationHash } } : {}), exactGeometryProduced: true as const };
  const contentHash = hashArchitectureInteriorEvidenceV2(unsigned);
  const evidenceHash = hashArchitectureInteriorEvidenceV2({ schema: 'nexyfab.interior-exact-brep-evidence.v1', contentHash, binding: request.binding, abstraction: unsigned.abstraction, classifications: request.classifications, shapes: shapes.map(shape => ({ ...shape, stepText: undefined })) });
  return { ok: true, receipt: { ...unsigned, contentHash, evidenceHash } };
}
