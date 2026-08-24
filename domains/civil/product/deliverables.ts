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
  type SpatialModelIdentity,
} from '../../../src/lib/cad/spatialDeliverableBinding';

/**
 * The civil product is intentionally stricter than the common three-file
 * spatial minimum.  A consumer must receive the complete survey-to-construction
 * package; a partial package is not a delivery candidate.
 */
export const CIVIL_SITE_DELIVERABLE_KINDS = [
  'native-civil-project', 'survey-control-report', 'existing-surface-tin',
  'proposed-surface-tin', 'alignment-profile-sheets', 'cross-section-package',
  'corridor-grading-package', 'drainage-hydraulic-report', 'earthwork-quantity-report',
  'quantity-schedule', 'construction-stage-package', 'landxml',
  'coordination-report', 'verification-receipt',
] as const;
export type CivilSiteDeliverableKind = typeof CIVIL_SITE_DELIVERABLE_KINDS[number];

const FORMAT_BY_KIND: Record<CivilSiteDeliverableKind, DomainDeliverable['format']> = {
  'native-civil-project': 'json', 'survey-control-report': 'pdf',
  'existing-surface-tin': 'landxml', 'proposed-surface-tin': 'landxml',
  'alignment-profile-sheets': 'drawing', 'cross-section-package': 'drawing',
  'corridor-grading-package': 'drawing', 'drainage-hydraulic-report': 'pdf',
  'earthwork-quantity-report': 'pdf', 'quantity-schedule': 'quantity-schedule',
  'construction-stage-package': 'pdf', landxml: 'landxml',
  'coordination-report': 'pdf', 'verification-receipt': 'json',
};
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sameSequence = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export type CivilSiteDeliverableManifest = DomainDeliverableManifest & {
  domain: 'civil'; requiredDeliverableKinds: CivilSiteDeliverableKind[];
};
export interface CivilSiteManifestExpectations { projectRevision?: string; modelContentHash?: string }
export interface CivilSiteManifestValidation { valid: boolean; errors: string[] }

export function createCivilSiteDeliverableManifest(
  input: Omit<CivilSiteDeliverableManifest, 'schema' | 'domain' | 'requiredDeliverableKinds'>,
): CivilSiteDeliverableManifest {
  return createDomainDeliverableManifest({
    ...input, domain: 'civil', requiredDeliverableKinds: [...CIVIL_SITE_DELIVERABLE_KINDS],
  }) as CivilSiteDeliverableManifest;
}

export function validateCivilSiteDeliverableManifest(
  input: unknown,
  expectations: CivilSiteManifestExpectations = {},
): CivilSiteManifestValidation {
  const common = validateDomainDeliverableManifest(input);
  const errors = [...common.errors];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: [...new Set(errors)] };
  const m = input as Partial<CivilSiteDeliverableManifest>;
  if (m.domain !== 'civil') errors.push('civil_domain_required');
  if (!Array.isArray(m.requiredDeliverableKinds) || !sameSequence(m.requiredDeliverableKinds, CIVIL_SITE_DELIVERABLE_KINDS)) {
    errors.push('civil_required_kinds_exact_mismatch');
  }
  if (expectations.projectRevision !== undefined && m.projectRevision !== expectations.projectRevision) errors.push('civil_project_revision_mismatch');
  if (expectations.modelContentHash !== undefined && m.modelContentHash !== expectations.modelContentHash) errors.push('civil_model_content_hash_mismatch');
  const byKind = new Map<string, DomainDeliverable>();
  for (const item of Array.isArray(m.deliverables) ? m.deliverables : []) {
    if (!item || typeof item !== 'object' || typeof item.kind !== 'string') continue;
    if (!CIVIL_SITE_DELIVERABLE_KINDS.includes(item.kind as CivilSiteDeliverableKind)) errors.push(`civil_unknown_deliverable_kind:${item.kind}`);
    else {
      if (byKind.has(item.kind)) errors.push(`civil_duplicate_deliverable:${item.kind}`);
      byKind.set(item.kind, item as DomainDeliverable);
      if (item.format !== FORMAT_BY_KIND[item.kind as CivilSiteDeliverableKind]) errors.push(`civil_format_mismatch:${item.kind}`);
      if (item.sourceRevision !== m.projectRevision) errors.push(`civil_stale_deliverable:${item.kind}`);
      if (item.verificationStatus !== 'verified') errors.push(`civil_unverified_deliverable:${item.kind}`);
    }
  }
  for (const kind of CIVIL_SITE_DELIVERABLE_KINDS) if (!byKind.has(kind)) errors.push(`civil_required_deliverable_missing:${kind}`);
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export interface CivilSurveyAuthority {
  sourceId: string;
  sourceKind: 'SURVEY_TIN';
  sourceRevision: SpatialRevisionHash;
  surveyDataSha256: string;
  controlNetworkSha256: string;
  rightsReceiptSha256: string;
  capturedAt: string;
  reviewedAt: string;
  commercialUseAllowed: true;
  status: 'VERIFIED';
}

