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
  type SpatialRevisionHash,
} from '../../../src/lib/cad/spatialDeliverableBinding';

/**
 * The landscape package is a complete, construction-facing site package.
 * A common three-file spatial minimum is not sufficient to release planting,
 * grading, irrigation, or maintenance information.
 */
export const LANDSCAPE_SITE_DELIVERABLE_KINDS = [
  'native-landscape-project',
  'grading-plan',
  'drainage-plan',
  'hardscape-accessibility-plan',
  'planting-plan',
  'irrigation-plan',
  'planting-schedule',
  'irrigation-schedule',
  'soil-hardscape-quantity-schedule',
  'boq',
  'maintenance-plan',
  'coordination-report',
  'site-model-exchange',
  'verification-receipt',
] as const;
export type LandscapeSiteDeliverableKind = typeof LANDSCAPE_SITE_DELIVERABLE_KINDS[number];

const FORMAT_BY_KIND: Record<LandscapeSiteDeliverableKind, DomainDeliverable['format']> = {
  'native-landscape-project': 'json',
  'grading-plan': 'drawing',
  'drainage-plan': 'drawing',
  'hardscape-accessibility-plan': 'drawing',
  'planting-plan': 'planting-plan',
  'irrigation-plan': 'irrigation-plan',
  'planting-schedule': 'schedule',
  'irrigation-schedule': 'schedule',
  'soil-hardscape-quantity-schedule': 'quantity-schedule',
  boq: 'csv',
  'maintenance-plan': 'drawing',
  'coordination-report': 'pdf',
  'site-model-exchange': 'site-model',
  'verification-receipt': 'json',
};

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sameSequence = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export interface LandscapeSiteManifestExpectations {
  projectRevision?: string;
  modelContentHash?: string;
}
export interface LandscapeSiteManifestValidation { valid: boolean; errors: string[] }
export type LandscapeSiteDeliverableManifest = DomainDeliverableManifest & {
  domain: 'landscape';
  requiredDeliverableKinds: LandscapeSiteDeliverableKind[];
};

export function createLandscapeSiteDeliverableManifest(
  input: Omit<LandscapeSiteDeliverableManifest, 'schema' | 'domain' | 'requiredDeliverableKinds'>,
): LandscapeSiteDeliverableManifest {
  return createDomainDeliverableManifest({
    ...input,
    domain: 'landscape',
    requiredDeliverableKinds: [...LANDSCAPE_SITE_DELIVERABLE_KINDS],
  }) as LandscapeSiteDeliverableManifest;
}

export function validateLandscapeSiteDeliverableManifest(
  input: unknown,
  expectations: LandscapeSiteManifestExpectations = {},
): LandscapeSiteManifestValidation {
  const common = validateDomainDeliverableManifest(input);
  const errors = [...common.errors];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: [...new Set(errors)] };
  const manifest = input as Partial<LandscapeSiteDeliverableManifest>;
  if (manifest.domain !== 'landscape') errors.push('landscape_domain_required');
  if (!Array.isArray(manifest.requiredDeliverableKinds) || !sameSequence(manifest.requiredDeliverableKinds, LANDSCAPE_SITE_DELIVERABLE_KINDS)) {
    errors.push('landscape_required_kinds_exact_mismatch');
  }
  if (expectations.projectRevision !== undefined && manifest.projectRevision !== expectations.projectRevision) errors.push('landscape_project_revision_mismatch');
  if (expectations.modelContentHash !== undefined && manifest.modelContentHash !== expectations.modelContentHash) errors.push('landscape_model_content_hash_mismatch');
  const seen = new Set<string>();
  for (const item of Array.isArray(manifest.deliverables) ? manifest.deliverables : []) {
    if (!item || typeof item !== 'object' || typeof item.kind !== 'string') continue;
    if (!LANDSCAPE_SITE_DELIVERABLE_KINDS.includes(item.kind as LandscapeSiteDeliverableKind)) {
      errors.push(`landscape_unknown_deliverable_kind:${item.kind}`);
      continue;
    }
    if (seen.has(item.kind)) errors.push(`landscape_duplicate_deliverable_kind:${item.kind}`);
    seen.add(item.kind);
    if (item.format !== FORMAT_BY_KIND[item.kind as LandscapeSiteDeliverableKind]) errors.push(`landscape_format_mismatch:${item.kind}`);
    if (item.sourceRevision !== manifest.projectRevision) errors.push(`landscape_stale_deliverable:${item.kind}`);
    if (item.verificationStatus !== 'verified') errors.push(`landscape_unverified_deliverable:${item.kind}`);
  }
  for (const kind of LANDSCAPE_SITE_DELIVERABLE_KINDS) if (!seen.has(kind)) errors.push(`landscape_required_deliverable_missing:${kind}`);
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export interface LandscapeAuthoritativeSource {
  id: string;
  sourceKind: 'SURVEY_TIN' | 'CATALOG' | 'HYDRAULIC';
  revision: SpatialRevisionHash;
  sha256: string;
  rightsReceiptSha256: string;
  reviewStatus: 'APPROVED';
  commercialUse: true;
  status: 'VERIFIED';
}

