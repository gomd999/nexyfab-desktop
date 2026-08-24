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
  type SpatialRoundTripReceipt,
} from '../../../src/lib/cad/spatialDeliverableBinding';

export const INTERIOR_FIT_OUT_DELIVERABLE_KINDS = [
  'native-interior-document', 'layout-plan', 'reflected-ceiling-plan', 'elevations',
  'millwork-details', 'finish-schedule', 'ffe-schedule', 'boq', 'ifc',
  'coordination-report', 'verification-receipt',
] as const;
export type InteriorFitOutDeliverableKind = typeof INTERIOR_FIT_OUT_DELIVERABLE_KINDS[number];

const FORMAT_BY_KIND: Record<InteriorFitOutDeliverableKind, DomainDeliverable['format']> = {
  'native-interior-document': 'json', 'layout-plan': 'drawing',
  'reflected-ceiling-plan': 'drawing', elevations: 'drawing',
  'millwork-details': 'drawing', 'finish-schedule': 'finish-schedule',
  'ffe-schedule': 'schedule', boq: 'csv', ifc: 'ifc',
  'coordination-report': 'pdf', 'verification-receipt': 'json',
};
const sameSequence = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface InteriorFitOutManifestExpectations { projectRevision?: string; modelContentHash?: string }
export interface InteriorFitOutManifestValidation { valid: boolean; errors: string[] }
export type InteriorFitOutDeliverableManifest = DomainDeliverableManifest & {
  domain: 'interior'; requiredDeliverableKinds: InteriorFitOutDeliverableKind[];
};

export function createInteriorFitOutDeliverableManifest(
  input: Omit<InteriorFitOutDeliverableManifest, 'schema' | 'domain' | 'requiredDeliverableKinds'>,
): InteriorFitOutDeliverableManifest {
  return createDomainDeliverableManifest({ ...input, domain: 'interior', requiredDeliverableKinds: [...INTERIOR_FIT_OUT_DELIVERABLE_KINDS] }) as InteriorFitOutDeliverableManifest;
}

export function validateInteriorFitOutDeliverableManifest(input: unknown, expectations: InteriorFitOutManifestExpectations = {}): InteriorFitOutManifestValidation {
  const common = validateDomainDeliverableManifest(input);
  const errors = [...common.errors];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: [...new Set(errors)] };
  const m = input as Partial<InteriorFitOutDeliverableManifest>;
  if (m.domain !== 'interior') errors.push('interior_domain_required');
  if (!Array.isArray(m.requiredDeliverableKinds) || !sameSequence(m.requiredDeliverableKinds, INTERIOR_FIT_OUT_DELIVERABLE_KINDS)) errors.push('interior_required_kinds_exact_mismatch');
  if (expectations.projectRevision !== undefined && m.projectRevision !== expectations.projectRevision) errors.push('interior_project_revision_mismatch');
  if (expectations.modelContentHash !== undefined && m.modelContentHash !== expectations.modelContentHash) errors.push('interior_model_content_hash_mismatch');
  const byKind = new Map<string, DomainDeliverable>();
  for (const item of Array.isArray(m.deliverables) ? m.deliverables : []) {
    if (!item || typeof item !== 'object' || typeof item.kind !== 'string') continue;
    if (!INTERIOR_FIT_OUT_DELIVERABLE_KINDS.includes(item.kind as InteriorFitOutDeliverableKind)) errors.push(`interior_unknown_deliverable_kind:${item.kind}`);
    else {
      byKind.set(item.kind, item as DomainDeliverable);
      if (item.format !== FORMAT_BY_KIND[item.kind as InteriorFitOutDeliverableKind]) errors.push(`interior_format_mismatch:${item.kind}`);
      if (item.sourceRevision !== m.projectRevision) errors.push(`interior_stale_deliverable:${item.kind}`);
      if (item.verificationStatus !== 'verified') errors.push(`interior_unverified_deliverable:${item.kind}`);
    }
  }
  for (const kind of INTERIOR_FIT_OUT_DELIVERABLE_KINDS) if (!byKind.has(kind)) errors.push(`interior_required_deliverable_missing:${kind}`);
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export interface InteriorFitOutIndependentIfcRoundTrip extends SpatialRoundTripReceipt { exchangeKind: 'ifc' }
export interface InteriorFitOutDeliverableBinding {
  schema: 'nexyfab.cad.interior-fitout-deliverable-binding.v1';
  domain: 'interior'; projectId: string;
  manifest: InteriorFitOutDeliverableManifest;
  model: SpatialModelIdentity;
  /** Common spatial minimum (space-model, drawing, finish-schedule) is retained as a separately validated projection. */
  spatialMinimum: SpatialDeliverableBinding;
  independentIfcRoundTrip: InteriorFitOutIndependentIfcRoundTrip;
}
export interface InteriorFitOutBindingValidation { valid: boolean; status: 'VERIFIED' | 'HOLD' | 'STALE'; errors: string[]; canonicalSha256?: string }

