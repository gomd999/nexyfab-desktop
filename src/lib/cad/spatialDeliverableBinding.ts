import { createHash } from 'node:crypto';

export const SPATIAL_DELIVERABLE_BINDING_SCHEMA = 'nexyfab.cad.spatial-deliverable-binding.v1' as const;
export const SPATIAL_DELIVERABLE_DOMAINS = ['building', 'civil', 'landscape', 'interior'] as const;
export type SpatialDeliverableDomain = (typeof SPATIAL_DELIVERABLE_DOMAINS)[number];
export const SPATIAL_REQUIRED_DELIVERABLE_KINDS: Record<SpatialDeliverableDomain, readonly string[]> = {
  building: ['ifc', 'drawing', 'schedule'],
  civil: ['landxml', 'drawing', 'quantity-schedule'],
  landscape: ['site-model', 'planting-plan', 'irrigation-plan'],
  interior: ['space-model', 'drawing', 'finish-schedule'],
};
const SPATIAL_EXCHANGE_KIND: Record<SpatialDeliverableDomain, string> = {
  building: 'ifc', civil: 'landxml', landscape: 'site-model', interior: 'space-model',
};
export type SpatialBindingStatus = 'VERIFIED' | 'NOT_RUN' | 'HOLD' | 'FAIL' | 'STALE';
export type SpatialArtifactStatus = SpatialBindingStatus;

