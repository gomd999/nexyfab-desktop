import { createHash } from 'node:crypto';
import {
  createDomainDeliverableManifest,
  validateDomainDeliverableManifest,
  type DomainDeliverable,
  type DomainDeliverableManifest,
} from '../../../src/lib/cad/domainDeliverableManifest';
import {
  validateSpatialDeliverableBinding,
  type SpatialDeliverableBinding,
  type SpatialModelIdentity,
  type SpatialRevisionHash,
} from '../../../src/lib/cad/spatialDeliverableBinding';

/** The immutable, commercial core package for a two-storey building project. */
export const BUILDING_CORE_DELIVERABLE_KINDS = [
  'native-building-document',
  'site-plan',
  'floor-plans',
  'roof-plan',
  'elevations',
  'sections',
  'opening-schedule',
  'space-schedule',
  'quantity-schedule',
  'coordination-report',
  'ifc',
  'verification-receipt',
] as const;
export type BuildingCoreDeliverableKind = typeof BUILDING_CORE_DELIVERABLE_KINDS[number];

const FORMAT_BY_KIND: Record<BuildingCoreDeliverableKind, DomainDeliverable['format']> = {
  'native-building-document': 'json',
  'site-plan': 'drawing',
  'floor-plans': 'drawing',
  'roof-plan': 'drawing',
  elevations: 'drawing',
  sections: 'drawing',
  'opening-schedule': 'schedule',
  'space-schedule': 'schedule',
  'quantity-schedule': 'quantity-schedule',
  'coordination-report': 'pdf',
  ifc: 'ifc',
  'verification-receipt': 'json',
};

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sameSequence = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export interface BuildingCoreManifestExpectations {
  projectRevision?: string;
  modelContentHash?: string;
}
export interface BuildingCoreManifestValidation { valid: boolean; errors: string[] }
export type BuildingCoreDeliverableManifest = DomainDeliverableManifest & {
  domain: 'building';
  requiredDeliverableKinds: BuildingCoreDeliverableKind[];
};

export function createBuildingCoreDeliverableManifest(
  input: Omit<BuildingCoreDeliverableManifest, 'schema' | 'domain' | 'requiredDeliverableKinds'>,
): BuildingCoreDeliverableManifest {
  return createDomainDeliverableManifest({
    ...input,
    domain: 'building',
    requiredDeliverableKinds: [...BUILDING_CORE_DELIVERABLE_KINDS],
  }) as BuildingCoreDeliverableManifest;
}

export function validateBuildingCoreDeliverableManifest(
  input: unknown,
  expectations: BuildingCoreManifestExpectations = {},
): BuildingCoreManifestValidation {
  const common = validateDomainDeliverableManifest(input);
  const errors = [...common.errors];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: [...new Set(errors)] };
  const manifest = input as Partial<BuildingCoreDeliverableManifest>;
  if (manifest.domain !== 'building') errors.push('building_domain_required');
  if (!Array.isArray(manifest.requiredDeliverableKinds) || !sameSequence(manifest.requiredDeliverableKinds, BUILDING_CORE_DELIVERABLE_KINDS)) {
    errors.push('building_required_kinds_exact_mismatch');
  }
  if (expectations.projectRevision !== undefined && manifest.projectRevision !== expectations.projectRevision) errors.push('building_project_revision_mismatch');
  if (expectations.modelContentHash !== undefined && manifest.modelContentHash !== expectations.modelContentHash) errors.push('building_model_content_hash_mismatch');

  const seen = new Set<string>();
  for (const item of Array.isArray(manifest.deliverables) ? manifest.deliverables : []) {
    if (!item || typeof item !== 'object' || typeof item.kind !== 'string') continue;
    if (!BUILDING_CORE_DELIVERABLE_KINDS.includes(item.kind as BuildingCoreDeliverableKind)) {
      errors.push(`building_unknown_deliverable_kind:${item.kind}`);
      continue;
    }
    if (seen.has(item.kind)) errors.push(`building_duplicate_deliverable_kind:${item.kind}`);
    seen.add(item.kind);
    const expectedFormat = FORMAT_BY_KIND[item.kind as BuildingCoreDeliverableKind];
    if (item.format !== expectedFormat) errors.push(`building_format_mismatch:${item.kind}`);
    if (item.sourceRevision !== manifest.projectRevision) errors.push(`building_stale_deliverable:${item.kind}`);
    if (item.verificationStatus !== 'verified') errors.push(`building_unverified_deliverable:${item.kind}`);
  }
  for (const kind of BUILDING_CORE_DELIVERABLE_KINDS) if (!seen.has(kind)) errors.push(`building_required_deliverable_missing:${kind}`);
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export interface BuildingAuthoritativeSource {
  id: string;
  revision: SpatialRevisionHash;
  sha256: string;
  rightsReceiptSha256: string;
  reviewStatus: 'APPROVED';
  commercialUse: true;
}