const exact = (v: unknown, keys: readonly string[]) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';
const hash = (v: unknown): v is string => typeof v === 'string' && SHA.test(v);
const revisionEqual = (a: unknown, b: SpatialRevisionHash) => !!a && typeof a === 'object' && (a as SpatialRevisionHash).id === b.id && (a as SpatialRevisionHash).sha256 === b.sha256;

export function validateInteriorFitOutDeliverableBinding(input: unknown, expected: { projectId?: string; modelRevision?: SpatialRevisionHash; modelSha256?: string } = {}): InteriorFitOutBindingValidation {
  const errors: string[] = [];
  const keys = ['schema', 'domain', 'projectId', 'manifest', 'model', 'spatialMinimum', 'independentIfcRoundTrip'] as const;
  if (!exact(input, keys)) return { valid: false, status: 'HOLD', errors: ['binding_keys_invalid'] };
  const b = input as InteriorFitOutDeliverableBinding;
  if (b.schema !== 'nexyfab.cad.interior-fitout-deliverable-binding.v1') errors.push('schema_invalid');
  if (b.domain !== 'interior') errors.push('interior_domain_required');
  if (typeof b.projectId !== 'string' || !ID.test(b.projectId)) errors.push('project_id_invalid');
  const manifest = validateInteriorFitOutDeliverableManifest(b.manifest, { modelContentHash: b.model?.modelSha256 });
  errors.push(...manifest.errors.map(e => `manifest:${e}`));
  if (!exact(b.model, ['revision', 'modelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256', 'drawingScheduleSha256', 'sourceStatus'])) errors.push('model_keys_invalid');
  if (b.model?.sourceStatus !== 'AUTHORITATIVE') errors.push('model_source_preview_blocker');
  for (const k of ['modelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256', 'drawingScheduleSha256'] as const) if (!hash(b.model?.[k])) errors.push(`model_${k}_invalid`);
  const spatial = validateSpatialDeliverableBinding(b.spatialMinimum, { projectId: b.projectId, modelRevision: b.model?.revision, modelSha256: b.model?.modelSha256 });
  if (!spatial.valid) errors.push(...spatial.errors.map(e => `spatial_minimum:${e}`));
  const rt = b.independentIfcRoundTrip;
  if (!exact(rt, ['receiptSha256', 'exchangeContentSha256', 'sourceRevision', 'sourceModelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256', 'status', 'exchangeKind'])) errors.push('ifc_roundtrip_keys_invalid');
  if (rt?.exchangeKind !== 'ifc') errors.push('ifc_roundtrip_kind_invalid');
  if (rt?.status !== 'VERIFIED') errors.push(`ifc_roundtrip_status_${String(rt?.status).toLowerCase()}_blocker`);
  for (const k of ['receiptSha256', 'exchangeContentSha256', 'sourceModelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256'] as const) if (!hash(rt?.[k])) errors.push(`ifc_roundtrip_${k}_invalid`);
  if (b.model && rt) {
    if (!revisionEqual(rt.sourceRevision, b.model.revision)) errors.push('ifc_roundtrip_revision_stale');
    if (rt.sourceModelSha256 !== b.model.modelSha256) errors.push('ifc_roundtrip_model_hash_mismatch');
    if (rt.semanticObjectGraphSha256 !== b.model.semanticObjectGraphSha256) errors.push('ifc_roundtrip_semantic_graph_mismatch');
    if (rt.coordinateFrameSha256 !== b.model.coordinateFrameSha256) errors.push('ifc_roundtrip_coordinate_frame_mismatch');
    if (rt.quantitySha256 !== b.model.quantitySha256) errors.push('ifc_roundtrip_quantity_hash_mismatch');
    const ifc = b.manifest?.deliverables?.find(d => d.kind === 'ifc');
    if (ifc && rt.exchangeContentSha256 !== ifc.contentSha256) errors.push('ifc_roundtrip_content_hash_mismatch');
  }
  if (expected.projectId !== undefined && b.projectId !== expected.projectId) errors.push('project_stale');
  if (expected.modelSha256 !== undefined && b.model?.modelSha256 !== expected.modelSha256) errors.push('model_stale');
  if (expected.modelRevision && !revisionEqual(b.model?.revision, expected.modelRevision)) errors.push('revision_stale');
  const unique = [...new Set(errors)];
  if (unique.length) return { valid: false, status: unique.some(e => e.includes('stale') || e.includes('mismatch')) ? 'STALE' : 'HOLD', errors: unique };
  return { valid: true, status: 'VERIFIED', errors: [], canonicalSha256: createHash('sha256').update(stable(b), 'utf8').digest('hex') };
}