export interface CivilModelIdentity extends SpatialModelIdentity { geometrySha256: string }
export interface CivilLandXmlRoundTrip {
  receiptSha256: string;
  exchangeContentSha256: string;
  exchangeKind: 'landxml';
  sourceRevision: SpatialRevisionHash;
  sourceModelSha256: string;
  semanticObjectGraphSha256: string;
  coordinateFrameSha256: string;
  quantitySha256: string;
  geometrySha256: string;
  semanticRoundTripSha256: string;
  geometryRoundTripSha256: string;
  quantityRoundTripSha256: string;
  independentValidatorId: string;
  independent: true;
  status: 'VERIFIED' | 'NOT_RUN' | 'HOLD' | 'FAIL' | 'STALE';
}
export interface CivilSiteDeliverableBinding {
  schema: 'nexyfab.cad.civil-site-deliverable-binding.v1';
  domain: 'civil';
  projectId: string;
  manifest: CivilSiteDeliverableManifest;
  manifestSha256: string;
  model: CivilModelIdentity;
  surveyAuthority: CivilSurveyAuthority;
  spatialMinimum: SpatialDeliverableBinding;
  independentLandXmlRoundTrip: CivilLandXmlRoundTrip;
}
export interface CivilSiteBindingValidation { valid: boolean; status: 'VERIFIED' | 'HOLD' | 'STALE'; errors: string[]; canonicalSha256?: string }