export interface SpatialRevisionHash { id: string; sha256: string }
export interface SpatialModelIdentity {
  revision: SpatialRevisionHash;
  modelSha256: string;
  semanticObjectGraphSha256: string;
  coordinateFrameSha256: string;
  quantitySha256: string;
  drawingScheduleSha256: string;
  sourceStatus: 'AUTHORITATIVE' | 'PREVIEW';
}
export interface SpatialBoundDeliverable {
  kind: string;
  contentSha256: string;
  sourceRevision: SpatialRevisionHash;
  sourceModelSha256: string;
  quantitySha256: string;
  drawingScheduleSha256: string;
  status: SpatialArtifactStatus;
}
export interface SpatialExchangeArtifact {
  kind: string;
  contentSha256: string;
  sourceRevision: SpatialRevisionHash;
  sourceModelSha256: string;
  semanticObjectGraphSha256: string;
  coordinateFrameSha256: string;
  quantitySha256: string;
  status: SpatialArtifactStatus;
}
export interface SpatialRoundTripReceipt {
  receiptSha256: string;
  exchangeContentSha256: string;
  sourceRevision: SpatialRevisionHash;
  sourceModelSha256: string;
  semanticObjectGraphSha256: string;
  coordinateFrameSha256: string;
  quantitySha256: string;
  status: SpatialArtifactStatus;
}
export interface SpatialDeliverableBinding {
  schema: typeof SPATIAL_DELIVERABLE_BINDING_SCHEMA;
  domain: SpatialDeliverableDomain;
  projectId: string;
  model: SpatialModelIdentity;
  deliverableManifestSha256: string;
  deliverables: SpatialBoundDeliverable[];
  exchange: SpatialExchangeArtifact;
  independentRoundTrip: SpatialRoundTripReceipt;
}
export interface SpatialDeliverableBindingValidation { valid: boolean; status: SpatialBindingStatus; errors: string[]; canonicalSha256?: string }

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KEYS = {
  binding: ['schema', 'domain', 'projectId', 'model', 'deliverableManifestSha256', 'deliverables', 'exchange', 'independentRoundTrip'],
  revision: ['id', 'sha256'],
  model: ['revision', 'modelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256', 'drawingScheduleSha256', 'sourceStatus'],
  deliverable: ['kind', 'contentSha256', 'sourceRevision', 'sourceModelSha256', 'quantitySha256', 'drawingScheduleSha256', 'status'],
  exchange: ['kind', 'contentSha256', 'sourceRevision', 'sourceModelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256', 'status'],
  roundTrip: ['receiptSha256', 'exchangeContentSha256', 'sourceRevision', 'sourceModelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256', 'status'],
} as const;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, expected: readonly string[]) => record(v) && Object.keys(v).length === expected.length && Object.keys(v).every(k => expected.includes(k));
const sha = (v: unknown) => typeof v === 'string' && SHA.test(v);
const id = (v: unknown) => typeof v === 'string' && ID.test(v);
const status = (v: unknown): v is SpatialBindingStatus => ['VERIFIED', 'NOT_RUN', 'HOLD', 'FAIL', 'STALE'].includes(v as string);
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : record(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';
const add = (e: string[], ok: boolean, msg: string) => { if (!ok) e.push(msg); };

function validateRevision(v: unknown, path: string, errors: string[]): v is SpatialRevisionHash {
  add(errors, exact(v, KEYS.revision), `${path}:keys_invalid`);
  if (!record(v)) return false;
  add(errors, id(v.id), `${path}.id_invalid`); add(errors, sha(v.sha256), `${path}.sha256_invalid`);
  return id(v.id) && sha(v.sha256);
}
function validateHashes(v: Record<string, unknown>, names: readonly string[], path: string, errors: string[]) { for (const name of names) add(errors, sha(v[name]), `${path}.${name}_invalid`); }

export function validateSpatialDeliverableBinding(input: unknown, expected?: { projectId?: string; modelRevision?: SpatialRevisionHash; modelSha256?: string }): SpatialDeliverableBindingValidation {
  const errors: string[] = [];
  if (!exact(input, KEYS.binding)) return { valid: false, status: 'HOLD', errors: ['binding:keys_invalid'] };
  const b = input as unknown as SpatialDeliverableBinding;
  add(errors, b.schema === SPATIAL_DELIVERABLE_BINDING_SCHEMA, 'schema_invalid');
  add(errors, (SPATIAL_DELIVERABLE_DOMAINS as readonly string[]).includes(b.domain), 'domain_invalid');
  add(errors, id(b.projectId), 'project_id_invalid'); add(errors, sha(b.deliverableManifestSha256), 'manifest_hash_invalid');
  if (!exact(b.model, KEYS.model)) errors.push('model:keys_invalid');
  const m = b.model as unknown as Record<string, unknown>;
  if (record(m)) {
    validateRevision(m.revision, 'model.revision', errors);
    validateHashes(m, ['modelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256', 'drawingScheduleSha256'], 'model', errors);
    add(errors, m.sourceStatus === 'AUTHORITATIVE', 'model.source_preview_blocker');
  }
  const required = SPATIAL_REQUIRED_DELIVERABLE_KINDS[b.domain];
  const ds = b.deliverables;
  add(errors, Array.isArray(ds) && ds.length === required?.length, 'deliverables:count_invalid');
  const kinds = new Set<string>();
  if (Array.isArray(ds)) for (let i = 0; i < ds.length; i++) {
    const d = ds[i] as unknown;
    const p = `deliverables[${i}]`;
    if (!exact(d, KEYS.deliverable)) { errors.push(`${p}:keys_invalid`); continue; }
    const x = d as unknown as Record<string, unknown>;
    add(errors, typeof x.kind === 'string' && required?.includes(x.kind), `${p}.kind_invalid`); if (typeof x.kind === 'string') { add(errors, !kinds.has(x.kind), `${p}.kind_duplicate`); kinds.add(x.kind); }
    validateHashes(x, ['contentSha256', 'sourceModelSha256', 'quantitySha256', 'drawingScheduleSha256'], p, errors); validateRevision(x.sourceRevision, `${p}.sourceRevision`, errors); add(errors, x.status === 'VERIFIED', `${p}.status_${String(x.status).toLowerCase()}_blocker`);
    if (record(m)) { add(errors, x.sourceModelSha256 === m.modelSha256, `${p}.model_hash_mismatch`); add(errors, x.quantitySha256 === m.quantitySha256, `${p}.quantity_hash_mismatch`); add(errors, x.drawingScheduleSha256 === m.drawingScheduleSha256, `${p}.drawing_schedule_hash_mismatch`); add(errors, record(x.sourceRevision) && record(m.revision) && x.sourceRevision.sha256 === m.revision.sha256 && x.sourceRevision.id === m.revision.id, `${p}.revision_stale`); }
  }
  for (const kind of required ?? []) add(errors, kinds.has(kind), `required_deliverable_missing:${kind}`);
  const checkArtifact = (v: unknown, keys: readonly string[], path: string) => { if (!exact(v, keys)) { errors.push(`${path}:keys_invalid`); return undefined; } return v as unknown as Record<string, unknown>; };
  const ex = checkArtifact(b.exchange, KEYS.exchange, 'exchange');
  if (ex) { validateHashes(ex, ['contentSha256', 'sourceModelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256'], 'exchange', errors); validateRevision(ex.sourceRevision, 'exchange.sourceRevision', errors); add(errors, ex.kind === SPATIAL_EXCHANGE_KIND[b.domain], 'exchange.kind_invalid'); add(errors, ex.status === 'VERIFIED', `exchange.status_${String(ex.status).toLowerCase()}_blocker`); if (record(m)) { add(errors, ex.sourceModelSha256 === m.modelSha256, 'exchange.model_hash_mismatch'); add(errors, ex.semanticObjectGraphSha256 === m.semanticObjectGraphSha256, 'exchange.semantic_graph_mismatch'); add(errors, ex.coordinateFrameSha256 === m.coordinateFrameSha256, 'exchange.coordinate_frame_mismatch'); add(errors, ex.quantitySha256 === m.quantitySha256, 'exchange.quantity_hash_mismatch'); add(errors, record(ex.sourceRevision) && record(m.revision) && ex.sourceRevision.id === m.revision.id && ex.sourceRevision.sha256 === m.revision.sha256, 'exchange.revision_stale'); } }
  const rt = checkArtifact(b.independentRoundTrip, KEYS.roundTrip, 'independentRoundTrip');
  if (rt) { validateHashes(rt, ['receiptSha256', 'exchangeContentSha256', 'sourceModelSha256', 'semanticObjectGraphSha256', 'coordinateFrameSha256', 'quantitySha256'], 'independentRoundTrip', errors); validateRevision(rt.sourceRevision, 'independentRoundTrip.sourceRevision', errors); add(errors, rt.status === 'VERIFIED', `independentRoundTrip.status_${String(rt.status).toLowerCase()}_blocker`); if (ex && record(m)) { add(errors, rt.exchangeContentSha256 === ex.contentSha256, 'roundtrip.exchange_hash_mismatch'); add(errors, rt.sourceModelSha256 === m.modelSha256, 'roundtrip.model_hash_mismatch'); add(errors, rt.semanticObjectGraphSha256 === m.semanticObjectGraphSha256, 'roundtrip.semantic_graph_mismatch'); add(errors, rt.coordinateFrameSha256 === m.coordinateFrameSha256, 'roundtrip.coordinate_frame_mismatch'); add(errors, rt.quantitySha256 === m.quantitySha256, 'roundtrip.quantity_hash_mismatch'); add(errors, record(rt.sourceRevision) && record(m.revision) && rt.sourceRevision.id === m.revision.id && rt.sourceRevision.sha256 === m.revision.sha256, 'roundtrip.revision_stale'); } }
  if (expected) { if (expected.projectId !== undefined && expected.projectId !== b.projectId) errors.push('project_stale'); if (expected.modelSha256 !== undefined && (!record(m) || m.modelSha256 !== expected.modelSha256)) errors.push('model_stale'); if (expected.modelRevision && (!record(m) || !record(m.revision) || m.revision.id !== expected.modelRevision.id || m.revision.sha256 !== expected.modelRevision.sha256)) errors.push('revision_stale'); }
  const unique = [...new Set(errors)];
  const stale = unique.some(e => e.includes('stale') || e.includes('mismatch'));
  return unique.length ? { valid: false, status: stale ? 'STALE' : 'HOLD', errors: unique } : { valid: true, status: 'VERIFIED', errors: [], canonicalSha256: hashSpatialDeliverableBinding(b) };
}
export function canonicalSpatialDeliverableBindingJson(binding: SpatialDeliverableBinding): string { const r = validateSpatialDeliverableBinding(binding); if (!r.valid) throw new Error(`invalid_spatial_deliverable_binding:${r.errors.join(',')}`); return stable(binding); }
export function hashSpatialDeliverableBinding(binding: SpatialDeliverableBinding): string { return createHash('sha256').update(canonicalSpatialDeliverableBindingJsonUnsafe(binding), 'utf8').digest('hex'); }
function canonicalSpatialDeliverableBindingJsonUnsafe(binding: SpatialDeliverableBinding): string { return stable(binding); }
