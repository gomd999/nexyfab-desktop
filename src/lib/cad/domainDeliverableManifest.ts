import { createHash } from 'node:crypto';

export const DOMAIN_DELIVERABLE_MANIFEST_SCHEMA = 'nexyfab.domain-deliverable-manifest.v1' as const;
export const DOMAIN_REQUIRED_DELIVERABLE_KINDS = {
  mechanical: ['step', 'drawing', 'bom'],
  building: ['ifc', 'drawing', 'schedule'],
  civil: ['landxml', 'drawing', 'quantity-schedule'],
  landscape: ['site-model', 'planting-plan', 'irrigation-plan'],
  interior: ['space-model', 'drawing', 'finish-schedule'],
} as const;

export type DeliverableDomain = keyof typeof DOMAIN_REQUIRED_DELIVERABLE_KINDS;
export type DeliverableVerificationStatus = 'verified' | 'not_run' | 'hold' | 'fail';
export type DeliverableManifestFormat = 'step' | 'ifc' | 'landxml' | 'pdf' | 'csv' | 'json' | 'dxf' | 'drawing' | 'bom' | 'schedule' | 'quantity-schedule' | 'site-model' | 'planting-plan' | 'irrigation-plan' | 'space-model' | 'finish-schedule';

export interface DomainDeliverable {
  id: string;
  kind: string;
  format: DeliverableManifestFormat;
  contentSha256: string;
  byteLength: number;
  sourceRevision: string;
  generatedAt: string;
  verificationStatus: DeliverableVerificationStatus;
}

export interface DomainDeliverableManifest {
  schema: typeof DOMAIN_DELIVERABLE_MANIFEST_SCHEMA;
  domain: DeliverableDomain;
  projectRevision: string;
  modelContentHash: string;
  requiredDeliverableKinds: string[];
  deliverables: DomainDeliverable[];
  generatedAt: string;
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/;
const SAFE_KIND = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const REVISION = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_DELIVERABLES = 64;
const MAX_BYTES = 500_000_000;
const MANIFEST_KEYS = ['schema', 'domain', 'projectRevision', 'modelContentHash', 'requiredDeliverableKinds', 'deliverables', 'generatedAt'];
const DELIVERABLE_KEYS = ['id', 'kind', 'format', 'contentSha256', 'byteLength', 'sourceRevision', 'generatedAt', 'verificationStatus'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function add(errors: string[], condition: boolean, message: string): void { if (!condition) errors.push(message); }

export function validateDomainDeliverableManifest(input: unknown): ManifestValidationResult {
  const errors: string[] = [];
  if (!isRecord(input) || !exactKeys(input, MANIFEST_KEYS)) return { valid: false, errors: ['manifest_keys_invalid'] };
  const manifest = input as Partial<DomainDeliverableManifest>;
  add(errors, manifest.schema === DOMAIN_DELIVERABLE_MANIFEST_SCHEMA, 'schema_invalid');
  add(errors, typeof manifest.domain === 'string' && manifest.domain in DOMAIN_REQUIRED_DELIVERABLE_KINDS, 'domain_invalid');
  add(errors, typeof manifest.projectRevision === 'string' && REVISION.test(manifest.projectRevision), 'project_revision_invalid');
  add(errors, typeof manifest.modelContentHash === 'string' && SHA256.test(manifest.modelContentHash), 'model_content_hash_invalid');
  add(errors, typeof manifest.generatedAt === 'string' && ISO.test(manifest.generatedAt), 'manifest_generated_at_invalid');
  const required = manifest.requiredDeliverableKinds;
  add(errors, Array.isArray(required) && required.length > 0 && required.length <= MAX_DELIVERABLES, 'required_kinds_invalid');
  const requiredSet = new Set<string>();
  if (Array.isArray(required)) for (const kind of required) {
    add(errors, typeof kind === 'string' && SAFE_KIND.test(kind), 'required_kind_invalid');
    if (typeof kind === 'string') { add(errors, !requiredSet.has(kind), 'required_kind_duplicate'); requiredSet.add(kind); }
  }
  const deliverables = manifest.deliverables;
  add(errors, Array.isArray(deliverables) && deliverables.length <= MAX_DELIVERABLES, 'deliverables_invalid');
  const ids = new Set<string>(); const kinds = new Set<string>();
  if (Array.isArray(deliverables)) for (const item of deliverables) {
    if (!isRecord(item) || !exactKeys(item, DELIVERABLE_KEYS)) { errors.push('deliverable_keys_invalid'); continue; }
    const d = item as Partial<DomainDeliverable>;
    add(errors, typeof d.id === 'string' && SAFE_ID.test(d.id), 'deliverable_id_invalid');
    add(errors, typeof d.kind === 'string' && SAFE_KIND.test(d.kind), 'deliverable_kind_invalid');
    if (typeof d.id === 'string') { add(errors, !ids.has(d.id), 'deliverable_id_duplicate'); ids.add(d.id); }
    if (typeof d.kind === 'string') { add(errors, !kinds.has(d.kind), 'deliverable_kind_duplicate'); kinds.add(d.kind); }
    add(errors, typeof d.format === 'string' && /^[a-z0-9][a-z0-9._-]{0,31}$/.test(d.format), 'deliverable_format_invalid');
    add(errors, typeof d.contentSha256 === 'string' && SHA256.test(d.contentSha256), 'deliverable_hash_invalid');
    add(errors, typeof d.byteLength === 'number' && Number.isSafeInteger(d.byteLength) && d.byteLength >= 0 && d.byteLength <= MAX_BYTES, 'deliverable_bytes_invalid');
    add(errors, typeof d.sourceRevision === 'string' && d.sourceRevision === manifest.projectRevision, 'deliverable_revision_stale');
    add(errors, typeof d.generatedAt === 'string' && ISO.test(d.generatedAt), 'deliverable_generated_at_invalid');
    add(errors, d.verificationStatus === 'verified', 'deliverable_not_verified');
  }
  for (const kind of requiredSet) add(errors, kinds.has(kind), `required_deliverable_missing:${kind}`);
  if (errors.length) return { valid: false, errors: [...new Set(errors)] };
  return { valid: true, errors: [] };
}

export function assertValidDomainDeliverableManifest(input: unknown): asserts input is DomainDeliverableManifest {
  const result = validateDomainDeliverableManifest(input);
  if (!result.valid) throw new Error(`invalid_domain_deliverable_manifest:${result.errors.join(',')}`);
}

export function canonicalDomainDeliverableManifestJson(manifest: DomainDeliverableManifest): string {
  assertValidDomainDeliverableManifest(manifest);
  return stableJson(manifest);
}

export function canonicalDomainDeliverableManifestHash(manifest: DomainDeliverableManifest): string {
  return createHash('sha256').update(canonicalDomainDeliverableManifestJson(manifest), 'utf8').digest('hex');
}

export function createDomainDeliverableManifest(input: Omit<DomainDeliverableManifest, 'schema' | 'requiredDeliverableKinds'> & { requiredDeliverableKinds?: string[] }): DomainDeliverableManifest {
  const domainDefaults = DOMAIN_REQUIRED_DELIVERABLE_KINDS[input.domain] as readonly string[];
  const manifest: DomainDeliverableManifest = { ...input, schema: DOMAIN_DELIVERABLE_MANIFEST_SCHEMA, requiredDeliverableKinds: input.requiredDeliverableKinds ?? [...domainDefaults] };
  assertValidDomainDeliverableManifest(manifest);
  return manifest;
}