const exact = (v: unknown, keys: readonly string[]) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === 'string' && SHA.test(v);
const revisionEqual = (a: unknown, b: SpatialRevisionHash) => record(a) && a.id === b.id && a.sha256 === b.sha256;
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : record(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';

export function hashCivilSiteDeliverableManifest(manifest: CivilSiteDeliverableManifest): string {
  return createHash('sha256').update(stable(manifest), 'utf8').digest('hex');
}

export function validateCivilSiteDeliverableBinding(
  input: unknown,
  expected: { projectId?: string; modelRevision?: SpatialRevisionHash; modelSha256?: string } = {},
): CivilSiteBindingValidation {
  const errors: string[] = [];
  const keys = ['schema', 'domain', 'projectId', 'manifest', 'manifestSha256', 'model', 'surveyAuthority', 'spatialMinimum', 'independentLandXmlRoundTrip'] as const;
  if (!exact(input, keys)) return { valid: false, status: 'HOLD', errors: ['binding_keys_invalid'] };
  const b = input as CivilSiteDeliverableBinding;
  if (b.schema !== 'nexyfab.cad.civil-site-deliverable-binding.v1') errors.push('schema_invalid');
  if (b.domain !== 'civil') errors.push('civil_domain_required');
  if (typeof b.projectId !== 'string' || !ID.test(b.projectId)) errors.push('project_id_invalid');
  if (!hash(b.manifestSha256)) errors.push('manifest_hash_invalid');
  const manifest = validateCivilSiteDeliverableManifest(b.manifest, { projectRevision: b.model?.revision?.id, modelContentHash: b.model?.modelSha256 });
  errors.push(...manifest.errors.map(e => `manifest:${e}`));
  if (hash(b.manifestSha256)) {
    if (hashCivilSiteDeliverableManifest(b.manifest) !== b.manifestSha256) errors.push('manifest_hash_mismatch');
  }
  const modelKeys = ['revision', 'modelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256', 'drawingScheduleSha256', 'sourceStatus', 'geometrySha256'] as const;
  if (!exact(b.model, modelKeys)) errors.push('model_keys_invalid');
  if (b.model?.sourceStatus !== 'AUTHORITATIVE') errors.push('model_source_preview_blocker');
  for (const k of ['modelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256', 'drawingScheduleSha256', 'geometrySha256'] as const) if (!hash(b.model?.[k])) errors.push(`model_${k}_invalid`);
  if (!record(b.model?.revision) || !ID.test(String(b.model.revision.id)) || !hash(b.model.revision.sha256)) errors.push('model_revision_invalid');

  const surveyKeys = ['sourceId', 'sourceKind', 'sourceRevision', 'surveyDataSha256', 'controlNetworkSha256', 'rightsReceiptSha256', 'capturedAt', 'reviewedAt', 'commercialUseAllowed', 'status'] as const;
  if (!exact(b.surveyAuthority, surveyKeys)) errors.push('survey_authority_keys_invalid');
  const survey = b.surveyAuthority;
  if (typeof survey.sourceId !== 'string' || !ID.test(survey.sourceId)) errors.push('survey_source_id_invalid');
  if (survey.sourceKind !== 'SURVEY_TIN') errors.push('survey_source_kind_invalid');
  if (!revisionEqual(survey.sourceRevision, b.model.revision)) errors.push('survey_revision_stale');
  for (const k of ['surveyDataSha256', 'controlNetworkSha256', 'rightsReceiptSha256'] as const) if (!hash(survey[k])) errors.push(`survey_${k}_invalid`);
  if (survey.commercialUseAllowed !== true) errors.push('survey_rights_not_commercial');
  if (survey.status !== 'VERIFIED') errors.push(`survey_status_${String(survey.status).toLowerCase()}_blocker`);
  const capturedAt = typeof survey.capturedAt === 'string' ? Date.parse(survey.capturedAt) : Number.NaN;
  const reviewedAt = typeof survey.reviewedAt === 'string' ? Date.parse(survey.reviewedAt) : Number.NaN;
  if (!Number.isFinite(capturedAt) || !Number.isFinite(reviewedAt) || reviewedAt < capturedAt) errors.push('survey_review_dates_invalid');

  const spatial = validateSpatialDeliverableBinding(b.spatialMinimum, { projectId: b.projectId, modelRevision: b.model?.revision, modelSha256: b.model?.modelSha256 });
  if (!spatial.valid) errors.push(...spatial.errors.map(e => `spatial_minimum:${e}`));
  const rt = b.independentLandXmlRoundTrip;
  const rtKeys = ['receiptSha256', 'exchangeContentSha256', 'exchangeKind', 'sourceRevision', 'sourceModelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256', 'geometrySha256', 'semanticRoundTripSha256', 'geometryRoundTripSha256', 'quantityRoundTripSha256', 'independentValidatorId', 'independent', 'status'] as const;
  if (!exact(rt, rtKeys)) errors.push('landxml_roundtrip_keys_invalid');
  if (rt.exchangeKind !== 'landxml') errors.push('landxml_roundtrip_kind_invalid');
  if (rt.status !== 'VERIFIED') errors.push(`landxml_roundtrip_status_${String(rt.status).toLowerCase()}_blocker`);
  if (rt.independent !== true) errors.push('landxml_roundtrip_independence_required');
  if (typeof rt.independentValidatorId !== 'string' || !ID.test(rt.independentValidatorId)) errors.push('landxml_roundtrip_validator_invalid');
  for (const k of ['receiptSha256', 'exchangeContentSha256', 'sourceModelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256', 'geometrySha256', 'semanticRoundTripSha256', 'geometryRoundTripSha256', 'quantityRoundTripSha256'] as const) if (!hash(rt[k])) errors.push(`landxml_roundtrip_${k}_invalid`);
  if (record(b.model) && record(rt)) {
    if (!revisionEqual(rt.sourceRevision, b.model.revision)) errors.push('landxml_roundtrip_revision_stale');
    if (rt.sourceModelSha256 !== b.model.modelSha256) errors.push('landxml_roundtrip_model_hash_mismatch');
    for (const [key, error] of [['semanticObjectGraphSha256', 'landxml_roundtrip_semantic_graph_mismatch'], ['coordinateFrameSha256', 'landxml_roundtrip_coordinate_frame_mismatch'], ['quantitySha256', 'landxml_roundtrip_quantity_hash_mismatch'], ['geometrySha256', 'landxml_roundtrip_geometry_hash_mismatch']] as const) if (rt[key] !== b.model[key]) errors.push(error);
    const landxml = b.manifest?.deliverables?.find(d => d.kind === 'landxml');
    if (landxml && rt.exchangeContentSha256 !== landxml.contentSha256) errors.push('landxml_roundtrip_content_hash_mismatch');
  }
  if (expected.projectId !== undefined && b.projectId !== expected.projectId) errors.push('project_stale');
  if (expected.modelSha256 !== undefined && b.model?.modelSha256 !== expected.modelSha256) errors.push('model_stale');
  if (expected.modelRevision && !revisionEqual(b.model?.revision, expected.modelRevision)) errors.push('revision_stale');
  const unique = [...new Set(errors)];
  if (unique.length) return { valid: false, status: unique.some(e => e.includes('stale') || e.includes('mismatch')) ? 'STALE' : 'HOLD', errors: unique };
  return { valid: true, status: 'VERIFIED', errors: [], canonicalSha256: createHash('sha256').update(stable(b), 'utf8').digest('hex') };
}