export interface BuildingIfcRoundTripReceipt {
  receiptSha256: string;
  exchangeKind: 'ifc';
  exchangeContentSha256: string;
  sourceRevision: SpatialRevisionHash;
  sourceModelSha256: string;
  semanticObjectGraphSha256: string;
  coordinateFrameSha256: string;
  quantitySha256: string;
  semanticRoundTripSha256: string;
  geometryRoundTripSha256: string;
  independentValidatorId: string;
  independent: true;
  status: 'VERIFIED';
}

export interface BuildingCoreDeliverableBinding {
  schema: 'nexyfab.cad.building-core-deliverable-binding.v1';
  domain: 'building';
  projectId: string;
  manifest: BuildingCoreDeliverableManifest;
  model: SpatialModelIdentity;
  authoritativeSource: BuildingAuthoritativeSource;
  /** Common spatial binding remains a separately validated, reusable minimum. */
  spatialMinimum: SpatialDeliverableBinding;
  independentIfcRoundTrip: BuildingIfcRoundTripReceipt;
}

export interface BuildingCoreBindingValidation {
  valid: boolean;
  status: 'VERIFIED' | 'HOLD' | 'STALE';
  errors: string[];
  canonicalSha256?: string;
}

const BINDING_KEYS = ['schema', 'domain', 'projectId', 'manifest', 'model', 'authoritativeSource', 'spatialMinimum', 'independentIfcRoundTrip'] as const;
const MODEL_KEYS = ['revision', 'modelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256', 'drawingScheduleSha256', 'sourceStatus'] as const;
const SOURCE_KEYS = ['id', 'revision', 'sha256', 'rightsReceiptSha256', 'reviewStatus', 'commercialUse'] as const;
const ROUNDTRIP_KEYS = ['receiptSha256', 'exchangeKind', 'exchangeContentSha256', 'sourceRevision', 'sourceModelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256', 'semanticRoundTripSha256', 'geometryRoundTripSha256', 'independentValidatorId', 'independent', 'status'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: unknown, expected: readonly string[]) => isRecord(value) && Object.keys(value).length === expected.length && Object.keys(value).every((key) => expected.includes(key));
const isHash = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value);
const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
const stableJson = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(stableJson).join(',')}]`
  : isRecord(value)
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';
const sameRevision = (a: unknown, b: unknown): boolean => isRecord(a) && isRecord(b) && a.id === b.id && a.sha256 === b.sha256;

function validateSource(source: unknown, errors: string[]): source is BuildingAuthoritativeSource {
  const before = errors.length;
  if (!exactKeys(source, SOURCE_KEYS)) { errors.push('authoritative_source_keys_invalid'); return false; }
  const value = source as Record<string, unknown>;
  if (!isId(value.id)) errors.push('authoritative_source_id_invalid');
  if (!exactKeys(value.revision, ['id', 'sha256'])) errors.push('authoritative_source_revision_invalid');
  else if (!isId((value.revision as Record<string, unknown>).id) || !isHash((value.revision as Record<string, unknown>).sha256)) errors.push('authoritative_source_revision_invalid');
  if (!isHash(value.sha256)) errors.push('authoritative_source_hash_invalid');
  if (!isHash(value.rightsReceiptSha256)) errors.push('authoritative_source_rights_receipt_invalid');
  if (value.reviewStatus !== 'APPROVED') errors.push('authoritative_source_not_approved');
  if (value.commercialUse !== true) errors.push('authoritative_source_commercial_use_required');
  return errors.length === before;
}

function validateModel(model: unknown, errors: string[]): model is SpatialModelIdentity {
  const before = errors.length;
  if (!exactKeys(model, MODEL_KEYS)) { errors.push('model_keys_invalid'); return false; }
  const value = model as Record<string, unknown>;
  if (!exactKeys(value.revision, ['id', 'sha256'])) errors.push('model_revision_invalid');
  else if (!isId((value.revision as Record<string, unknown>).id) || !isHash((value.revision as Record<string, unknown>).sha256)) errors.push('model_revision_invalid');
  for (const key of ['modelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256', 'drawingScheduleSha256']) if (!isHash(value[key])) errors.push(`model_${key}_invalid`);
  if (value.sourceStatus !== 'AUTHORITATIVE') errors.push('model_source_preview_blocker');
  return errors.length === before;
}

export function validateBuildingCoreDeliverableBinding(
  input: unknown,
  expected: { projectId?: string; modelRevision?: SpatialRevisionHash; modelSha256?: string } = {},
): BuildingCoreBindingValidation {
  const errors: string[] = [];
  if (!exactKeys(input, BINDING_KEYS)) return { valid: false, status: 'HOLD', errors: ['binding_keys_invalid'] };
  const binding = input as BuildingCoreDeliverableBinding;
  if (binding.schema !== 'nexyfab.cad.building-core-deliverable-binding.v1') errors.push('schema_invalid');
  if (binding.domain !== 'building') errors.push('building_domain_required');
  if (!isId(binding.projectId)) errors.push('project_id_invalid');
  const modelValid = validateModel(binding.model, errors);
  const sourceValid = validateSource(binding.authoritativeSource, errors);
  const model = binding.model as unknown as Record<string, unknown>;
  const manifest = validateBuildingCoreDeliverableManifest(binding.manifest, {
    projectRevision: isRecord(model?.revision) && typeof model.revision.id === 'string' ? model.revision.id : undefined,
    modelContentHash: typeof model?.modelSha256 === 'string' ? model.modelSha256 : undefined,
  });
  errors.push(...manifest.errors.map((error) => `manifest:${error}`));

  const spatial = validateSpatialDeliverableBinding(binding.spatialMinimum, {
    projectId: binding.projectId,
    modelRevision: model?.revision as SpatialRevisionHash,
    modelSha256: typeof model?.modelSha256 === 'string' ? model.modelSha256 : undefined,
  });
  if (!spatial.valid) errors.push(...spatial.errors.map((error) => `spatial_minimum:${error}`));

  const roundTrip = binding.independentIfcRoundTrip;
  if (!exactKeys(roundTrip, ROUNDTRIP_KEYS)) errors.push('ifc_roundtrip_keys_invalid');
  if (roundTrip?.exchangeKind !== 'ifc') errors.push('ifc_roundtrip_kind_invalid');
  if (roundTrip?.status !== 'VERIFIED') errors.push(`ifc_roundtrip_status_${String(roundTrip?.status).toLowerCase()}_blocker`);
  if (roundTrip?.independent !== true) errors.push('ifc_roundtrip_independence_required');
  if (!isId(roundTrip?.independentValidatorId)) errors.push('ifc_roundtrip_validator_invalid');
  for (const key of ['receiptSha256', 'exchangeContentSha256', 'sourceModelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256', 'semanticRoundTripSha256', 'geometryRoundTripSha256'] as const) if (!isHash(roundTrip?.[key])) errors.push(`ifc_roundtrip_${key}_invalid`);
  if (modelValid && sourceValid && exactKeys(roundTrip, ROUNDTRIP_KEYS)) {
    if (!sameRevision(binding.authoritativeSource.revision, model.revision)) errors.push('authoritative_source_revision_stale');
    if (!sameRevision(roundTrip.sourceRevision, model.revision)) errors.push('ifc_roundtrip_revision_stale');
    if (roundTrip.sourceModelSha256 !== model.modelSha256) errors.push('ifc_roundtrip_model_hash_mismatch');
    if (roundTrip.semanticObjectGraphSha256 !== model.semanticObjectGraphSha256) errors.push('ifc_roundtrip_semantic_graph_mismatch');
    if (roundTrip.coordinateFrameSha256 !== model.coordinateFrameSha256) errors.push('ifc_roundtrip_coordinate_frame_mismatch');
    if (roundTrip.quantitySha256 !== model.quantitySha256) errors.push('ifc_roundtrip_quantity_hash_mismatch');
    const ifc = binding.manifest?.deliverables?.find((item) => item.kind === 'ifc');
    if (ifc && roundTrip.exchangeContentSha256 !== ifc.contentSha256) errors.push('ifc_roundtrip_content_hash_mismatch');
  }
  if (expected.projectId !== undefined && binding.projectId !== expected.projectId) errors.push('project_stale');
  if (expected.modelSha256 !== undefined && model?.modelSha256 !== expected.modelSha256) errors.push('model_stale');
  if (expected.modelRevision && !sameRevision(model?.revision, expected.modelRevision)) errors.push('revision_stale');
  const unique = [...new Set(errors)];
  if (unique.length) return { valid: false, status: unique.some((error) => error.includes('stale') || error.includes('mismatch')) ? 'STALE' : 'HOLD', errors: unique };
  return { valid: true, status: 'VERIFIED', errors: [], canonicalSha256: hashBuildingCoreDeliverableBinding(binding) };
}

export function canonicalBuildingCoreDeliverableBindingJson(binding: BuildingCoreDeliverableBinding): string {
  const result = validateBuildingCoreDeliverableBinding(binding);
  if (!result.valid) throw new Error(`invalid_building_core_deliverable_binding:${result.errors.join(',')}`);
  return stableJson(binding);
}

export function hashBuildingCoreDeliverableBinding(binding: BuildingCoreDeliverableBinding): string {
  return createHash('sha256').update(stableJson(binding), 'utf8').digest('hex');
}

// Short aliases keep the product API consistent with the other domain packages.
export const createBuildingDeliverableManifest = createBuildingCoreDeliverableManifest;
export const validateBuildingDeliverableManifest = validateBuildingCoreDeliverableManifest;