export interface LandscapeModelIdentity {
  revision: SpatialRevisionHash;
  modelSha256: string;
  semanticObjectGraphSha256: string;
  coordinateFrameSha256: string;
  terrainSha256: string;
  geometrySha256: string;
  quantitySha256: string;
  drawingScheduleSha256: string;
  sourceStatus: 'AUTHORITATIVE';
}

export interface LandscapeSiteModelRoundTrip {
  receiptSha256: string;
  exchangeKind: 'site-model';
  nativeFormat: 'ifc';
  exchangeContentSha256: string;
  sourceRevision: SpatialRevisionHash;
  sourceModelSha256: string;
  semanticObjectGraphSha256: string;
  coordinateFrameSha256: string;
  terrainSha256: string;
  geometrySha256: string;
  quantitySha256: string;
  semanticRoundTripSha256: string;
  geometryRoundTripSha256: string;
  quantityRoundTripSha256: string;
  independentValidatorId: string;
  independent: true;
  status: 'VERIFIED' | 'NOT_RUN' | 'HOLD' | 'FAIL' | 'STALE';
}

export interface LandscapeSiteDeliverableBinding {
  schema: 'nexyfab.cad.landscape-site-deliverable-binding.v1';
  domain: 'landscape';
  projectId: string;
  manifest: LandscapeSiteDeliverableManifest;
  manifestSha256: string;
  model: LandscapeModelIdentity;
  terrainAuthority: LandscapeAuthoritativeSource;
  catalogAuthority: LandscapeAuthoritativeSource;
  hydraulicAuthority: LandscapeAuthoritativeSource;
  spatialMinimum: SpatialDeliverableBinding;
  independentSiteModelRoundTrip: LandscapeSiteModelRoundTrip;
}

export interface LandscapeSiteBindingValidation {
  valid: boolean;
  status: 'VERIFIED' | 'HOLD' | 'STALE';
  errors: string[];
  canonicalSha256?: string;
}

const BINDING_KEYS = ['schema', 'domain', 'projectId', 'manifest', 'manifestSha256', 'model', 'terrainAuthority', 'catalogAuthority', 'hydraulicAuthority', 'spatialMinimum', 'independentSiteModelRoundTrip'] as const;
const MODEL_KEYS = ['revision', 'modelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'terrainSha256', 'geometrySha256', 'quantitySha256', 'drawingScheduleSha256', 'sourceStatus'] as const;
const SOURCE_KEYS = ['id', 'sourceKind', 'revision', 'sha256', 'rightsReceiptSha256', 'reviewStatus', 'commercialUse', 'status'] as const;
const ROUNDTRIP_KEYS = ['receiptSha256', 'exchangeKind', 'nativeFormat', 'exchangeContentSha256', 'sourceRevision', 'sourceModelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'terrainSha256', 'geometrySha256', 'quantitySha256', 'semanticRoundTripSha256', 'geometryRoundTripSha256', 'quantityRoundTripSha256', 'independentValidatorId', 'independent', 'status'] as const;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, keys: readonly string[]) => isRecord(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
const isHash = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value);
const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
const stable = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(stable).join(',')}]`
  : isRecord(value)
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';
const sameRevision = (a: unknown, b: unknown): boolean => isRecord(a) && isRecord(b) && a.id === b.id && a.sha256 === b.sha256;

function validateSource(source: unknown, expectedKind: LandscapeAuthoritativeSource['sourceKind'], modelRevision: unknown, errors: string[], label: string): void {
  if (!exact(source, SOURCE_KEYS)) { errors.push(`${label}_keys_invalid`); return; }
  const value = source as Record<string, unknown>;
  if (!isId(value.id)) errors.push(`${label}_id_invalid`);
  if (value.sourceKind !== expectedKind) errors.push(`${label}_kind_invalid`);
  if (!exact(value.revision, ['id', 'sha256']) || !isId((value.revision as Record<string, unknown> | undefined)?.id) || !isHash((value.revision as Record<string, unknown> | undefined)?.sha256)) errors.push(`${label}_revision_invalid`);
  if (modelRevision && !sameRevision(value.revision, modelRevision)) errors.push(`${label}_revision_stale`);
  if (!isHash(value.sha256)) errors.push(`${label}_hash_invalid`);
  if (!isHash(value.rightsReceiptSha256)) errors.push(`${label}_rights_receipt_invalid`);
  if (value.reviewStatus !== 'APPROVED') errors.push(`${label}_not_approved`);
  if (value.commercialUse !== true) errors.push(`${label}_commercial_use_required`);
  if (value.status !== 'VERIFIED') errors.push(`${label}_status_${String(value.status).toLowerCase()}_blocker`);
}

export function hashLandscapeSiteDeliverableManifest(manifest: LandscapeSiteDeliverableManifest): string {
  return createHash('sha256').update(stable(manifest), 'utf8').digest('hex');
}

export function validateLandscapeSiteDeliverableBinding(
  input: unknown,
  expected: { projectId?: string; modelRevision?: SpatialRevisionHash; modelSha256?: string } = {},
): LandscapeSiteBindingValidation {
  const errors: string[] = [];
  if (!exact(input, BINDING_KEYS)) return { valid: false, status: 'HOLD', errors: ['binding_keys_invalid'] };
  const binding = input as LandscapeSiteDeliverableBinding;
  if (binding.schema !== 'nexyfab.cad.landscape-site-deliverable-binding.v1') errors.push('schema_invalid');
  if (binding.domain !== 'landscape') errors.push('landscape_domain_required');
  if (!isId(binding.projectId)) errors.push('project_id_invalid');
  if (!isHash(binding.manifestSha256)) errors.push('manifest_hash_invalid');
  const model = binding.model as unknown as Record<string, unknown>;
  const modelRevision = isRecord(model?.revision) ? model.revision : undefined;
  if (!exact(binding.model, MODEL_KEYS)) errors.push('model_keys_invalid');
  if (!modelRevision || !isId(modelRevision.id) || !isHash(modelRevision.sha256)) errors.push('model_revision_invalid');
  for (const key of ['modelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'terrainSha256', 'geometrySha256', 'quantitySha256', 'drawingScheduleSha256'] as const) if (!isHash(model?.[key])) errors.push(`model_${key}_invalid`);
  if (model?.sourceStatus !== 'AUTHORITATIVE') errors.push('model_source_preview_blocker');
  const manifest = validateLandscapeSiteDeliverableManifest(binding.manifest, {
    projectRevision: modelRevision && isId(modelRevision.id) ? modelRevision.id : undefined,
    modelContentHash: isHash(model?.modelSha256) ? model.modelSha256 : undefined,
  });
  errors.push(...manifest.errors.map((error) => `manifest:${error}`));
  if (isHash(binding.manifestSha256) && hashLandscapeSiteDeliverableManifest(binding.manifest) !== binding.manifestSha256) errors.push('manifest_hash_mismatch');
  validateSource(binding.terrainAuthority, 'SURVEY_TIN', modelRevision, errors, 'terrain_authority');
  validateSource(binding.catalogAuthority, 'CATALOG', modelRevision, errors, 'catalog_authority');
  validateSource(binding.hydraulicAuthority, 'HYDRAULIC', modelRevision, errors, 'hydraulic_authority');
  if (isHash(model?.terrainSha256) && binding.terrainAuthority?.sha256 !== model.terrainSha256) errors.push('terrain_authority_model_hash_mismatch');
  const spatial = validateSpatialDeliverableBinding(binding.spatialMinimum, { projectId: binding.projectId, modelRevision: model?.revision as SpatialRevisionHash, modelSha256: model?.modelSha256 as string });
  if (!spatial.valid) errors.push(...spatial.errors.map((error) => `spatial_minimum:${error}`));
  const roundTrip = binding.independentSiteModelRoundTrip;
  if (!exact(roundTrip, ROUNDTRIP_KEYS)) errors.push('site_model_roundtrip_keys_invalid');
  if (roundTrip?.exchangeKind !== 'site-model') errors.push('site_model_roundtrip_kind_invalid');
  if (roundTrip?.nativeFormat !== 'ifc') errors.push('site_model_roundtrip_native_format_invalid');
  if (roundTrip?.status !== 'VERIFIED') errors.push(`site_model_roundtrip_status_${String(roundTrip?.status).toLowerCase()}_blocker`);
  if (roundTrip?.independent !== true) errors.push('site_model_roundtrip_independence_required');
  if (!isId(roundTrip?.independentValidatorId)) errors.push('site_model_roundtrip_validator_invalid');
  for (const key of ['receiptSha256', 'exchangeContentSha256', 'sourceModelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'terrainSha256', 'geometrySha256', 'quantitySha256', 'semanticRoundTripSha256', 'geometryRoundTripSha256', 'quantityRoundTripSha256'] as const) if (!isHash(roundTrip?.[key])) errors.push(`site_model_roundtrip_${key}_invalid`);
  if (isRecord(model) && isRecord(roundTrip)) {
    if (!sameRevision(roundTrip.sourceRevision, model.revision)) errors.push('site_model_roundtrip_revision_stale');
    if (roundTrip.sourceModelSha256 !== model.modelSha256) errors.push('site_model_roundtrip_model_hash_mismatch');
    for (const [key, error] of [['semanticObjectGraphSha256', 'site_model_roundtrip_semantic_graph_mismatch'], ['coordinateFrameSha256', 'site_model_roundtrip_coordinate_frame_mismatch'], ['terrainSha256', 'site_model_roundtrip_terrain_mismatch'], ['geometrySha256', 'site_model_roundtrip_geometry_hash_mismatch'], ['quantitySha256', 'site_model_roundtrip_quantity_hash_mismatch']] as const) if (roundTrip[key] !== model[key]) errors.push(error);
    const exchange = binding.manifest?.deliverables?.find((item) => item.kind === 'site-model-exchange');
    if (exchange && roundTrip.exchangeContentSha256 !== exchange.contentSha256) errors.push('site_model_roundtrip_content_hash_mismatch');
  }
  if (expected.projectId !== undefined && binding.projectId !== expected.projectId) errors.push('project_stale');
  if (expected.modelSha256 !== undefined && model?.modelSha256 !== expected.modelSha256) errors.push('model_stale');
  if (expected.modelRevision && !sameRevision(model?.revision, expected.modelRevision)) errors.push('revision_stale');
  const unique = [...new Set(errors)];
  if (unique.length) return { valid: false, status: unique.some((error) => error.includes('stale') || error.includes('mismatch')) ? 'STALE' : 'HOLD', errors: unique };
  return { valid: true, status: 'VERIFIED', errors: [], canonicalSha256: hashLandscapeSiteDeliverableBinding(binding) };
}

export function canonicalLandscapeSiteDeliverableBindingJson(binding: LandscapeSiteDeliverableBinding): string {
  const result = validateLandscapeSiteDeliverableBinding(binding);
  if (!result.valid) throw new Error(`invalid_landscape_site_deliverable_binding:${result.errors.join(',')}`);
  return stable(binding);
}

export function hashLandscapeSiteDeliverableBinding(binding: LandscapeSiteDeliverableBinding): string {
  return createHash('sha256').update(stable(binding), 'utf8').digest('hex');
}
